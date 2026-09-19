// Headless checks for the demolition simulation: runs with `bun tools/verify.ts`,
// no GPU. Exits non-zero on the first failed assertion.

import { GridStamper } from "@voxolith/renderer/core";
import { Game } from "../src/game/game";
import { LEVELS } from "../src/game/levels";
import { Structure, type Cell } from "../src/game/structure";
import { stars, isWin } from "../src/game/scoring";
import { PLATFORM, PLATFORM_CENTER, SIZE, buildPlate } from "../src/game/world";

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
