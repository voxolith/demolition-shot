// The cannon: a small voxel model whose barrel follows the aim, plus the aim
// model (drag-back slingshot) and the trajectory preview.

import { voxelRaycast, type StampVoxel, type Vec3 } from "@voxolith/renderer/core";
import { CANNON_PIVOT, GRAVITY, SIZE, SLOT } from "./world";

export interface Aim {
  /** Degrees left/right of +Z (positive = toward +X). */
  yawDeg: number;
  /** Elevation above the horizon. */
  pitchDeg: number;
  /** 0..1 pull strength. */
  power: number;
}

export const AIM_LIMITS = { yaw: 32, pitchMin: 8, pitchMax: 72 };
export const DEFAULT_AIM: Aim = { yawDeg: 0, pitchDeg: 30, power: 0.6 };
const BARREL_LEN = 9;
const BARREL_R = 1.6;
const MIN_SPEED = 34;
const MAX_SPEED = 92;

export const aimSpeed = (a: Aim): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * a.power;

export function aimDir(a: Aim): Vec3 {
  const yaw = (a.yawDeg * Math.PI) / 180, pitch = (a.pitchDeg * Math.PI) / 180;
  const c = Math.cos(pitch);
  return [c * Math.sin(yaw), Math.sin(pitch), c * Math.cos(yaw)];
}

export function muzzle(a: Aim): Vec3 {
  const d = aimDir(a);
  const L = BARREL_LEN + 1.5;
  return [CANNON_PIVOT[0] + d[0] * L, CANNON_PIVOT[1] + d[1] * L, CANNON_PIVOT[2] + d[2] * L];
}

/**
 * Slingshot mapping: the finger pulls back (screen down/left/right) from the
 * grab point. Pull distance sets power, vertical pull raises the barrel,
 * horizontal pull swings it the opposite way (like a slingshot pouch).
 */
export function aimFromDrag(dx: number, dy: number, viewportMin: number): Aim {
  const scale = Math.max(160, viewportMin * 0.45);
  const pull = Math.min(1, Math.hypot(dx, dy) / scale);
  const pitch = Math.max(AIM_LIMITS.pitchMin, Math.min(AIM_LIMITS.pitchMax, 18 + (dy / scale) * 60));
  const yaw = Math.max(-AIM_LIMITS.yaw, Math.min(AIM_LIMITS.yaw, (-dx / scale) * 45));
  return { yawDeg: yaw, pitchDeg: pitch, power: Math.max(0.12, pull) };
}

/** Cannon voxels (carriage, wheels, barrel) for the current aim. Stamped every frame. */
export function cannonVoxels(a: Aim, out: StampVoxel[]): void {
  const [px, py, pz] = CANNON_PIVOT;
  // Carriage: wooden block under the pivot, sitting on the plinth (y 3..5).
  for (let z = -3; z <= 3; z++)
    for (let x = -2; x <= 2; x++)
      for (let y = 3; y <= 5; y++) out.push({ x: px + x, y, z: pz + z, c: SLOT.WOOD });
  // Two wheels (rings in the XY plane at x = ±3).
  for (const wx of [-3, 3])
    for (let z = -3; z <= 3; z++)
      for (let y = 1; y <= 7; y++) {
        const dz = z, dy = y - 4;
        const r2 = dz * dz + dy * dy;
        if (r2 <= 12 && r2 >= 4) out.push({ x: px + wx, y, z: pz + z, c: SLOT.WHEEL });
        else if (r2 < 4) out.push({ x: px + wx, y, z: pz + z, c: SLOT.BRASS });
      }
  // Barrel: cylinder along the aim direction, from just behind the pivot.
  const d = aimDir(a);
  const up: Vec3 = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
  const side: Vec3 = norm(cross(d, up));
  const up2: Vec3 = cross(side, d);
  const seen = new Set<number>();
  for (let t = -2; t <= BARREL_LEN; t += 0.5) {
    const cx = px + d[0] * t, cy = py + d[1] * t, cz = pz + d[2] * t;
    const rr = t > BARREL_LEN - 1.5 ? BARREL_R + 0.4 : BARREL_R; // flared muzzle
    for (let u = -2; u <= 2; u++)
      for (let v = -2; v <= 2; v++) {
        if (u * u + v * v > rr * rr) continue;
        const x = Math.floor(cx + side[0] * u + up2[0] * v), y = Math.floor(cy + side[1] * u + up2[1] * v), z = Math.floor(cz + side[2] * u + up2[2] * v);
        const key = x + y * 1024 + z * 1048576;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x, y, z, c: t < -1 ? SLOT.BRASS : SLOT.IRON });
      }
  }
}

/** Dotted ballistic arc from the muzzle until the first solid hit (or 3 s). */
export function previewVoxels(a: Aim, plate: Uint8Array, out: StampVoxel[]): void {
  const d = aimDir(a);
  const s = aimSpeed(a);
  let p = muzzle(a);
  let v: Vec3 = [d[0] * s, d[1] * s, d[2] * s];
  const dt = 1 / 40;
  let i = 0;
  for (let t = 0; t < 3; t += dt, i++) {
    v = [v[0], v[1] - GRAVITY * dt, v[2]];
    const move: Vec3 = [v[0] * dt, v[1] * dt, v[2] * dt];
    if (voxelRaycast(SIZE, plate, p, move, 1)) break;
    p = [p[0] + move[0], p[1] + move[1], p[2] + move[2]];
    if (p[1] < 0) break;
    if (i % 3 === 0) out.push({ x: Math.floor(p[0]), y: Math.floor(p[1]), z: Math.floor(p[2]), c: SLOT.DOT });
  }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
