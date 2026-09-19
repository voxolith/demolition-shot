// The arena: grid dimensions, palette slots, and the static plate (pedestal +
// cannon plinth). Everything here is headless (no GPU) so tools can import it.

import type { Vec3 } from "@voxolith/renderer/core";

export const SIZE = { x: 128, y: 96, z: 128 };
export const VOLUME = SIZE.x * SIZE.y * SIZE.z;
export const idx = (x: number, y: number, z: number): number => x + y * SIZE.x + z * SIZE.x * SIZE.y;
export const inGrid = (x: number, y: number, z: number): boolean =>
  x >= 0 && y >= 0 && z >= 0 && x < SIZE.x && y < SIZE.y && z < SIZE.z;

/** Pedestal top surface Y. Structures sit at top + 1. */
export const PLATFORM_TOP = 20;
/** Pedestal centre (x, structure base y, z); fixed so the camera never moves between levels. */
export const PLATFORM_CENTER: Vec3 = [64, PLATFORM_TOP + 1, 72];
/** Largest half-width the arena allows. */
export const PLATFORM_MAX_HALF = 21;
/**
 * Pedestal footprint (inclusive). Sized per level by setPlatformHalf(): a little
 * wider than the structure, so anything that topples goes over the edge.
 */
export const PLATFORM = { x0: 43, x1: 84, z0: 52, z1: 93, top: PLATFORM_TOP };

export function setPlatformHalf(halfX: number, halfZ: number): void {
  const hx = Math.max(4, Math.min(PLATFORM_MAX_HALF, Math.round(halfX)));
  const hz = Math.max(4, Math.min(PLATFORM_MAX_HALF, Math.round(halfZ)));
  PLATFORM.x0 = PLATFORM_CENTER[0] - hx;
  PLATFORM.x1 = PLATFORM_CENTER[0] + hx - 1;
  PLATFORM.z0 = PLATFORM_CENTER[2] - hz;
  PLATFORM.z1 = PLATFORM_CENTER[2] + hz - 1;
}
/** Anything whose centre drops below this line has left the platform for good. */
export const FALL_Y = PLATFORM.top - 2;

/** Cannon pivot (barrel hinge) in world space; the cannon faces +Z toward the pedestal. */
export const CANNON_PIVOT: Vec3 = [64, 7, 14];

export const GRAVITY = 60; // voxels / s²

// Palette slots. 1..7 are the engine effects' fire ramp (kept free for later).
export const SLOT = {
  EMPTY: 0,
  STONE: 8,
  TRIM: 9,
  PLINTH: 10,
  IRON: 11,
  WOOD: 12,
  BRASS: 13,
  WHEEL: 14,
  BALL: 16,
  DOT: 17,
  DUST0: 18, // 18..24 dust / smoke greys, light → dark
  DUST_N: 7,
  SPARK: 25,
  // Structure materials 32..
  WOOD_L: 32, WOOD_D: 33, BRICK: 34, BRICK_D: 35, STONE_L: 36, STONE_D: 37, ROOF: 38, GLASS: 39,
  PAINT_R: 40, PAINT_B: 41, PAINT_Y: 42, PAINT_G: 43, PAINT_W: 44, LEAF: 45, TRUNK: 46, SAND: 47,
  /** .vox levels get their own colours remapped from here up. */
  VOX_BASE: 128,
} as const;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];

const BASE_COLORS: Record<number, RGB> = {
  [SLOT.STONE]: hex("8d8578"), [SLOT.TRIM]: hex("b3aa98"), [SLOT.PLINTH]: hex("5e5a52"),
  [SLOT.IRON]: hex("3a3f47"), [SLOT.WOOD]: hex("7a4f2a"), [SLOT.BRASS]: hex("c9a24a"), [SLOT.WHEEL]: hex("2a2d33"),
  [SLOT.BALL]: hex("1c1e24"), [SLOT.DOT]: hex("f7a24a"), [SLOT.SPARK]: hex("ffd27a"),
  [SLOT.WOOD_L]: hex("c48a4f"), [SLOT.WOOD_D]: hex("8b5a2b"), [SLOT.BRICK]: hex("b5533a"), [SLOT.BRICK_D]: hex("8e3f2c"),
  [SLOT.STONE_L]: hex("b9b4a6"), [SLOT.STONE_D]: hex("7f7a6e"), [SLOT.ROOF]: hex("c9501b"), [SLOT.GLASS]: hex("9fd3e6"),
  [SLOT.PAINT_R]: hex("d9483b"), [SLOT.PAINT_B]: hex("3d6fd1"), [SLOT.PAINT_Y]: hex("f2c14e"), [SLOT.PAINT_G]: hex("5fae5a"),
  [SLOT.PAINT_W]: hex("f6f4ee"), [SLOT.LEAF]: hex("4f9a3f"), [SLOT.TRUNK]: hex("5c3d22"), [SLOT.SAND]: hex("e0c98f"),
};

/** 256 × RGBA floats. `extra` adds/overrides slots (used by .vox levels). */
export function buildPalette(extra: Map<number, RGB> = new Map()): Float32Array {
  const p = new Float32Array(256 * 4);
  const set = (slot: number, c: RGB) => p.set([c[0], c[1], c[2], 1], slot * 4);
  for (const [s, c] of Object.entries(BASE_COLORS)) set(Number(s), c);
  for (let i = 0; i < SLOT.DUST_N; i++) {
    const g = 0.78 - i * 0.07;
    set(SLOT.DUST0 + i, [g, g * 0.97, g * 0.92]);
  }
  for (const [s, c] of extra) set(s, c);
  return p;
}

/** The static plate: pedestal with a trim ring, and the cannon plinth. */
export function buildPlate(): Uint8Array {
  const d = new Uint8Array(VOLUME);
  const { x0, x1, z0, z1, top } = PLATFORM;
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++) {
      const edge = x === x0 || x === x1 || z === z0 || z === z1;
      for (let y = 0; y <= top; y++) {
        // Slight taper: the bottom two rows step out by one.
        d[idx(x, y, z)] = edge && (y === top || y < 2) ? SLOT.TRIM : SLOT.STONE;
      }
    }
  // Cannon plinth: 9×9 stone pad, 3 high, under the pivot.
  const [cx, , cz] = CANNON_PIVOT;
  for (let z = cz - 4; z <= cz + 4; z++)
    for (let x = cx - 4; x <= cx + 4; x++)
      for (let y = 0; y < 3; y++) d[idx(x, y, z)] = SLOT.PLINTH;
  return d;
}

/** True if a world position is over the pedestal footprint. */
export function overPlatform(x: number, z: number): boolean {
  return x >= PLATFORM.x0 && x < PLATFORM.x1 + 1 && z >= PLATFORM.z0 && z < PLATFORM.z1 + 1;
}
