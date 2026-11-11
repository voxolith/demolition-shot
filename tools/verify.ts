// Headless checks for the demolition simulation: runs with `bun tools/verify.ts`,
// no GPU. Exits non-zero on the first failed assertion.

import { BrickGrid, GridStamper, seededRandom, type DirtyBox, type StampVoxel } from "@voxolith/renderer/core";
import { Game } from "../src/game/game";
import { LEVELS } from "../src/game/levels";
import { Structure, type Cell, type Chunk, type Plate } from "../src/game/structure";
import { stars, isWin } from "../src/game/scoring";
import { PLATFORM, PLATFORM_CENTER, SIZE, VOLUME, buildPlate, idx } from "../src/game/world";

let failures = 0;
function ok(cond: boolean, msg: string): void {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.error(`  ✗ ${msg}`);
    failures++;
  }
}

console.log("levels:");
for (const L of LEVELS) {
  const built = L.build(() => 0.5);
  const half = (PLATFORM.x1 - PLATFORM.x0 + 1) / 2;
  const inside = built.cells.every((c) => Math.abs(c.x) < half - 2 && Math.abs(c.z) < half - 2 && c.y >= 0 && c.y + PLATFORM.top + 1 < SIZE.y);
  ok(built.cells.length > 50, `${L.name}: ${built.cells.length} voxels`);
  ok(inside, `${L.name}: fits on the pedestal`);
  ok(L.target > 0 && L.target <= 1 && L.balls >= 1, `${L.name}: target ${Math.round(L.target * 100)}%, ${L.balls} balls`);
}

console.log("connectivity:");
{
  const base = buildPlate();
  const stamper = new GridStamper(base, SIZE);
  const plate = {
    data: base,
    get: (x: number, y: number, z: number) => stamper.baseAt(x, y, z),
    write: (v: Cell[]) => void stamper.writeBase(v),
  };
  const s = new Structure(plate);
  const [cx, cy, cz] = PLATFORM_CENTER.map(Math.floor);
  const cells: Cell[] = [];
  for (let y = 0; y < 12; y++) cells.push({ x: cx, y: cy + y, z: cz, c: 34 });
  s.load(cells);
  ok(s.initial === 12 && s.count === 12, "tower of 12 loads");
  ok(s.detachUnsupported().length === 0, "intact tower has nothing unsupported");
  const removed = s.carveSphere(cx + 0.5, cy + 5.5, cz + 0.5, 0.9);
  ok(removed.length === 1, `carving the middle removes 1 voxel (got ${removed.length})`);
  const chunks = s.detachUnsupported();
  ok(chunks.length === 1 && chunks[0].local.length === 6, `top 6 voxels detach as one chunk (got ${chunks.length} chunk(s), ${chunks[0]?.local.length} voxels)`);
  ok(s.count === 5, `5 voxels remain attached (got ${s.count})`);
  ok(plate.get(cx, cy + 9, cz) === 0, "detached voxels are carved from the plate");
}

/**
 * The reference for Structure.detachUnsupported(): the scan it replaced. Flood
 * from every anchor, then walk the whole grid for what was not reached. Changes
 * nothing; returns the chunks the structure should detach.
 */
const refVisited = new Uint8Array(VOLUME);
const refQueue = new Int32Array(VOLUME);
function fullScanChunks(mask: Uint8Array, plate: Plate): Chunk[] {
  const visited = refVisited, queue = refQueue;
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
  const chunks: Chunk[] = [];
  for (let i = 0; i < VOLUME; i++) {
    if (!mask[i] || visited[i]) continue;
    const cells: Cell[] = [];
    visited[i] = 1;
    head = 0; tail = 0;
    queue[tail++] = i;
    while (head < tail) {
      const j = queue[head++];
      const x = j % sx, y = ((j / sx) | 0) % SIZE.y, z = (j / sxy) | 0;
      cells.push({ x, y, z, c: plate.get(x, y, z) });
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
    const ox = Math.round(mx / n - 0.5), oy = Math.round(my / n - 0.5), oz = Math.round(mz / n - 0.5);
    chunks.push({ local: cells.map((c) => ({ x: c.x - ox, y: c.y - oy, z: c.z - oz, c: c.c })), com: [ox + 0.5, oy + 0.5, oz + 0.5] });
  }
  return chunks;
}

/** Chunks, their order and their voxel order all equal. */
function sameChunks(a: Chunk[], b: Chunk[]): boolean {
  if (a.length !== b.length) return false;
  for (let k = 0; k < a.length; k++) {
    const p = a[k], q = b[k];
    if (p.local.length !== q.local.length || p.com[0] !== q.com[0] || p.com[1] !== q.com[1] || p.com[2] !== q.com[2]) return false;
    for (let i = 0; i < p.local.length; i++) {
      const u = p.local[i], v = q.local[i];
      if (u.x !== v.x || u.y !== v.y || u.z !== v.z || u.c !== v.c) return false;
    }
  }
  return true;
}

/**
 * Make every detachUnsupported() of `s` check itself against the full scan:
 * same chunks, and exactly their voxels gone from the mask afterwards.
 */
function checkDetach(s: Structure, plate: Plate) {
  const stat = { calls: 0, withChunks: 0, chunks: 0, bad: 0, scanMs: 0, newMs: 0 };
  const real = s.detachUnsupported.bind(s);
  const expectMask = new Uint8Array(VOLUME);
  s.detachUnsupported = () => {
    let t = performance.now();
    const want = fullScanChunks(s.mask, plate);
    stat.scanMs += performance.now() - t;
    expectMask.set(s.mask);
    for (const ch of want) {
      const ox = ch.com[0] - 0.5, oy = ch.com[1] - 0.5, oz = ch.com[2] - 0.5;
      for (const c of ch.local) expectMask[idx(c.x + ox, c.y + oy, c.z + oz)] = 0;
    }
    t = performance.now();
    const got = real();
    stat.newMs += performance.now() - t;
    stat.calls++;
    if (got.length) stat.withChunks++;
    stat.chunks += got.length;
    if (!sameChunks(got, want) || !Buffer.from(s.mask.buffer).equals(Buffer.from(expectMask.buffer))) stat.bad++;
    return got;
  };
  return stat;
}
type DetachStat = ReturnType<typeof checkDetach>;
const detachLine = (st: DetachStat) =>
  `${st.calls} carves, ${st.withChunks} detached something (${st.chunks} chunks); full scan ${(st.scanMs / st.calls).toFixed(3)} ms a carve, now ${(st.newMs / st.calls).toFixed(4)} ms`;

console.log("connectivity against the full scan (random carves):");
{
  const total = { calls: 0, withChunks: 0, chunks: 0, bad: 0, scanMs: 0, newMs: 0 };
  for (const L of LEVELS) {
    const g = new Game();
    g.loadLevel(L, 0);
    const s = g.structure;
    const st = checkDetach(s, g.plate);
    const rng = seededRandom(7);
    const [cx, cy, cz] = PLATFORM_CENTER;
    const at = (): [number, number, number] => [cx + (rng() - 0.5) * 36, cy + rng() * 44, cz + (rng() - 0.5) * 36];
    for (let k = 0; k < 30; k++) {
      const [x, y, z] = at();
      const pick = rng();
      if (pick < 0.5) s.carveSphere(x, y, z, 1 + rng() * 3);
      else if (pick < 0.65) s.fractureWeak(x, y, z, 2 + rng() * 4);
      else if (pick < 0.8) s.topple(x, y, z, 40 + rng() * 80, 8, 4);
      // Rubble, resting on something or not: a floating piece must come off again.
      else s.addRubble([0, 1, 2].map((d) => ({ x: Math.floor(x) + d, y: Math.floor(y), z: Math.floor(z), c: 34 })));
      s.detachUnsupported();
      if (rng() < 0.3) s.detachUnsupported(); // nothing changed in between
    }
    for (const k of ["calls", "withChunks", "chunks", "bad", "scanMs", "newMs"] as const) total[k] += st[k];
  }
  console.log(`    ${detachLine(total)}`);
  ok(total.bad === 0, `every carve detaches what the full scan does (${total.bad} differ)`);
  ok(total.withChunks > 25, `the carves detach pieces (${total.withChunks})`);
}

console.log("shots on every level, against the full scan and GridStamper:");
{
  const union = (a: DirtyBox | null, b: DirtyBox | null): DirtyBox | null =>
    !a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), z1: Math.max(a.z1, b.z1) };
  const SX = SIZE.x, SXY = SIZE.x * SIZE.y;
  const total = { calls: 0, withChunks: 0, chunks: 0, bad: 0, scanMs: 0, newMs: 0 };
  let frames = 0, liveDiffers = 0, stale = 0, outcomes = 0;
  let boxBricks = 0, boxMax = 0, listBricks = 0, listMax = 0, boxMs = 0, listMs = 0;
  for (const L of LEVELS) {
    // `a` is the game as it was: every mover through GridStamper.stamp, one box a frame.
    // `b` composes with Game.composite. Both play the same shot.
    const a = new Game(), b = new Game();
    a.loadLevel(L, 0);
    b.loadLevel(L, 0);
    const st = checkDetach(b.structure, b.plate);
    let baseBox: DirtyBox | null = null;
    const write = a.plate.write;
    a.plate.write = (voxels: StampVoxel[]) => {
      for (const v of voxels) baseBox = union(baseBox, { x0: v.x, y0: v.y, z0: v.z, x1: v.x, y1: v.y, z1: v.z });
      write(voxels);
    };
    const liveA = a.stamper.liveData, liveB = b.stamper.liveData;
    // What a renderer fed only the reported bricks would hold, and the renderer's own brick form of each.
    const shown = liveB.slice();
    const bytesA = Buffer.from(liveA.buffer), bytesB = Buffer.from(liveB.buffer), bytesShown = Buffer.from(shown.buffer);
    const gridA = new BrickGrid(SIZE, liveA), gridB = new BrickGrid(SIZE, liveB);
    const fromLive = (cells: Uint8Array, ox: number, oy: number, oz: number): boolean => {
      for (let lz = 0, o = 0; lz < 8; lz++)
        for (let ly = 0; ly < 8; ly++) for (let lx = 0, row = ox + (oy + ly) * SX + (oz + lz) * SXY; lx < 8; lx++, o++) cells[o] = liveB[row + lx];
      return true;
    };
    const movers: StampVoxel[] = [];
    const frame = () => {
      a.step(1 / 60);
      b.step(1 / 60);
      let t = performance.now();
      movers.length = 0;
      a.movers(movers);
      const dirty = union(a.stamper.stamp(movers), baseBox);
      baseBox = null;
      if (dirty) gridA.rebuildBox(liveA, dirty);
      boxMs += performance.now() - t;
      t = performance.now();
      const boxes = b.composite();
      for (const box of boxes) gridB.editBox(box, fromLive);
      listMs += performance.now() - t;

      const n = dirty ? ((dirty.x1 >> 3) - (dirty.x0 >> 3) + 1) * ((dirty.y1 >> 3) - (dirty.y0 >> 3) + 1) * ((dirty.z1 >> 3) - (dirty.z0 >> 3) + 1) : 0;
      boxBricks += n;
      boxMax = Math.max(boxMax, n);
      listBricks += boxes.length;
      listMax = Math.max(listMax, boxes.length);
      for (const { x0, y0, z0, x1, y1, z1 } of boxes)
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) shown.set(liveB.subarray(x0 + y * SX + z * SXY, x1 + 1 + y * SX + z * SXY), x0 + y * SX + z * SXY);
      if (!bytesB.equals(bytesA)) liveDiffers++;
      if (!bytesB.equals(bytesShown)) stale++;
      frames++;
    };
    for (const g of [a, b]) {
      g.beginAim();
      g.updateAim({ yawDeg: 3, pitchDeg: 30, power: 0.7 }); // the barrel swings: the cannon is restamped
    }
    frame();
    for (const g of [a, b]) {
      g.updateAim({ yawDeg: 0, pitchDeg: 34, power: 0.75 });
      g.fire();
    }
    let guard = 0;
    while ((b.phase === "flying" || b.phase === "settling" || b.vfx.active) && guard++ < 1200) frame();
    if (a.phase === b.phase && a.sim.knockedOff === b.sim.knockedOff && a.structure.standing === b.structure.standing && a.structure.count === b.structure.count) outcomes++;
    for (const k of ["calls", "withChunks", "chunks", "bad", "scanMs", "newMs"] as const) total[k] += st[k];
  }
  console.log(`    ${detachLine(total)}`);
  console.log(
    `    ${frames} frames; bricks rebuilt a frame: one box ${(boxBricks / frames).toFixed(0)} (max ${boxMax}), composite ${(listBricks / frames).toFixed(0)} (max ${listMax}); stamp + brick rebuild: ${(boxMs / frames).toFixed(3)} ms a frame, now ${(listMs / frames).toFixed(3)} ms`,
  );
  ok(total.bad === 0, `every carve in play detaches what the full scan does (${total.bad} differ)`);
  ok(liveDiffers === 0, `composite() leaves the grid GridStamper.stamp() does, every frame (${liveDiffers} differ)`);
  ok(stale === 0, `the bricks it reports are all that changed (${stale} frames left something behind)`);
  ok(outcomes === LEVELS.length, `both play out the same (${outcomes}/${LEVELS.length} levels)`);
}

console.log("scoring:");
ok(!isWin({ knockedOff: 49, initial: 100, target: 0.5, ballsTotal: 3, ballsUsed: 1 }), "49/100 at 50% is not a win");
ok(stars({ knockedOff: 50, initial: 100, target: 0.5, ballsTotal: 3, ballsUsed: 1 }) === 3, "first-ball win = 3 stars");
ok(stars({ knockedOff: 60, initial: 100, target: 0.5, ballsTotal: 3, ballsUsed: 2 }) === 2, "win with a spare ball = 2 stars");
ok(stars({ knockedOff: 60, initial: 100, target: 0.5, ballsTotal: 3, ballsUsed: 3 }) === 1, "last-ball win = 1 star");
ok(stars({ knockedOff: 10, initial: 100, target: 0.5, ballsTotal: 3, ballsUsed: 3 }) === 0, "no win = 0 stars");

console.log("a full shot at the tower (deterministic):");
{
  const runShot = (log: string[] | null) => {
    const g = new Game({ onPhase: (p) => log?.push(p) });
    g.loadLevel(LEVELS[0], 0);
    g.beginAim();
    g.updateAim({ yawDeg: 0, pitchDeg: 34, power: 0.75 });
    const fired = g.fire();
    let t = 0;
    let maxChunks = 0;
    while (g.phase !== "aim" && g.phase !== "won" && g.phase !== "lost" && t < 12) {
      g.step(1 / 60);
      maxChunks = Math.max(maxChunks, g.sim.chunks.length);
      t += 1 / 60;
    }
    return { g, fired, t, maxChunks };
  };
  const phases: string[] = [];
  const a = runShot(phases);
  const r = a.g.result();
  console.log(
    `    initial ${a.g.structure.initial}, attached ${a.g.structure.count}, knocked off ${r.knockedOff} (${Math.round(a.g.progress() * 100)}%), chunks seen ${a.maxChunks}, settled in ${a.t.toFixed(1)} s → ${a.g.phase}`,
  );
  ok(a.fired, "fires");
  ok(a.g.structure.count < a.g.structure.initial, "the structure lost voxels");
  ok(r.knockedOff > 0 || a.maxChunks > 0, "something fell or detached");
  ok(a.t < 12, "the shot settles within the cap");
  ok(phases[0] === "aim" && phases.includes("flying") && phases.includes("settling"), `phases ran aim → flying → settling (${phases.join(" → ")})`);
  const b = runShot(null);
  ok(b.g.sim.knockedOff === a.g.sim.knockedOff && b.g.structure.standing === a.g.structure.standing, "replaying the shot is deterministic");
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
