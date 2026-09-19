import type { Cell } from "../structure";

/** Structure voxels in local space: x/z centred on 0, y from 0 (resting on the pedestal). */
export interface Built {
  cells: Cell[];
  /** Extra palette slots for .vox levels (slot → rgb 0..1). */
  palette?: Map<number, [number, number, number]>;
}

export interface Level {
  id: string;
  name: string;
  /** Cannonballs available. */
  balls: number;
  /** Fraction of the structure that must leave the platform. */
  target: number;
  /** Short hint shown on the level card. */
  hint: string;
  /** Extra pedestal width around the structure's footprint (default 3). */
  pedestalMargin?: number;
  build(rng: () => number): Built;
}

/** Fill an inclusive box; `hollow` keeps only the shell. */
export function box(cells: Cell[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number | ((x: number, y: number, z: number) => number), hollow = false): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (hollow && x !== x0 && x !== x1 && z !== z0 && z !== z1 && y !== y0 && y !== y1) continue;
        cells.push({ x, y, z, c: typeof c === "function" ? c(x, y, z) : c });
      }
}

/** Vertical cylinder (radius r) centred on cx/cz. */
export function cylinder(cells: Cell[], cx: number, cz: number, y0: number, y1: number, r: number, c: number | ((x: number, y: number, z: number) => number), hollow = false): void {
  const R = Math.ceil(r);
  for (let z = -R; z <= R; z++)
    for (let x = -R; x <= R; x++) {
      const d2 = x * x + z * z;
      if (d2 > r * r) continue;
      if (hollow && d2 < (r - 1) * (r - 1)) continue;
      for (let y = y0; y <= y1; y++) cells.push({ x: cx + x, y, z: cz + z, c: typeof c === "function" ? c(cx + x, y, cz + z) : c });
    }
}

/** Alternate two slots by parity for a brick/plank look. */
export const alt = (a: number, b: number) => (x: number, y: number, z: number) => ((x + z + (y >> 1)) & 1 ? a : b);
export const rows = (a: number, b: number) => (_x: number, y: number) => (y & 1 ? a : b);
