// Cosmetic particles: muzzle smoke, impact dust, shatter sparks. No collision;
// they are stamped with the other movers and never affect the score.

import type { StampVoxel, Vec3 } from "@voxolith/renderer/core";
import { SLOT } from "./world";

interface Particle {
  p: Vec3;
  v: Vec3;
  age: number;
  life: number;
  slot0: number;
  slotN: number;
  drag: number;
  gravity: number;
}

export class Vfx {
  private ps: Particle[] = [];
  constructor(private readonly rng: () => number) {}

  get active(): boolean {
    return this.ps.length > 0;
  }

  private emit(n: number, at: Vec3, spread: number, speed: number, up: number, life: number, slot0: number, slotN: number, drag: number, gravity: number) {
    for (let i = 0; i < n; i++) {
      const r = this.rng;
      const dx = r() - 0.5, dy = r() - 0.5, dz = r() - 0.5;
      const l = Math.hypot(dx, dy, dz) || 1;
      this.ps.push({
        p: [at[0] + dx * spread, at[1] + dy * spread, at[2] + dz * spread],
        v: [(dx / l) * speed, (dy / l) * speed + up, (dz / l) * speed],
        age: 0,
        life: life * (0.7 + r() * 0.6),
        slot0, slotN, drag, gravity,
      });
    }
  }

  muzzle(at: Vec3, dir: Vec3): void {
    this.emit(28, at, 1.2, 9, 3, 0.45, SLOT.DUST0, SLOT.DUST_N, 4, -8);
    // A forward puff along the barrel.
    for (const p of this.ps.slice(-28)) { p.v[0] += dir[0] * 18; p.v[1] += dir[1] * 18; p.v[2] += dir[2] * 18; }
  }

  impact(at: Vec3, speed: number): void {
    const n = Math.round(14 + speed * 0.4);
    this.emit(n, at, 1.5, 6 + speed * 0.15, 6, 0.8, SLOT.DUST0, SLOT.DUST_N, 3, 14);
    this.emit(Math.round(n / 3), at, 0.5, 18, 8, 0.35, SLOT.SPARK, 1, 1, 30);
  }

  puff(at: Vec3, amount: number): void {
    this.emit(Math.round(6 + amount), at, 2, 4, 3, 0.7, SLOT.DUST0 + 1, SLOT.DUST_N - 1, 3, 10);
  }

  tick(dt: number): void {
    const keep: Particle[] = [];
    for (const p of this.ps) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.v = [p.v[0] * k, (p.v[1] - p.gravity * dt) * k, p.v[2] * k];
      p.p = [p.p[0] + p.v[0] * dt, p.p[1] + p.v[1] * dt, p.p[2] + p.v[2] * dt];
      keep.push(p);
    }
    this.ps = keep;
  }

  voxels(out: StampVoxel[]): void {
    for (const p of this.ps) {
      const f = p.age / p.life;
      const slot = p.slot0 + Math.min(p.slotN - 1, Math.floor(f * p.slotN));
      out.push({ x: Math.floor(p.p[0]), y: Math.floor(p.p[1]), z: Math.floor(p.p[2]), c: slot });
    }
  }

  clear(): void {
    this.ps = [];
  }
}
