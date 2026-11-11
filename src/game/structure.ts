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

// Marks in `visited` during a connectivity pass; it is all zero between calls.
/** Reached by the flood in progress. */
const SEEN = 1;
/** Known to reach an anchor. */
const SUPPORTED = 2;
/** Already put in a chunk. */
const DONE = 3;

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
  /**
   * Voxels whose support may have changed since the last detachUnsupported():
   * those added, and the neighbours of those removed. May hold duplicates and
   * voxels that have gone since.
   */
  private readonly pending: number[] = [];

  constructor(private readonly plate: Plate) {}

  /** Place the level's voxels on the plate and record them as structure. */
  load(cells: Cell[]): void {
    this.mask.fill(0);
    this.count = 0;
    this.pending.length = 0;
    const out: StampVoxel[] = [];
    for (const v of cells) {
      if (!inGrid(v.x, v.y, v.z)) continue;
      const i = idx(v.x, v.y, v.z);
      if (this.mask[i]) continue;
      this.mask[i] = ORIGINAL;
      this.pending.push(i);
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
    const { mask, pending } = this;
    if (mask[i] === ORIGINAL) this.standing--;
    mask[i] = 0;
    this.count--;
    // Its neighbours may have rested on it.
    const sx = SIZE.x, sxy = SIZE.x * SIZE.y;
    const x = i % sx, y = ((i / sx) | 0) % SIZE.y, z = (i / sxy) | 0;
    if (x > 0 && mask[i - 1]) pending.push(i - 1);
    if (x < sx - 1 && mask[i + 1]) pending.push(i + 1);
    if (y > 0 && mask[i - sx]) pending.push(i - sx);
    if (y < SIZE.y - 1 && mask[i + sx]) pending.push(i + sx);
    if (z > 0 && mask[i - sxy]) pending.push(i - sxy);
    if (z < SIZE.z - 1 && mask[i + sxy]) pending.push(i + sxy);
  }

  /** Add settled rubble: becomes part of the structure (can support and be knocked off later). */
  addRubble(cells: Cell[]): number {
    const out: StampVoxel[] = [];
    for (const v of cells) {
      if (!inGrid(v.x, v.y, v.z)) continue;
      const i = idx(v.x, v.y, v.z);
      if (this.mask[i] || this.plate.get(v.x, v.y, v.z) !== 0) continue;
      this.mask[i] = RUBBLE;
      this.pending.push(i);
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
    // Flood the piece. `visited` is wiped through the queue afterwards (it is all
    // zero between calls), not with a fill of the whole grid.
    const { visited, queue, mask } = this;
    let head = 0, tail = 0;
    visited[seed] = SEEN;
    queue[tail++] = seed;
    const sx = SIZE.x, sxy = SIZE.x * SIZE.y;
    const cells: Cell[] = [];
    let anchors = 0;
    const baseY = PLATFORM.top + 1;
    const push = (i: number) => { if (mask[i] && !visited[i]) { visited[i] = SEEN; queue[tail++] = i; } };
    while (head < tail && cells.length <= 6000) {
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
    }
    for (let q = 0; q < tail; q++) visited[queue[q]] = 0;
    if (cells.length > 6000) return null; // too big to topple whole
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
   * Find what no longer rests on the pedestal. Anchors are the structure voxels on
   * the pedestal top; everything not 6-connected to one is detached: removed from
   * the structure and returned as chunks (connected components), each with a
   * centre of mass.
   *
   * Only the voxels changed since the last call can have come loose: a piece that
   * was supported and is not any more lost a voxel on its path to an anchor, so it
   * holds a neighbour of a removed voxel, and a piece that never was holds a voxel
   * added since (`pending` collects both). Each of those is flooded until it meets
   * an anchor or a voxel already known to be supported, so the cost follows the
   * structure around the change rather than the grid, and a carve that removed
   * nothing costs nothing. The chunks, their order and their voxel order are those
   * of a scan of the whole grid (tools/verify.ts compares the two).
   */
  detachUnsupported(): Chunk[] {
    const { pending } = this;
    if (pending.length === 0) return [];
    const { visited, queue, mask } = this;
    const sx = SIZE.x, sy = SIZE.y, sz = SIZE.z, sxy = sx * sy;
    const baseY = PLATFORM.top + 1;
    const { x0, x1, z0, z1 } = PLATFORM;
    // `queue` holds every voxel marked in this call, one flood after another, so
    // `visited` can be wiped through it at the end instead of with a full fill.
    let tail = 0;
    /** Start of each unsupported component's run in `queue`, and its end. */
    const loose: number[] = [];
    for (let k = 0; k < pending.length; k++) {
      const seed = pending[k];
      if (!mask[seed] || visited[seed]) continue;
      const start = tail;
      let head = tail, supported = false;
      visited[seed] = SEEN;
      queue[tail++] = seed;
      const push = (i: number) => {
        const v = visited[i];
        if (v === SUPPORTED) supported = true;
        else if (mask[i] && !v) {
          visited[i] = SEEN;
          queue[tail++] = i;
        }
      };
      while (head < tail && !supported) {
        const i = queue[head++];
        const x = i % sx, y = ((i / sx) | 0) % sy, z = (i / sxy) | 0;
        if (y === baseY && x >= x0 && x <= x1 && z >= z0 && z <= z1) {
          supported = true;
          break;
        }
        if (x > 0) push(i - 1);
        if (x < sx - 1) push(i + 1);
        if (y > 0) push(i - sx);
        if (y < sy - 1) push(i + sx);
        if (z > 0) push(i - sxy);
        if (z < sz - 1) push(i + sxy);
      }
      if (supported) for (let q = start; q < tail; q++) visited[queue[q]] = SUPPORTED;
      else loose.push(start, tail); // ran out without an anchor: the whole component
    }
    pending.length = 0;

    // The full scan met each component at its lowest index, in index order.
    const order: { first: number; start: number; end: number }[] = [];
    for (let k = 0; k < loose.length; k += 2) {
      const start = loose[k], end = loose[k + 1];
      let first = queue[start];
      for (let q = start + 1; q < end; q++) if (queue[q] < first) first = queue[q];
      order.push({ first, start, end });
    }
    order.sort((a, b) => a.first - b.first);

    const chunks: Chunk[] = [];
    const carve: StampVoxel[] = [];
    for (const { first, start, end } of order) {
      // Flood the component again from that voxel, for the scan's voxel order. It
      // visits the same voxels, so it can reuse the component's run of the queue.
      const cells: Cell[] = [];
      let head = start, t = start;
      visited[first] = DONE;
      queue[t++] = first;
      const push = (i: number) => {
        if (visited[i] === SEEN) {
          visited[i] = DONE;
          queue[t++] = i;
        }
      };
      while (head < t) {
        const j = queue[head++];
        const x = j % sx, y = ((j / sx) | 0) % sy, z = (j / sxy) | 0;
        cells.push({ x, y, z, c: this.plate.get(x, y, z) });
        if (x > 0) push(j - 1);
        if (x < sx - 1) push(j + 1);
        if (y > 0) push(j - sx);
        if (y < sy - 1) push(j + sx);
        if (z > 0) push(j - sxy);
        if (z < sz - 1) push(j + sxy);
      }
      if (t !== end) throw new Error("detachUnsupported: component changed between floods");
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
    for (let q = 0; q < tail; q++) visited[queue[q]] = 0;
    // Whole components left, so nothing next to them is still standing.
    pending.length = 0;
    if (carve.length) this.plate.write(carve);
    return chunks;
  }
}
