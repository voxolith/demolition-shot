// Vibration feedback where the browser offers it (Android Chrome). iOS Safari
// has no Vibration API, so every call is a no-op there.

const KEY = "demolition-shot-haptics";

export class Haptics {
  enabled: boolean;
  readonly supported = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

  constructor() {
    let on = true;
    try {
      on = localStorage.getItem(KEY) !== "off";
    } catch {
      /* default on */
    }
    this.enabled = on;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
  }

  private buzz(pattern: number | number[]): void {
    if (!this.enabled || !this.supported) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }

  fire(): void {
    this.buzz(25);
  }

  impact(speed: number): void {
    this.buzz(Math.round(30 + Math.min(1, speed / 70) * 50));
  }

  win(): void {
    this.buzz([40, 60, 40, 60, 90]);
  }

  lose(): void {
    this.buzz([120]);
  }
}
