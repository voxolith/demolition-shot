// HTML overlay screens: title, level select, in-game HUD, result, settings.
// Rendered into #ui with template strings; clicks are delegated via
// data-action attributes so screens stay plain markup.

import type { QualityPreset } from "@voxolith/renderer";
import type { Level } from "../game/levels";
import { isUnlocked, type Progress } from "./progress";
import { currentTheme } from "../brand/theme";

export interface ScreenCallbacks {
  play(): void;
  selectLevel(index: number): void;
  retry(): void;
  next(): void;
  menu(): void;
  levels(): void;
  settings(): void;
  closeSettings(): void;
  toggleSound(on: boolean): void;
  toggleHaptics(on: boolean): void;
  quality(preset: QualityPreset): void;
  loadVox(file: File): void;
  pause(): void;
}

export interface SettingsState {
  sound: boolean;
  haptics: boolean;
  hapticsSupported: boolean;
  quality: QualityPreset;
  adapter: string;
  software: boolean;
}

const BASE = import.meta.env.BASE_URL;
const starRow = (n: number, big = false) =>
  `<span class="stars${big ? " big" : ""}" aria-label="${n} of 3 stars">${[1, 2, 3].map((i) => `<span class="star${i <= n ? " on" : ""}">★</span>`).join("")}</span>`;

export class Screens {
  private hudEls: { balls: HTMLElement; bar: HTMLElement; pct: HTMLElement } | null = null;

  constructor(private readonly root: HTMLElement, cb: ScreenCallbacks) {
    root.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
      if (!el) return;
      const a = el.dataset.action!;
      const i = Number(el.dataset.index ?? -1);
      switch (a) {
        case "play": cb.play(); break;
        case "level": if (!el.classList.contains("locked")) cb.selectLevel(i); break;
        case "retry": cb.retry(); break;
        case "next": cb.next(); break;
        case "menu": cb.menu(); break;
        case "levels": cb.levels(); break;
        case "settings": cb.settings(); break;
        case "close-settings": cb.closeSettings(); break;
        case "pause": cb.pause(); break;
      }
    });
    root.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.id === "opt-sound") cb.toggleSound((el as HTMLInputElement).checked);
      if (el.id === "opt-haptics") cb.toggleHaptics((el as HTMLInputElement).checked);
      if (el.id === "opt-quality") cb.quality(el.value as QualityPreset);
      if (el.id === "opt-vox") {
        const f = (el as HTMLInputElement).files?.[0];
        if (f) cb.loadVox(f);
      }
    });
  }

  private set(html: string, cls = ""): void {
    this.root.className = cls;
    this.root.innerHTML = html;
    this.hudEls = null;
  }

  title(totalStars: number, hasProgress: boolean): void {
    this.set(`
      <div class="screen title">
        <img class="lockup" src="${BASE}brand/${currentTheme() === "dark" ? "lockup-dark.svg" : "lockup.svg"}" alt="Voxolith" width="220" />
        <h1>Demolition Shot</h1>
        <p class="tagline">Aim. Release. Watch it crumble.</p>
        <button class="btn primary" data-action="play">${hasProgress ? "Continue" : "Play"}</button>
        <button class="btn" data-action="levels">Levels${totalStars ? ` · ${totalStars} ★` : ""}</button>
        <button class="btn ghost" data-action="settings">Settings</button>
        <p class="foot">Pull back anywhere to aim · two fingers orbit</p>
      </div>`, "menu");
  }

  levels(levels: Level[], progress: Progress): void {
    const ids = levels.map((l) => l.id);
    const cards = levels
      .map((l, i) => {
        const unlocked = isUnlocked(progress, ids, i);
        const s = progress.stars[l.id] ?? 0;
        return `<button class="card${unlocked ? "" : " locked"}" data-action="level" data-index="${i}" ${unlocked ? "" : "aria-disabled='true'"}>
          <span class="num">${i + 1}</span>
          <span class="name">${l.name}</span>
          <span class="meta">${l.balls} ball${l.balls > 1 ? "s" : ""} · ${Math.round(l.target * 100)}%</span>
          ${unlocked ? starRow(s) : `<span class="lock">🔒</span>`}
        </button>`;
      })
      .join("");
    this.set(`
      <div class="screen levels">
        <header class="bar"><button class="btn small" data-action="menu">‹ Back</button><h2>Levels</h2><button class="btn small ghost" data-action="settings">⚙</button></header>
        <div class="grid">${cards}</div>
      </div>`, "menu");
  }

  hud(level: Level, index: number): void {
    this.set(`
      <div class="hud">
        <div class="hud-top">
          <button class="btn small" data-action="pause" aria-label="Pause">▐▐</button>
          <div class="hud-title"><span class="num">${index + 1}</span> ${level.name}</div>
          <div class="balls" id="hud-balls"></div>
        </div>
        <div class="hud-bottom">
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100">
            <div class="fill" id="hud-fill"></div>
            <div class="tick" style="left:${Math.round(level.target * 100)}%"><span>${Math.round(level.target * 100)}%</span></div>
          </div>
          <div class="pct" id="hud-pct">0%</div>
        </div>
        <div class="hint" id="hud-hint">${level.hint}</div>
      </div>`, "play");
    this.hudEls = {
      balls: this.root.querySelector("#hud-balls")!,
      bar: this.root.querySelector("#hud-fill")!,
      pct: this.root.querySelector("#hud-pct")!,
    };
  }

  updateHud(ballsLeft: number, ballsTotal: number, fraction: number, target: number): void {
    const h = this.hudEls;
    if (!h) return;
    h.balls.innerHTML = Array.from({ length: ballsTotal }, (_, i) => `<span class="ball${i < ballsLeft ? "" : " used"}"></span>`).join("");
    const pct = Math.min(100, Math.round(fraction * 100));
    h.bar.style.width = `${pct}%`;
    h.bar.classList.toggle("met", fraction >= target);
    h.pct.textContent = `${pct}%`;
  }

  hideHint(): void {
    this.root.querySelector("#hud-hint")?.classList.add("gone");
  }

  result(won: boolean, stars: number, fraction: number, target: number, hasNext: boolean): void {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel result ${won ? "won" : "lost"}">
        <h2>${won ? "Demolished!" : "Still standing"}</h2>
        ${won ? starRow(stars, true) : ""}
        <p class="pct">${Math.round(fraction * 100)}% knocked off <span class="muted">(target ${Math.round(target * 100)}%)</span></p>
        <div class="row">
          <button class="btn" data-action="levels">Levels</button>
          <button class="btn" data-action="retry">Retry</button>
          ${won && hasNext ? `<button class="btn primary" data-action="next">Next ›</button>` : ""}
        </div>
      </div>`;
    this.root.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("in"));
  }

  pauseMenu(): void {
    const overlay = document.createElement("div");
    overlay.className = "overlay in";
    overlay.innerHTML = `
      <div class="panel">
        <h2>Paused</h2>
        <div class="col">
          <button class="btn primary" data-action="close-settings">Resume</button>
          <button class="btn" data-action="retry">Restart level</button>
          <button class="btn" data-action="settings">Settings</button>
          <button class="btn ghost" data-action="menu">Main menu</button>
        </div>
      </div>`;
    this.root.appendChild(overlay);
  }

  settings(s: SettingsState): void {
    const overlay = document.createElement("div");
    overlay.className = "overlay in";
    overlay.innerHTML = `
      <div class="panel settings">
        <h2>Settings</h2>
        <label class="opt"><span>Sound</span><input type="checkbox" id="opt-sound" ${s.sound ? "checked" : ""} /></label>
        <label class="opt"><span>Vibration${s.hapticsSupported ? "" : " <small>(not on this device)</small>"}</span><input type="checkbox" id="opt-haptics" ${s.haptics ? "checked" : ""} ${s.hapticsSupported ? "" : "disabled"} /></label>
        <label class="opt"><span>Render quality</span>
          <select id="opt-quality"><option value="low" ${s.quality === "low" ? "selected" : ""}>Low</option><option value="medium" ${s.quality === "medium" ? "selected" : ""}>Medium</option><option value="high" ${s.quality === "high" ? "selected" : ""}>High</option></select></label>
        <label class="opt"><span>Theme</span><button class="theme-toggle" id="opt-theme" type="button"></button></label>
        <label class="opt file"><span>Load a .vox as a level</span><input type="file" id="opt-vox" accept=".vox" /></label>
        <p class="muted small">${s.software ? "⚠ Software WebGPU adapter: " : "GPU: "}${s.adapter}</p>
        <button class="btn primary" data-action="close-settings">Done</button>
      </div>`;
    this.root.appendChild(overlay);
  }

  closeOverlays(): void {
    this.root.querySelectorAll(".overlay").forEach((o) => o.remove());
  }

  toast(msg: string): void {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    this.root.appendChild(t);
    setTimeout(() => t.classList.add("in"), 10);
    setTimeout(() => t.remove(), 2600);
  }

  message(html: string): void {
    this.set(`<div class="screen"><div class="panel">${html}</div></div>`, "menu");
  }
}
