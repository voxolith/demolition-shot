// Saved progress: stars per level, in localStorage. Levels unlock in order.

const KEY = "demolition-shot-progress";

export interface Progress {
  stars: Record<string, number>;
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Progress;
      if (p && typeof p.stars === "object") return { stars: p.stars };
    }
  } catch {
    /* private mode, quota, corrupt data: start fresh */
  }
  return { stars: {} };
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function recordStars(p: Progress, levelId: string, stars: number): void {
  if ((p.stars[levelId] ?? 0) < stars) {
    p.stars[levelId] = stars;
    saveProgress(p);
  }
}

/** A level is unlocked if it is the first one or the previous one has at least one star. */
export function isUnlocked(p: Progress, levelIds: string[], index: number): boolean {
  if (index <= 0) return true;
  return (p.stars[levelIds[index - 1]] ?? 0) > 0;
}

export function totalStars(p: Progress): number {
  return Object.values(p.stars).reduce((a, b) => a + b, 0);
}
