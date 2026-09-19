// Movers: the cannonball, falling chunks (rigid, tumbling a little, shatter on
// hard landings) and loose debris voxels. All deterministic given a seeded RNG.
// Collision is against the plate (pedestal + attached structure + rubble), read
// through the Plate interface; movers do not collide with each other.

import { voxelRaycast, type StampVoxel, type Vec3 } from "@voxolith/renderer/core";
import { GRAVITY, SIZE, FALL_Y, overPlatform, SLOT, PLATFORM } from "./world";
import type { Cell, Chunk, Plate } from "./structure";

export const BALL_RADIUS = 2.2;
const BALL_BLAST_MIN = 2.0; // carve radius at impact grows with speed
const BALL_RESTITUTION = 0.3;
const CHUNK_RESTITUTION = 0.12;
const SHATTER_SPEED = 16; // chunk impact speed that breaks it into debris
const REST_SPEED = 1.2;
const REST_TIME = 0.35;
const DEBRIS_LIFE = 4;
const MAX_DEBRIS = 900;

export type Mat3 = [number, number, number, number, number, number, number, number, number];
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export interface Ball {
  p: Vec3;
  v: Vec3;
  bounces: number;
  alive: boolean;
}

export interface FlyingChunk {
  local: Cell[];
  pos: Vec3;
  vel: Vec3;
  ang: Vec3; // angular velocity, rad/s
  rot: Mat3;
  restTime: number;
  age: number;
}

export interface Debris {
  p: Vec3;
  v: Vec3;
  c: number;
  age: number;
}

export interface ImpactEvent {
  at: Vec3;
  speed: number;
  kind: "ball" | "chunk" | "shatter";
  /** Voxel count of the mover that hit (chunks); drives chain-reaction damage. */
  mass?: number;
  /** True when the contact was with a structure voxel (not the pedestal/ground). */
  onStructure?: boolean;
  /** Unit travel direction of the mover at contact. */
  dir?: Vec3;
}

export interface WorldSim {
  plate: Plate;
  rng: () => number;
  /** Structure voxels that left the platform for good (score). */
  knockedOff: number;
  /** Settled rubble callback: cells to re-attach to the structure. Returns how many were accepted. */
  settle: (cells: Cell[]) => number;
  ball: Ball | null;
  chunks: FlyingChunk[];
  debris: Debris[];
  /** Events emitted during the last step (sound/haptics/VFX hooks). */
  events: ImpactEvent[];
}

const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

function solidAt(plate: Plate, x: number, y: number, z: number): boolean {
  if (y < 0) return true; // the ground plane
  return plate.get(Math.floor(x), Math.floor(y), Math.floor(z)) !== 0;
}

/** Sphere offsets for stamping the ball. */
const BALL_OFFSETS: Vec3[] = (() => {
  const out: Vec3[] = [];
  const r = Math.ceil(BALL_RADIUS);
  for (let z = -r; z <= r; z++)
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y + z * z <= BALL_RADIUS * BALL_RADIUS) out.push([x, y, z]);
  return out;
})();

export function fireBall(sim: WorldSim, muzzle: Vec3, dir: Vec3, speed: number): void {
  const d = len(dir) || 1;
  sim.ball = {
    p: [muzzle[0], muzzle[1], muzzle[2]],
    v: [(dir[0] / d) * speed, (dir[1] / d) * speed, (dir[2] / d) * speed],
    bounces: 0,
    alive: true,
  };
}

/** Advance everything by dt (call with small fixed steps). */
export type Carve = (at: Vec3, radius: number, speed: number, dir: Vec3) => Cell[];

export function stepSim(sim: WorldSim, dt: number, carve: Carve): void {
  sim.events.length = 0;
  stepBall(sim, dt, carve);
  stepChunks(sim, dt);
  stepDebris(sim, dt);
}

function stepBall(sim: WorldSim, dt: number, carve: Carve): void {
  const b = sim.ball;
  if (!b || !b.alive) return;
  b.v[1] -= GRAVITY * dt;
  const move: Vec3 = [b.v[0] * dt, b.v[1] * dt, b.v[2] * dt];
  // Sweep the centre; the ball's radius is handled by carving at the hit point.
  const hit = voxelRaycast(SIZE, sim.plate.data, b.p, move, 1 + BALL_RADIUS / (len(move) || 1));
  const speed = len(b.v);
  if (hit && speed > 0) {
    const at: Vec3 = [b.p[0] + move[0] * hit.t, b.p[1] + move[1] * hit.t, b.p[2] + move[2] * hit.t];
    // Carve from a point slightly inside the surface so a solid hit cuts through.
    const vlen = len(b.v) || 1;
    const r0 = blastRadius(speed);
    const deep: Vec3 = [at[0] + (b.v[0] / vlen) * r0 * 0.55, at[1] + (b.v[1] / vlen) * r0 * 0.55, at[2] + (b.v[2] / vlen) * r0 * 0.55];
    const removed = carveAt(sim, deep, speed, carve);
    sim.events.push({ at, speed, kind: "ball" });
    // Reflect and lose energy; the ball dies after two bounces or when slow.
    const n = hit.normal;
    const vn = b.v[0] * n[0] + b.v[1] * n[1] + b.v[2] * n[2];
    b.v = [b.v[0] - (1 + BALL_RESTITUTION) * vn * n[0], b.v[1] - (1 + BALL_RESTITUTION) * vn * n[1], b.v[2] - (1 + BALL_RESTITUTION) * vn * n[2]];
    const k = removed.length > 0 ? 0.45 : 0.7;
    b.v = [b.v[0] * k, b.v[1] * k, b.v[2] * k];
    b.p = [at[0] + n[0] * (BALL_RADIUS + 0.1), at[1] + n[1] * (BALL_RADIUS + 0.1), at[2] + n[2] * (BALL_RADIUS + 0.1)];
    b.bounces++;
    if (b.bounces >= 2 || len(b.v) < 8) {
      b.alive = false;
      spawnDebris(sim, [{ x: Math.floor(b.p[0]), y: Math.floor(b.p[1]), z: Math.floor(b.p[2]), c: SLOT.BALL }], b.v, 0.4, false);
    }
    return;
  }
  b.p = [b.p[0] + move[0], b.p[1] + move[1], b.p[2] + move[2]];
  if (b.p[1] < -4 || b.p[0] < -20 || b.p[0] > SIZE.x + 20 || b.p[2] < -20 || b.p[2] > SIZE.z + 20) b.alive = false;
  else if (b.p[1] < 0) {
    // Hit the ground plane outside the grid volume: a dull bounce.
    b.p[1] = 0.1;
    b.v[1] = Math.abs(b.v[1]) * 0.3;
    b.v[0] *= 0.6; b.v[2] *= 0.6;
    b.bounces++;
    sim.events.push({ at: [...b.p] as Vec3, speed, kind: "ball" });
    if (b.bounces >= 2) b.alive = false;
  }
}

/** Blast radius grows with impact speed (34 → ~3.0, 92 → ~4.8). */
export function blastRadius(speed: number): number {
  return BALL_BLAST_MIN + speed * 0.03;
}

function carveAt(sim: WorldSim, at: Vec3, speed: number, carve: Carve): Cell[] {
  const r = blastRadius(speed);
  const v = sim.ball ? sim.ball.v : ([0, 0, 1] as Vec3);
  const vl = len(v) || 1;
  const removed = carve(at, r, speed, [v[0] / vl, v[1] / vl, v[2] / vl]);
  // Removed structure voxels fly away from the impact as debris.
  spawnDebris(sim, removed, v, 0.35 + r * 0.05, true, at);
  return removed;
}

/** Turn cells into loose debris. `kick` copies a share of the given velocity plus a radial burst. */
export function spawnDebris(sim: WorldSim, cells: Cell[], vel: Vec3, kick: number, countOverflow: boolean, from?: Vec3): void {
  for (const c of cells) {
    if (sim.debris.length >= MAX_DEBRIS) {
      // Over budget: vaporise. Structure voxels count as knocked off only if they would fall anyway.
      if (countOverflow) sim.knockedOff++;
      continue;
    }
    const r = sim.rng;
    let rx = r() - 0.5, ry = r() - 0.5, rz = r() - 0.5;
    if (from) {
      rx += (c.x + 0.5 - from[0]) * 0.35; ry += (c.y + 0.5 - from[1]) * 0.35; rz += (c.z + 0.5 - from[2]) * 0.35;
    }
    const burst = 10 + r() * 14;
    sim.debris.push({
      p: [c.x + 0.5, c.y + 0.5, c.z + 0.5],
      v: [vel[0] * kick + rx * burst, vel[1] * kick + Math.abs(ry) * burst + 6, vel[2] * kick + rz * burst],
      c: c.c,
      age: 0,
    });
  }
}

export function addChunks(sim: WorldSim, chunks: Chunk[], impulseFrom: Vec3 | null, impulse: number, along?: Vec3): void {
  for (const ch of chunks) {
    const vel: Vec3 = [0, 0, 0];
    const r = sim.rng;
    let ang: Vec3 = [(r() - 0.5) * 0.8, (r() - 0.5) * 0.4, (r() - 0.5) * 0.8];
    if (impulseFrom) {
      // Push along the hit's travel direction when known, else away from the blast.
      const d: Vec3 = along && Math.hypot(along[0], along[2]) > 0.2
        ? [along[0], 0, along[2]]
        : [ch.com[0] - impulseFrom[0], 0, ch.com[2] - impulseFrom[2]];
      const l = len(d) || 1;
      // Bigger chunks take less of the kick; the push is horizontal, away from the blast.
      const k = impulse / (1 + ch.local.length / 150) / l;
      vel[0] = d[0] * k; vel[1] = 2 + r() * 3; vel[2] = d[2] * k;
      // Topple: spin about the horizontal axis perpendicular to the push.
      const spin = Math.min(2.6, 0.8 + impulse / 35);
      ang = [ang[0] + (d[2] / l) * spin, ang[1], ang[2] - (d[0] / l) * spin];
      // The top of a tall piece travels: add lean velocity proportional to height.
      let h = 0;
      for (const v of ch.local) h = Math.max(h, v.y);
      vel[0] += (d[0] / l) * h * 0.6; vel[2] += (d[2] / l) * h * 0.6;
    }
    sim.chunks.push({
      local: ch.local,
      pos: [...ch.com] as Vec3,
      vel,
      ang,
      rot: [...IDENTITY] as Mat3,
      restTime: 0,
      age: 0,
    });
  }
}

function rotate(m: Mat3, v: Cell): Vec3 {
  return [m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z];
}
function axisAngle(ax: number, ay: number, az: number, a: number): Mat3 {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c,
  ];
}
function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

/** World cells of a chunk at a given pose. */
export function chunkCells(ch: FlyingChunk, pos: Vec3 = ch.pos, rot: Mat3 = ch.rot): Cell[] {
  const out: Cell[] = [];
  for (const v of ch.local) {
    const w = rotate(rot, v);
    out.push({ x: Math.floor(pos[0] + w[0]), y: Math.floor(pos[1] + w[1]), z: Math.floor(pos[2] + w[2]), c: v.c });
  }
  return out;
}

let lastContact: Vec3 | null = null;
function chunkCollides(plate: Plate, ch: FlyingChunk, pos: Vec3, rot: Mat3): boolean {
  for (const v of ch.local) {
    const w = rotate(rot, v);
    const x = pos[0] + w[0], y = pos[1] + w[1], z = pos[2] + w[2];
    if (solidAt(plate, x, y, z)) {
      lastContact = [Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(z) + 0.5];
      return true;
    }
  }
  return false;
}

function stepChunks(sim: WorldSim, dt: number): void {
  const keep: FlyingChunk[] = [];
  for (const ch of sim.chunks) {
    ch.age += dt;
    ch.vel[1] -= GRAVITY * dt;
    // Tumble; damp spin so chunks come to rest.
    const w = len(ch.ang);
    let rot = ch.rot;
    if (w > 1e-4) rot = mul(axisAngle(ch.ang[0] / w, ch.ang[1] / w, ch.ang[2] / w, w * dt), ch.rot);
    const pos: Vec3 = [ch.pos[0] + ch.vel[0] * dt, ch.pos[1] + ch.vel[1] * dt, ch.pos[2] + ch.vel[2] * dt];
    let landed = false;
    if (chunkCollides(sim.plate, ch, pos, rot)) {
      const rotBlocked = chunkCollides(sim.plate, ch, pos, ch.rot);
      // Spinning into the ground? Let the piece ride up over its edge (a topple
      // pivots about the base) before falling back to translation-only resolution.
      if (!chunkCollides(sim.plate, ch, pos, ch.rot)) {
        let lifted = false;
        for (let k = 0.5; k <= 2.5 && !lifted; k += 0.5) {
          const up: Vec3 = [pos[0], pos[1] + k, pos[2]];
          if (!chunkCollides(sim.plate, ch, up, rot)) { pos[1] = up[1]; lifted = true; }
        }
        if (!lifted) rot = ch.rot;
      }
      if (rotBlocked || chunkCollides(sim.plate, ch, pos, rot)) {
      // Keep the old orientation on contact and resolve axis by axis (Y first).
      rot = ch.rot;
      const impact = len(ch.vel);
      const contact: Vec3 = lastContact ?? ([...ch.pos] as Vec3);
      // Hitting the structure (not the pedestal) passes the blow on: chain reactions.
      const onStructure = contact[1] >= PLATFORM.top + 1 && overPlatform(contact[0], contact[2]);
      const dir: Vec3 = impact > 0 ? [ch.vel[0] / impact, ch.vel[1] / impact, ch.vel[2] / impact] : [0, -1, 0];
      const tryY: Vec3 = [ch.pos[0], pos[1], ch.pos[2]];
      if (chunkCollides(sim.plate, ch, tryY, rot)) {
        if (impact > SHATTER_SPEED && ch.local.length > 1) {
          sim.events.push({ at: contact, speed: impact, kind: "shatter", mass: ch.local.length, onStructure, dir });
          spawnDebris(sim, chunkCells(ch), ch.vel, 0.35, false);
          continue;
        }
        sim.events.push({ at: contact, speed: impact, kind: "chunk", mass: ch.local.length, onStructure, dir });
        ch.vel[1] = -ch.vel[1] * CHUNK_RESTITUTION;
        ch.vel[0] *= 0.55; ch.vel[2] *= 0.55;
        ch.ang = [ch.ang[0] * 0.4, ch.ang[1] * 0.4, ch.ang[2] * 0.4];
        landed = ch.vel[1] >= 0;
        pos[1] = ch.pos[1];
      } else {
        ch.pos[1] = pos[1];
      }
      const tryX: Vec3 = [pos[0], ch.pos[1], ch.pos[2]];
      if (chunkCollides(sim.plate, ch, tryX, rot)) { ch.vel[0] = -ch.vel[0] * 0.2; pos[0] = ch.pos[0]; }
      const tryZ: Vec3 = [ch.pos[0], ch.pos[1], pos[2]];
      if (chunkCollides(sim.plate, ch, tryZ, rot)) { ch.vel[2] = -ch.vel[2] * 0.2; pos[2] = ch.pos[2]; }
      if (chunkCollides(sim.plate, ch, pos, rot)) pos[1] = ch.pos[1] + 0.02; // nudge out of interpenetration
      }
    }
    ch.pos = pos;
    ch.rot = rot;
    ch.ang = [ch.ang[0] * (1 - 0.6 * dt), ch.ang[1] * (1 - 0.6 * dt), ch.ang[2] * (1 - 0.6 * dt)];

    // Left the platform: it counts once it lands on the ground or drops out of sight.
    if (ch.pos[1] < FALL_Y || !overPlatform(ch.pos[0], ch.pos[2])) {
      if (landed || ch.pos[1] < -6 || ch.age > 8) {
        sim.knockedOff += ch.local.length;
        sim.events.push({ at: [...ch.pos] as Vec3, speed: 20, kind: "shatter" });
        continue;
      }
      keep.push(ch);
      continue;
    }
    // At rest on the platform: merge as rubble.
    if (landed && len(ch.vel) < REST_SPEED) ch.restTime += dt;
    else ch.restTime = 0;
    if (ch.restTime > REST_TIME || ch.age > 10) {
      // Cells that overlap existing solids simply vanish (they were inside something).
      sim.settle(chunkCells(ch).filter((c) => c.y >= 0 && c.y < SIZE.y));
      continue;
    }
    keep.push(ch);
  }
  sim.chunks = keep;
}

function stepDebris(sim: WorldSim, dt: number): void {
  const keep: Debris[] = [];
  const settleCells: Cell[] = [];
  for (const d of sim.debris) {
    d.age += dt;
    d.v[1] -= GRAVITY * dt;
    // Axis-separated point collision with the plate.
    let nx = d.p[0] + d.v[0] * dt;
    if (solidAt(sim.plate, nx, d.p[1], d.p[2])) { d.v[0] *= -0.3; nx = d.p[0]; }
    let nz = d.p[2] + d.v[2] * dt;
    if (solidAt(sim.plate, nx, d.p[1], nz)) { d.v[2] *= -0.3; nz = d.p[2]; }
    let ny = d.p[1] + d.v[1] * dt;
    let onGround = false;
    if (solidAt(sim.plate, nx, ny, nz)) {
      if (d.v[1] < 0) onGround = true;
      d.v[1] = -d.v[1] * 0.25;
      d.v[0] *= 0.7; d.v[2] *= 0.7;
      ny = d.p[1];
    }
    d.p = [nx, ny, nz];
    const below = d.p[1] < FALL_Y || !overPlatform(d.p[0], d.p[2]);
    if (below) {
      if ((onGround && len(d.v) < REST_SPEED * 2) || d.p[1] < -6 || d.age > DEBRIS_LIFE) {
        if (d.c !== SLOT.BALL) sim.knockedOff++;
        continue;
      }
      keep.push(d);
      continue;
    }
    if ((onGround && len(d.v) < REST_SPEED) || d.age > DEBRIS_LIFE) {
      if (d.c !== SLOT.BALL && d.p[1] >= PLATFORM.top + 1) settleCells.push({ x: Math.floor(d.p[0]), y: Math.floor(d.p[1]), z: Math.floor(d.p[2]), c: d.c });
      continue;
    }
    keep.push(d);
  }
  sim.debris = keep;
  if (settleCells.length) sim.settle(settleCells);
}

/** True while anything is still moving. */
export function simActive(sim: WorldSim): boolean {
  return (sim.ball?.alive ?? false) || sim.chunks.length > 0 || sim.debris.length > 0;
}

/** Everything that moves this frame, for one stamper.stamp() call. */
export function moverVoxels(sim: WorldSim, out: StampVoxel[]): void {
  const b = sim.ball;
  if (b?.alive) {
    const bx = Math.floor(b.p[0]), by = Math.floor(b.p[1]), bz = Math.floor(b.p[2]);
    for (const o of BALL_OFFSETS) out.push({ x: bx + o[0], y: by + o[1], z: bz + o[2], c: SLOT.BALL });
  }
  for (const ch of sim.chunks) for (const c of chunkCells(ch)) out.push(c);
  for (const d of sim.debris) out.push({ x: Math.floor(d.p[0]), y: Math.floor(d.p[1]), z: Math.floor(d.p[2]), c: d.c });
}
