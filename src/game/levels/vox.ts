// Author levels in the Voxolith Editor (or MagicaVoxel): any .vox becomes a
// level. The model is Z-up; we convert to Y-up, centre it on the pedestal, and
// remap its palette into the slots above SLOT.VOX_BASE.

import { parseVox } from "@voxolith/renderer/vox";
import { SLOT } from "../world";
import type { Cell } from "../structure";
import type { Level, Built } from "./types";

export function buildFromVox(buffer: ArrayBuffer): Built {
  const m = parseVox(buffer);
  const cells: Cell[] = [];
  const palette = new Map<number, [number, number, number]>();
  const slotFor = new Map<number, number>();
  let next = SLOT.VOX_BASE;
  // Occupied box for centring.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const v of m.voxels) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.y); maxZ = Math.max(maxZ, v.y); // model y → world z
    minY = Math.min(minY, v.z); // model z → world y
  }
  const cx = Math.round((minX + maxX) / 2), cz = Math.round((minZ + maxZ) / 2);
  for (const v of m.voxels) {
    let slot = slotFor.get(v.c);
    if (slot === undefined) {
      slot = next < 256 ? next++ : SLOT.STONE_L;
      slotFor.set(v.c, slot);
      palette.set(slot, [m.palette[v.c * 4] / 255, m.palette[v.c * 4 + 1] / 255, m.palette[v.c * 4 + 2] / 255]);
    }
    cells.push({ x: v.x - cx, y: v.z - minY, z: v.y - cz, c: slot });
  }
  return { cells, palette };
}

export function levelFromVox(buffer: ArrayBuffer, name: string, balls = 3, target = 0.5): Level {
  const built = buildFromVox(buffer);
  return { id: `vox:${name}`, name, balls, target, hint: "Custom .vox level", build: () => built };
}
