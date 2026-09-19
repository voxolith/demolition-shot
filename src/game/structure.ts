// The destructible structure: a mask over the grid (1 = structure voxel) kept in
// sync with the stamper's base plate. Provides carving, and the connectivity
// analysis that turns unsupported parts into falling chunks.

import type { StampVoxel } from "@voxolith/renderer/core";
import { SIZE, VOLUME, idx, inGrid, PLATFORM } from "./world";

export interface Cell {
  x: number;
  y: number;
  z: number;
  c: number;
}

export interface Chunk {
  /** Voxels relative to the chunk's centre of mass (integer offsets). */
  local: Cell[];
  /** Centre of mass in world space. */
  com: [number, number, number];
}

/** Reads/writes the base plate; the game passes the GridStamper-backed one. */
export interface Plate {
  /** The flat base grid (pedestal + attached structure + rubble), for raycasts. */
  readonly data: Uint8Array;
  get(x: number, y: number, z: number): number;
  /** Permanently set cells (c = 0 carves). */
  write(voxels: StampVoxel[]): void;
}

const ORIGINAL = 1;
const RUBBLE = 2;

export class Structure {
  /** 0 empty, 1 original structure voxel, 2 settled rubble. Both support and can be knocked again. */
  readonly mask = new Uint8Array(VOLUME);
  /** Attached voxels of any kind (structure + settled rubble). */
  count = 0;
  /** Original voxels still standing; progress is 1 - standing / initial. */
  standing = 0;
  /** Voxels the level started with. */
  initial = 0;
  private readonly visited = new Uint8Array(VOLUME);
  private readonly queue = new Int32Array(VOLUME);

  constructor(private readonly plate: Plate) {}

  /** Place the level's voxels on the plate and record them as structure. */
  load(cells: Cell[]): void {
    this.mask.fill(0);
    this.count = 0;
    const out: StampVoxel[] = [];
    for (const v of cells) {
      if (!inGrid(v.x, v.y, v.z)) continue;
      const i = idx(v.x, v.y, v.z);
      if (this.mask[i]) continue;
      this.mask[i] = ORIGINAL;
      this.count++;
      out.push(v);
    }
    this.initial = this.count;
    this.standing = this.count;
    this.plate.write(out);
  }

  has(x: number, y: number, z: number): boolean {
    return inGrid(x, y, z) && this.mask[idx(x, y, z)] !== 0;
  }

  /** Fraction of the original structure that is no longer standing where it was built. */
  demolished(): number {
    return this.initial > 0 ? 1 - this.standing / this.initial : 0;
  }

  private drop(i: number): void {
    if (this.mask[i] === ORIGINAL) this.standing--;
    this.mask[i] = 0;
    this.count--;
  }

  /** Add settled rubble: becomes part of the structure (can support and be knocked off later). */
  addRubble(cells: Cell[]): number {
    const out: StampVoxel[] = [];
    for (const v of cells) {
      if (!inGrid(v.x, v.y, v.z)) continue;
      const i = idx(v.x, v.y, v.z);
      if (this.mask[i] || this.plate.get(v.x, v.y, v.z) !== 0) continue;
      this.mask[i] = RUBBLE;
      this.count++;
      out.push(v);
    }
    this.plate.write(out);
    return out.length;
  }

  /** Remove structure voxels within a sphere; returns them (with their colours). */
  carveSphere(cx: number, cy: number, cz: number, r: number): Cell[] {
    const removed: Cell[] = [];
    const r2 = r * r;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!inGrid(x, y, z)) continue;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          const i = idx(x, y, z);
          if (!this.mask[i]) continue;
          removed.push({ x, y, z, c: this.plate.get(x, y, z) });
          this.drop(i);
        }
    this.plate.write(removed.map((v) => ({ ...v, c: 0 })));
    return removed;
  }

  /**
   * Brittle fracture around a blast: voxels within `r` of the centre that have
   * two or fewer solid neighbours snap off. Ragged edges, and thin members near
   * a hit give way. Returns the removed cells.
   */
  fractureWeak(cx: number, cy: number, cz: number, r: number): Cell[] {
    const removed: Cell[] = [];
    const r2 = r * r;
    const { mask } = this;
    const sx = SIZE.x, sxy = SIZE.x * SIZE.y;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (!inGrid(x, y, z)) continue;
          const i = idx(x, y, z);
          if (!mask[i]) continue;
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          let n = 0;
          if (x > 0 && this.plate.data[i - 1]) n++;
          if (x < sx - 1 && this.plate.data[i + 1]) n++;
          if (y > 0 && this.plate.data[i - sx]) n++;
          if (y < SIZE.y - 1 && this.plate.data[i + sx]) n++;
          if (z > 0 && this.plate.data[i - sxy]) n++;
          if (z < SIZE.z - 1 && this.plate.data[i + sxy]) n++;
          if (n <= 2) removed.push({ x, y, z, c: this.plate.get(x, y, z) });
        }
    for (const v of removed) this.drop(idx(v.x, v.y, v.z));
    if (removed.length) this.plate.write(removed.map((v) => ({ ...v, c: 0 })));
    return removed;
  }

  /**
   * Impulse toppling. Find the connected piece nearest the blast and compare
   * the hit's momentum with how much of that piece actually rests on the
   * pedestal. A tall slab on a thin base tips over; a broad wall shrugs it off.
   * Returns the toppled piece as a chunk (already removed from the structure),
   * or null.
   */
  topple(cx: number, cy: number, cz: number, impulse: number, strength: number, seekR = 3): Chunk | null {
    // Seed: the nearest structure voxel within seekR of the blast centre.
    let seed = -1, best = Infinity;
    for (let z = Math.floor(cz - seekR); z <= Math.ceil(cz + seekR); z++)
      for (let y = Math.floor(cy - seekR); y <= Math.ceil(cy + seekR); y++)
        for (let x = Math.floor(cx - seekR); x <= Math.ceil(cx + seekR); x++) {
          if (!inGrid(x, y, z)) continue;
          const i = idx(x, y, z);
          if (!this.mask[i]) continue;
          const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 + (z + 0.5 - cz) ** 2;
          if (d < best) { best = d; seed = i; }
        }
    if (seed < 0) return null;
    const { visited, queue, mask } = this;
    visited.fill(0);
    let head = 0, tail = 0;
    visited[seed] = 1;
    queue[tail++] = seed;
    const sx = SIZE.x, sxy = SIZE.x * SIZE.y;
    const cells: Cell[] = [];
    let anchors = 0;
    const baseY = PLATFORM.top + 1;
    const push = (i: number) => { if (mask[i] && !visited[i]) { visited[i] = 1; queue[tail++] = i; } };
    while (head < tail) {
      const i = queue[head++];
      const x = i % sx, y = ((i / sx) | 0) % SIZE.y, z = (i / sxy) | 0;
      cells.push({ x, y, z, c: this.plate.get(x, y, z) });
      if (y === baseY) anchors++;
      if (x > 0) push(i - 1);
      if (x < sx - 1) push(i + 1);
      if (y > 0) push(i - sx);
      if (y < SIZE.y - 1) push(i + sx);
      if (z > 0) push(i - sxy);
      if (z < SIZE.z - 1) push(i + sxy);
      if (cells.length > 6000) return null; // too big to topple whole
    }
    if (anchors === 0) return null;
    // Leverage: tall pieces on small bases tip more easily.
    let maxY = 0, mass = cells.length;
    for (const c of cells) maxY = Math.max(maxY, c.y - baseY + 1);
    const lever = Math.max(1, maxY / Math.sqrt(anchors));
    if (impulse * lever < anchors * strength) return null;
    let mx = 0, my = 0, mz = 0;
    for (const c of cells) { mx += c.x + 0.5; my += c.y + 0.5; mz += c.z + 0.5; }
    const com: [number, number, number] = [mx / mass, my / mass, mz / mass];
    const ox = Math.round(com[0] - 0.5), oy = Math.round(com[1] - 0.5), oz = Math.round(com[2] - 0.5);
    const carve: StampVoxel[] = [];
    for (const c of cells) { this.drop(idx(c.x, c.y, c.z)); carve.push({ x: c.x, y: c.y, z: c.z, c: 0 }); }
    this.plate.write(carve);
    return { local: cells.map((c) => ({ x: c.x - ox, y: c.y - oy, z: c.z - oz, c: c.c })), com: [ox + 0.5, oy + 0.5, oz + 0.5] };
  }

  /**
   * Flood from the anchors (structure voxels resting on the pedestal top) through
   * 6-connected structure voxels. Everything unreached is detached: removed from
   * the structure and returned as chunks (connected components), each with a
   * centre of mass.
   */
  detachUnsupported(): Chunk[] {
    const { visited, queue, mask } = this;
    visited.fill(0);
    let head = 0, tail = 0;
    const baseY = PLATFORM.top + 1;
    for (let z = PLATFORM.z0; z <= PLATFORM.z1; z++)
      for (let x = PLATFORM.x0; x <= PLATFORM.x1; x++) {
        const i = idx(x, baseY, z);
        if (mask[i]) {
          visited[i] = 1;
          queue[tail++] = i;
        }
      }
    const sx = SIZE.x, sxy = SIZE.x * SIZE.y;
    const push = (i: number) => {
      if (mask[i] && !visited[i]) {
        visited[i] = 1;
        queue[tail++] = i;
      }
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % sx, y = ((i / sx) | 0) % SIZE.y, z = (i / sxy) | 0;
      if (x > 0) push(i - 1);
      if (x < sx - 1) push(i + 1);
      if (y > 0) push(i - sx);
      if (y < SIZE.y - 1) push(i + sx);
      if (z > 0) push(i - sxy);
      if (z < SIZE.z - 1) push(i + sxy);
    }

    // Group the unreached voxels into components.
    const chunks: Chunk[] = [];
    const carve: StampVoxel[] = [];
    for (let i = 0; i < VOLUME; i++) {
      if (!mask[i] || visited[i]) continue;
      const cells: Cell[] = [];
      visited[i] = 1;
      head = 0; tail = 0;
      queue[tail++] = i;
      while (head < tail) {
        const j = queue[head++];
        const x = j % sx, y = ((j / sx) | 0) % SIZE.y, z = (j / sxy) | 0;
        cells.push({ x, y, z, c: this.plate.get(x, y, z) });
        if (x > 0) push(j - 1);
        if (x < sx - 1) push(j + 1);
        if (y > 0) push(j - sx);
        if (y < SIZE.y - 1) push(j + sx);
        if (z > 0) push(j - sxy);
        if (z < SIZE.z - 1) push(j + sxy);
      }
      let mx = 0, my = 0, mz = 0;
      for (const c of cells) { mx += c.x + 0.5; my += c.y + 0.5; mz += c.z + 0.5; }
      const n = cells.length;
      const com: [number, number, number] = [mx / n, my / n, mz / n];
      const ox = Math.round(com[0] - 0.5), oy = Math.round(com[1] - 0.5), oz = Math.round(com[2] - 0.5);
      for (const c of cells) {
        this.drop(idx(c.x, c.y, c.z));
        carve.push({ x: c.x, y: c.y, z: c.z, c: 0 });
      }
      chunks.push({ local: cells.map((c) => ({ x: c.x - ox, y: c.y - oy, z: c.z - oz, c: c.c })), com: [ox + 0.5, oy + 0.5, oz + 0.5] });
    }
    if (carve.length) this.plate.write(carve);
    return chunks;
  }
}
