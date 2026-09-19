// Demolition Shot — a mobile voxel demolition game on @voxolith/renderer.
//
// Boot the GPU, wrap the headless Game with rendering (one dense grid, movers
// stamped each frame, permanent edits uploaded as dirty boxes), input, UI,
// sound, haptics and progress.

import "./styles.css";
import {
  initGpu,
  resizeToDisplay,
  showUnsupportedScreen,
  WebGPUUnsupportedError,
  createRenderer,
  makeCamera,
  makePerf,
  makeFrameLoop,
  observeResize,
  OccupancyGrid,
  QUALITY_PRESETS,
  type QualityPreset,
  type Renderer,
  type StampVoxel,
  type DirtyBox,
  type Vec3,
} from "@voxolith/renderer";
import { initTheme } from "./brand/theme";
import { Game, type Phase } from "./game/game";
import { LEVELS, levelFromVox, type Level } from "./game/levels";
import { SIZE, PLATFORM, PLATFORM_CENTER } from "./game/world";
import { aimFromDrag } from "./game/cannon";
import { Screens } from "./ui/screens";
import { attachInput } from "./ui/input";
import { Sfx } from "./ui/audio";
import { Haptics } from "./ui/haptics";
import { loadProgress, recordStars, isUnlocked, totalStars } from "./ui/progress";
import { registerPwa } from "./pwa";

const APP = "Demolition Shot";
const BASE = import.meta.env.BASE_URL;
const MARK = `<img src="${BASE}brand/logo-mark.svg" alt="" width="72" height="72">`;
const QUALITY_KEY = "voxolith-quality";
const isPreset = (v: unknown): v is QualityPreset => v === "low" || v === "medium" || v === "high";

// Warm daylight with a soft sky.
const SUN: Vec3 = norm([0.45, 0.8, -0.4]);
const ENV = {
  lightDir: SUN,
  lightColor: [1.0, 0.96, 0.9] as Vec3,
  ambientSky: [0.52, 0.56, 0.66] as Vec3,
  ambientGround: [0.34, 0.3, 0.26] as Vec3,
  sunDir: SUN,
  moonDir: [0, -1, 0] as Vec3,
  sunColor: [1, 0.95, 0.85] as Vec3,
  moonColor: [0, 0, 0] as Vec3,
  skyTop: [0.36, 0.55, 0.88] as Vec3,
  skyHorizon: [0.8, 0.86, 0.94] as Vec3,
  nightFactor: 0,
  sunIntensity: 1,
  moonIntensity: 0,
};

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

async function main() {
  initTheme();
  registerPwa();
  const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
  const ui = document.getElementById("ui");
  if (!canvas || !ui) throw new Error("Missing #scene / #ui");

  let gpu;
  try {
    // Phones report DPR 3; the raymarcher does not need it.
    gpu = await initGpu(canvas, { maxPixelRatio: 1.5 });
    if (gpu.software) gpu.pixelRatio = 1;
  } catch (err) {
    if (err instanceof WebGPUUnsupportedError) {
      showUnsupportedScreen(err.message, { appName: APP, iconHtml: MARK });
      return;
    }
    throw err;
  }

  // --- Services --------------------------------------------------------------
  const sfx = new Sfx();
  const haptics = new Haptics();
  const progress = loadProgress();
  const params = new URLSearchParams(location.search);

  let quality: QualityPreset = (() => {
    try {
      const v = localStorage.getItem(QUALITY_KEY);
      return isPreset(v) ? v : gpu.software ? "low" : "high";
    } catch {
      return "high";
    }
  })();

  // --- Game + renderer -------------------------------------------------------
  let levels: Level[] = [...LEVELS];
  let levelIndex = 0;
  let attempt = 0;
  let lastImpactHaptic = 0;
  let inPlay = false;

  const game = new Game({
    onFire(_m, _d, power) {
      sfx.fire(power);
      haptics.fire();
      if (inPlay) screens.hideHint();
    },
    onImpact(e) {
      if (e.kind === "ball") sfx.impact(e.speed);
      else if (e.kind === "shatter") sfx.crumble(e.speed);
      const now = performance.now();
      if (now - lastImpactHaptic > 90) {
        lastImpactHaptic = now;
        haptics.impact(e.speed);
      }
    },
    onProgress(f) {
      if (inPlay) screens.updateHud(game.ballsLeft, game.level?.balls ?? 0, f, game.level?.target ?? 1);
    },
    onPhase(p) {
      onPhase(p);
    },
  });

  const palette0 = game.loadLevel(levels[0], 0);
  const renderer: Renderer = await createRenderer(gpu, { size: SIZE, data: game.stamper.liveData, palette: palette0 });
  renderer.setClipBounds([0, 0, 0], [SIZE.x - 1, SIZE.y - 1, SIZE.z - 1]);
  renderer.setFloor({ enabled: true, y: 0, colorA: [0.42, 0.46, 0.36], colorB: [0.36, 0.4, 0.31] });
  renderer.setQuality(QUALITY_PRESETS[quality]);
  const occupancy = new OccupancyGrid(SIZE, game.stamper.liveData);
  renderer.updateCoarse(occupancy.data);

  const uploadAll = () => {
    occupancy.rebuildAll(game.stamper.liveData);
    renderer.updateVoxels(game.stamper.liveData);
    renderer.updateCoarse(occupancy.data);
  };

  // --- Camera ----------------------------------------------------------------
  const target: Vec3 = [PLATFORM_CENTER[0], PLATFORM.top + 10, PLATFORM_CENTER[2] - 4];
  const camera = makeCamera({ target, distance: 112, pitchDeg: 16, fovDeg: 50 });
  let orbitYaw = 0; // offset from looking straight down +Z from behind the cannon
  let distance = 112;
  const ORBIT_MAX = 42;

  // --- Perf + frame loop -----------------------------------------------------
  const a = gpu.adapterInfo;
  const adapterName = [a.vendor, a.architecture, a.description].filter(Boolean).join(" · ") || "unknown adapter";
  const perf = makePerf({
    enabled: params.has("perf"),
    scale: gpu.renderScale,
    minScale: gpu.software ? 0.25 : 0.4,
    label: `${adapterName}${gpu.software ? " (software)" : ""}`,
  });
  const movers: StampVoxel[] = [];
  const loop = makeFrameLoop({
    render(now, dt) {
      perf.frame(now);
      gpu!.renderScale = perf.scale();
      resizeToDisplay(gpu!);

      game.step(dt);
      sfx.rumble(Math.min(1, (game.sim.chunks.length * 6 + game.sim.debris.length) / 240));

      movers.length = 0;
      game.movers(movers);
      const box = game.stamper.stamp(movers);
      const dirty = union(box, game.takeDirtyBase());
      if (dirty) {
        renderer.updateVoxels(game.stamper.liveData, dirty);
        renderer.updateCoarse(occupancy.data, occupancy.updateBox(game.stamper.liveData, dirty));
      }
      renderer.render({ ...camera(180 + orbitYaw, distance, target), ...ENV });
      loop.setContinuous(game.animating());
    },
  });
  observeResize(canvas, loop);

  // --- Screens ---------------------------------------------------------------
  const screens = new Screens(ui, {
    play: () => {
      // Continue at the first level without a star, else the last one.
      const ids = levels.map((l) => l.id);
      let i = levels.findIndex((l) => !(progress.stars[l.id] > 0));
      if (i < 0) i = levels.length - 1;
      while (i > 0 && !isUnlocked(progress, ids, i)) i--;
      startLevel(i);
    },
    selectLevel: (i) => startLevel(i),
    retry: () => {
      screens.closeOverlays();
      startLevel(levelIndex, attempt + 1);
    },
    next: () => startLevel(Math.min(levels.length - 1, levelIndex + 1)),
    menu: () => showTitle(),
    levels: () => {
      screens.levels(levels, progress);
      loop.invalidate();
    },
    settings: () => {
      screens.closeOverlays();
      screens.settings({ sound: sfx.enabled, haptics: haptics.enabled, hapticsSupported: haptics.supported, quality, adapter: adapterName, software: gpu!.software });
      initTheme(ui.querySelector("#opt-theme"));
    },
    closeSettings: () => screens.closeOverlays(),
    toggleSound: (on) => sfx.setEnabled(on),
    toggleHaptics: (on) => haptics.setEnabled(on),
    quality: (p) => {
      quality = p;
      try { localStorage.setItem(QUALITY_KEY, p); } catch { /* ignore */ }
      renderer.setQuality(QUALITY_PRESETS[p]);
      loop.invalidate();
    },
    loadVox: async (file) => {
      try {
        const lvl = levelFromVox(await file.arrayBuffer(), file.name.replace(/\.vox$/i, ""));
        levels = [...LEVELS, lvl];
        screens.closeOverlays();
        startLevel(levels.length - 1);
        screens.toast(`Loaded ${lvl.name} (${game.structure.initial.toLocaleString()} voxels)`);
      } catch (e) {
        screens.toast(`Could not load .vox: ${(e as Error).message}`);
      }
    },
    pause: () => {
      screens.pauseMenu();
    },
  });

  function showTitle() {
    inPlay = false;
    screens.title(totalStars(progress), Object.keys(progress.stars).length > 0);
    loop.invalidate();
  }

  function startLevel(i: number, att = 0) {
    levelIndex = i;
    attempt = att;
    inPlay = true;
    const level = levels[i];
    const palette = game.loadLevel(level, att);
    renderer.updatePalette(palette);
    uploadAll();
    orbitYaw = 0;
    screens.hud(level, i);
    screens.updateHud(game.ballsLeft, level.balls, 0, level.target);
    loop.invalidate();
  }

  function onPhase(p: Phase) {
    if (!inPlay) return;
    const level = game.level!;
    screens.updateHud(game.ballsLeft, level.balls, game.progress(), level.target);
    if (p === "won" || p === "lost") {
      const won = p === "won";
      const s = game.stars();
      if (won) {
        recordStars(progress, level.id, s);
        sfx.win();
        haptics.win();
      } else {
        sfx.lose();
        haptics.lose();
      }
      const hasNext = levelIndex + 1 < levels.length;
      setTimeout(() => screens.result(won, s, game.progress(), level.target, hasNext), 500);
    }
  }

  // --- Input -----------------------------------------------------------------
  attachInput(canvas, {
    canAim: () => inPlay && game.phase === "aim" && ui.querySelector(".overlay") === null,
    aimStart: () => {
      game.beginAim();
      loop.invalidate();
    },
    aimMove: (dx, dy, vmin) => {
      game.updateAim(aimFromDrag(dx, dy, vmin));
      loop.invalidate();
    },
    aimEnd: (fire) => {
      if (fire) game.fire();
      else game.cancelAim();
      loop.invalidate();
    },
    orbit: (dx) => {
      orbitYaw = Math.max(-ORBIT_MAX, Math.min(ORBIT_MAX, orbitYaw - dx * 0.25));
      loop.invalidate();
    },
    pinch: (ratio) => {
      distance = Math.max(80, Math.min(180, distance / ratio));
      loop.invalidate();
    },
    press: () => sfx.unlock(),
  });
  ui.addEventListener("pointerdown", () => sfx.unlock(), { passive: true });

  // --- Start -----------------------------------------------------------------
  const debugLevel = Number(params.get("level"));
  if (debugLevel >= 1 && debugLevel <= levels.length) {
    startLevel(debugLevel - 1);
    const auto = params.get("auto");
    if (auto === "aim") {
      game.beginAim();
      game.updateAim({ yawDeg: -6, pitchDeg: 30, power: 0.7 });
    } else if (auto === "fire") {
      game.updateAim({ yawDeg: 0, pitchDeg: 26, power: 0.75 });
      game.fire();
    }
  } else {
    showTitle();
  }
  loop.invalidate();
}

function union(a: DirtyBox | null, b: DirtyBox | null): DirtyBox | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), z0: Math.min(a.z0, b.z0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), z1: Math.max(a.z1, b.z1) };
}

main().catch((err) => {
  console.error(err);
  showUnsupportedScreen("An unexpected error occurred while starting up.", { appName: APP, iconHtml: MARK });
});
