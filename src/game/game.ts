// The headless game controller: owns the plate, the structure, the simulation
// and the per-shot state machine. No DOM, no GPU: tools/verify.ts drives it
// directly, and main.ts wraps it with rendering, input and UI.

import { GridStamper, seededRandom, hashSeed, type DirtyBox, type StampVoxel, type Vec3 } from "@voxolith/renderer/core";
import { SIZE, PLATFORM_CENTER, buildPlate, buildPalette, setPlatformHalf } from "./world";
import { Structure, type Cell, type Plate } from "./structure";
import { addChunks, fireBall, moverVoxels, simActive, spawnDebris, stepSim, type WorldSim, type ImpactEvent } from "./physics";
import { aimDir, aimSpeed, cannonVoxels, muzzle, previewVoxels, DEFAULT_AIM, type Aim } from "./cannon";
import { Vfx } from "./vfx";
import { isWin, stars, type ShotResult } from "./scoring";
import type { Level } from "./levels";

export type Phase = "aim" | "flying" | "settling" | "won" | "lost";

export interface GameHooks {
  onFire?(muzzle: Vec3, dir: Vec3, power: number): void;
  onImpact?(e: ImpactEvent): void;
  onPhase?(phase: Phase): void;
  onProgress?(fraction: number): void;
}

const SUBSTEP = 1 / 120;
/** Pedestal-contact strength per anchor voxel; lower = things topple more easily. */
const TOPPLE_STRENGTH = 8;
/** A falling chunk must hit the structure at least this fast to damage it. */
const CHAIN_SPEED = 9;
const SETTLE_CAP = 7; // seconds before a shot is evaluated regardless
const SETTLE_QUIET = 0.6; // seconds of no movement before evaluating

export class Game {
  readonly base: Uint8Array;
  readonly stamper: GridStamper;
  readonly plate: Plate;
  readonly structure: Structure;
  readonly sim: WorldSim;
  readonly vfx: Vfx;
  level: Level | null = null;
  attempt = 0;
  phase: Phase = "aim";
  aim: Aim = { ...DEFAULT_AIM };
  aiming = false;
  ballsLeft = 0;
  ballsUsed = 0;
  private settleTime = 0;
  private quietTime = 0;
  private dirtyBase: DirtyBox | null = null;
  private accumulator = 0;

  constructor(private readonly hooks: GameHooks = {}) {
    this.base = buildPlate();
    this.stamper = new GridStamper(this.base, SIZE);
    this.plate = {
      data: this.base,
      get: (x, y, z) => this.stamper.baseAt(x, y, z),
      write: (voxels: StampVoxel[]) => {
        const b = this.stamper.writeBase(voxels);
        if (b) this.dirtyBase = union(this.dirtyBase, b);
      },
    };
    this.structure = new Structure(this.plate);
    const rng = seededRandom(1);
    this.vfx = new Vfx(rng);
    this.sim = {
      plate: this.plate,
      rng,
      knockedOff: 0,
      settle: (cells) => this.structure.addRubble(cells),
      ball: null,
      chunks: [],
      debris: [],
      events: [],
    };
  }

  /** Reset the arena and place a level. Returns the palette to upload. */
  loadLevel(level: Level, attempt = 0): Float32Array {
    this.level = level;
    this.attempt = attempt;
    const rng = seededRandom(hashSeed(`${level.id}:${attempt}`));
    this.sim.rng = rng;
    const built = level.build(rng);
    // Pedestal: the structure's footprint plus a margin (levels may widen it).
    let hx = 0, hz = 0;
    for (const v of built.cells) { hx = Math.max(hx, Math.abs(v.x) + 1); hz = Math.max(hz, Math.abs(v.z) + 1); }
    const margin = level.pedestalMargin ?? 3;
    setPlatformHalf(hx + margin, hz + margin);
    this.base.set(buildPlate());
    this.stamper.setBase(this.base);
    const [cx, cy, cz] = PLATFORM_CENTER;
    const cells: Cell[] = built.cells.map((v) => ({ x: v.x + Math.floor(cx), y: v.y + Math.floor(cy), z: v.z + Math.floor(cz), c: v.c }));
    this.structure.load(cells);
    this.sim.knockedOff = 0;
    this.sim.ball = null;
    this.sim.chunks = [];
    this.sim.debris = [];
    this.sim.events = [];
    this.vfx.clear();
    this.ballsLeft = level.balls;
    this.ballsUsed = 0;
    this.aim = { ...DEFAULT_AIM };
    this.aiming = false;
    this.dirtyBase = null; // main re-uploads the whole grid after a load
    this.accumulator = 0;
    this.setPhase("aim");
    return buildPalette(built.palette);
  }

  /**
   * Fraction of the original structure demolished: voxels no longer standing
   * where they were built (carved, toppled, or lying as rubble). Voxels that
   * left the platform are a subset, reported separately in result().
   */
  progress(): number {
    return this.structure.demolished();
  }

  result(): ShotResult {
    return {
      knockedOff: this.structure.initial - this.structure.standing,
      offPlatform: this.sim.knockedOff,
      initial: this.structure.initial,
      target: this.level?.target ?? 1,
      ballsTotal: this.level?.balls ?? 0,
      ballsUsed: this.ballsUsed,
    };
  }

  stars(): 0 | 1 | 2 | 3 {
    return stars(this.result());
  }

  beginAim(): void {
    if (this.phase === "aim") this.aiming = true;
  }

  updateAim(aim: Aim): void {
    if (this.phase === "aim") this.aim = aim;
  }

  cancelAim(): void {
    this.aiming = false;
  }

  /** Fire the current aim. Returns false when no shot is possible. */
  fire(): boolean {
    if (this.phase !== "aim" || this.ballsLeft <= 0) return false;
    this.aiming = false;
    this.ballsLeft--;
    this.ballsUsed++;
    const m = muzzle(this.aim);
    const d = aimDir(this.aim);
    fireBall(this.sim, m, d, aimSpeed(this.aim));
    this.vfx.muzzle(m, d);
    this.hooks.onFire?.(m, d, this.aim.power);
    this.settleTime = 0;
    this.quietTime = 0;
    this.setPhase("flying");
    return true;
  }

  /** Advance the simulation by a frame's dt (internally fixed-stepped). */
  step(dt: number): void {
    if (this.phase !== "flying" && this.phase !== "settling") {
      this.vfx.tick(dt);
      return;
    }
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= SUBSTEP) {
      this.accumulator -= SUBSTEP;
      stepSim(this.sim, SUBSTEP, (at, r, speed, dir) => this.carve(at, r, speed, dir));
      // Events are drained before secondary carving so chain hits don't re-enter.
      const events = this.sim.events.slice();
      for (const e of events) {
        this.vfx.impact(e.at, e.speed);
        this.hooks.onImpact?.(e);
        if (e.kind !== "ball" && e.onStructure && e.speed > CHAIN_SPEED && (e.mass ?? 0) >= 4) {
          // A landing chunk hits like a slower, heavier ball.
          const impulse = e.speed * Math.min(3, Math.max(0.6, (e.mass ?? 0) / 40));
          const removed = this.carve(e.at, 1.2 + e.speed * 0.04, impulse, e.dir);
          if (removed.length) spawnDebris(this.sim, removed, [0, 4, 0], 0.2, true, e.at);
        }
      }
      this.settleTime += SUBSTEP;
    }
    this.vfx.tick(dt);
    this.hooks.onProgress?.(this.progress());

    const active = simActive(this.sim);
    if (this.phase === "flying" && !(this.sim.ball?.alive ?? false)) this.setPhase("settling");
    if (this.phase === "settling") {
      this.quietTime = active ? 0 : this.quietTime + dt;
      if (this.quietTime >= SETTLE_QUIET || this.settleTime > SETTLE_CAP) this.evaluate();
    }
  }

  private carve(at: Vec3, r: number, speed: number, dir?: Vec3): Cell[] {
    const removed = this.structure.carveSphere(at[0], at[1], at[2], r);
    removed.push(...this.structure.fractureWeak(at[0], at[1], at[2], r * 1.7));
    // A hard hit on a top-heavy piece tips the whole piece over.
    const toppled = this.structure.topple(at[0], at[1], at[2], speed, TOPPLE_STRENGTH, r + 2);
    const chunks = this.structure.detachUnsupported();
    if (toppled) chunks.push(toppled);
    if (chunks.length) addChunks(this.sim, chunks, at, speed * 0.35, dir);
    if (removed.length) this.vfx.puff(at, removed.length * 0.2);
    return removed;
  }

  private evaluate(): void {
    if (isWin(this.result())) this.setPhase("won");
    else if (this.ballsLeft > 0) this.setPhase("aim");
    else this.setPhase("lost");
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.hooks.onPhase?.(p);
  }

  /** Everything to stamp this frame: cannon, aim preview, movers, particles. */
  movers(out: StampVoxel[]): void {
    cannonVoxels(this.aim, out);
    if (this.phase === "aim" && this.aiming) previewVoxels(this.aim, this.base, out);
    moverVoxels(this.sim, out);
    this.vfx.voxels(out);
  }

  /** True while the scene changes on its own (needs continuous rendering). */
  animating(): boolean {
    return this.phase === "flying" || this.phase === "settling" || this.aiming || this.vfx.active;
  }

  /** Base edits since the last call (carving, rubble), for a partial upload. */
  takeDirtyBase(): DirtyBox | null {
    const b = this.dirtyBase;
    this.dirtyBase = null;
    return b;
  }
}

function union(a: DirtyBox | null, b: DirtyBox): DirtyBox {
  if (!a) return b;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), z1: Math.max(a.z1, b.z1) };
}
