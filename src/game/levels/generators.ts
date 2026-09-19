// The 12 built-in levels. Each generator returns voxels in local space (x/z
// centred, y from 0). Seeded RNG gives small variations per attempt.

import { SLOT } from "../world";
import type { Cell } from "../structure";
import { box, cylinder, alt, rows, type Level } from "./types";

const S = SLOT;

const tower: Level = {
  id: "tower", name: "Tower", balls: 3, target: 0.7, hint: "Aim low. Towers topple.",
  build(rng) {
    const c: Cell[] = [];
    const h = 20 + Math.floor(rng() * 4);
    box(c, -2, 0, -2, 2, h, 2, alt(S.BRICK, S.BRICK_D));
    box(c, -3, h + 1, -3, 3, h + 1, 3, S.STONE_L);
    box(c, -1, h + 2, -1, 1, h + 4, 1, S.ROOF);
    return { cells: c };
  },
};

const hut: Level = {
  id: "hut", name: "Hut", balls: 3, target: 0.45, hint: "Knock the walls out from under the roof.",
  build(rng) {
    const c: Cell[] = [];
    const w = 6 + Math.floor(rng() * 2);
    box(c, -w, 0, -w, w, 7, w, alt(S.WOOD_L, S.WOOD_D), true);
    // Door and window openings.
    const cells = c.filter((v) => !(v.z === -w && Math.abs(v.x) <= 1 && v.y <= 4) && !(v.x === w && Math.abs(v.z) <= 1 && v.y >= 2 && v.y <= 4));
    // Pitched roof.
    for (let i = 0; i <= w + 1; i++) {
      const y = 8 + i;
      const half = w + 1 - i;
      if (half < 0) break;
      for (let z = -w - 1; z <= w + 1; z++) {
        cells.push({ x: -half, y, z, c: S.ROOF });
        cells.push({ x: half, y, z, c: S.ROOF });
      }
    }
    return { cells };
  },
};

const totem: Level = {
  id: "totem", name: "Totem", balls: 2, target: 0.65, hint: "The neck is thin.",
  build(rng) {
    const c: Cell[] = [];
    const paints = [S.PAINT_R, S.PAINT_B, S.PAINT_Y, S.PAINT_G];
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const p = paints[(i + Math.floor(rng() * 4)) % 4];
      box(c, -3, y, -3, 3, y + 4, 3, p);
      // Eyes and beak on the -Z face.
      c.push({ x: -1, y: y + 3, z: -4, c: S.PAINT_W }, { x: 1, y: y + 3, z: -4, c: S.PAINT_W }, { x: 0, y: y + 1, z: -4, c: S.WOOD_D });
      y += 5;
      // Thin neck between heads.
      box(c, -1, y, -1, 1, y + 1, 1, S.WOOD_D);
      y += 2;
    }
    // Wings on the top head.
    box(c, -8, y - 4, -1, -4, y - 3, 1, S.WOOD_L);
    box(c, 4, y - 4, -1, 8, y - 3, 1, S.WOOD_L);
    return { cells: c };
  },
};

const arch: Level = {
  id: "arch", name: "Arch", balls: 3, target: 0.5, hint: "Take a pillar, the span follows.",
  build(rng) {
    const c: Cell[] = [];
    const span = 9 + Math.floor(rng() * 3);
    box(c, -span - 2, 0, -2, -span + 1, 13, 2, alt(S.STONE_L, S.STONE_D));
    box(c, span - 1, 0, -2, span + 2, 13, 2, alt(S.STONE_L, S.STONE_D));
    box(c, -span - 2, 14, -2, span + 2, 16, 2, S.STONE_D);
    box(c, -span - 3, 17, -3, span + 3, 17, 3, S.STONE_L);
    box(c, -2, 18, -2, 2, 21, 2, S.PAINT_R);
    return { cells: c };
  },
};

const twinTowers: Level = {
  id: "twin-towers", name: "Twin Towers", balls: 3, target: 0.5, hint: "The bridge holds them together.",
  build(rng) {
    const c: Cell[] = [];
    const gap = 8 + Math.floor(rng() * 3);
    for (const sx of [-gap, gap]) {
      box(c, sx - 2, 0, -2, sx + 2, 17, 2, alt(S.BRICK, S.BRICK_D));
      box(c, sx - 3, 18, -3, sx + 3, 18, 3, S.STONE_L);
    }
    box(c, -gap + 3, 12, -1, gap - 3, 13, 1, S.WOOD_L);
    return { cells: c };
  },
};

const pyramid: Level = {
  id: "pyramid", name: "Pyramid", balls: 3, target: 0.3, hint: "Heavy base. Hit the tip.",
  build(rng) {
    const c: Cell[] = [];
    const n = 9 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const half = n - 1 - i;
      box(c, -half, i * 2, -half, half, i * 2 + 1, half, i & 1 ? S.SAND : S.STONE_L, i > 0);
    }
    box(c, 0, n * 2, 0, 0, n * 2 + 1, 0, S.BRASS);
    return { cells: c };
  },
};

const dominoes: Level = {
  id: "dominoes", name: "Dominoes", balls: 3, target: 0.4, hint: "One push, many falls.",
  build(rng) {
    const c: Cell[] = [];
    const n = 6 + Math.floor(rng() * 2);
    const step = 5;
    // A row running away from the cannon; each slab faces it.
    for (let i = 0; i < n; i++) {
      const z = Math.round(-((n - 1) * step) / 2 + i * step);
      box(c, -4, 0, z, 4, 15, z + 1, i & 1 ? S.PAINT_B : S.PAINT_W);
    }
    return { cells: c };
  },
};

const chimney: Level = {
  id: "chimney", name: "Chimney", balls: 2, target: 0.7, hint: "Tall, hollow, brittle.",
  build(rng) {
    const c: Cell[] = [];
    const h = 26 + Math.floor(rng() * 4);
    cylinder(c, 0, 0, 0, h, 4.5, rows(S.BRICK, S.BRICK_D), true);
    cylinder(c, 0, 0, h + 1, h + 2, 5.5, S.STONE_D, true);
    return { cells: c };
  },
};

const castleWall: Level = {
  id: "castle-wall", name: "Castle Wall", balls: 3, target: 0.3, hint: "Mind the gate.",
  build(rng) {
    const c: Cell[] = [];
    const w = 11 + Math.floor(rng() * 3);
    box(c, -w, 0, -1, w, 10, 1, alt(S.STONE_L, S.STONE_D));
    // Gate opening.
    const cells = c.filter((v) => !(Math.abs(v.x) <= 2 && v.y <= 6));
    // Crenellations.
    for (let x = -w; x <= w; x += 2) box(cells, x, 11, -1, x, 12, 1, S.STONE_D);
    // Corner towers.
    for (const sx of [-w - 2, w + 2]) cylinder(cells, sx, 0, 0, 14, 2.5, rows(S.STONE_L, S.STONE_D));
    return { cells };
  },
};

const bridge: Level = {
  id: "bridge", name: "Bridge", balls: 2, target: 0.65, hint: "Kick the stilts.",
  build(rng) {
    const c: Cell[] = [];
    const n = 4 + Math.floor(rng() * 2);
    const span = 22;
    for (let i = 0; i < n; i++) {
      const x = Math.round(-span / 2 + (span / (n - 1)) * i);
      box(c, x, 0, -1, x, 11, -1, S.TRUNK);
      box(c, x, 0, 1, x, 11, 1, S.TRUNK);
    }
    box(c, -span / 2 - 1, 12, -2, span / 2 + 1, 12, 2, alt(S.WOOD_L, S.WOOD_D));
    box(c, -span / 2 - 1, 13, -2, span / 2 + 1, 14, -2, S.WOOD_D);
    box(c, -span / 2 - 1, 13, 2, span / 2 + 1, 14, 2, S.WOOD_D);
    return { cells: c };
  },
};

const temple: Level = {
  id: "temple", name: "Temple", balls: 2, target: 0.6, hint: "Columns carry the slab.",
  build(rng) {
    const c: Cell[] = [];
    const cols = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < cols; i++)
      for (const z of [-6, 6]) {
        const x = Math.round(-9 + (18 / (cols - 1)) * i);
        cylinder(c, x, z, 0, 12, 1.25, S.PAINT_W);
        box(c, x - 2, 12, z - 2, x + 2, 12, z + 2, S.STONE_L); // capital
      }
    box(c, -12, 13, -8, 12, 14, 8, S.STONE_D);
    for (let i = 0; i < 5; i++) box(c, -12, 15 + i, -8 + i * 2, 12, 15 + i, 8 - i * 2, S.ROOF);
    return { cells: c };
  },
};

const treehouse: Level = {
  id: "treehouse", name: "Treehouse", balls: 2, target: 0.75, hint: "Everything rests on one trunk.",
  build(rng) {
    const c: Cell[] = [];
    const h = 12 + Math.floor(rng() * 3);
    cylinder(c, 0, 0, 0, h, 1.7, S.TRUNK);
    box(c, -7, h + 1, -7, 7, h + 1, 7, alt(S.WOOD_L, S.WOOD_D));
    box(c, -5, h + 2, -5, 5, h + 7, 5, S.WOOD_L, true);
    box(c, -8, h + 8, -8, 8, h + 10, 8, S.LEAF, true);
    box(c, -6, h + 11, -6, 6, h + 12, 6, S.LEAF, true);
    return { cells: c };
  },
};

export const LEVELS: Level[] = [tower, hut, totem, arch, twinTowers, pyramid, dominoes, chimney, castleWall, bridge, temple, treehouse];
