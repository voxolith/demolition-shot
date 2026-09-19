// Synthesised sound effects (no asset files). Everything is built from noise
// bursts and short oscillator sweeps on a WebAudio graph. The context is
// created lazily on the first user gesture, as browsers require.

const KEY = "demolition-shot-sound";

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled: boolean;

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
    if (!on && this.rumbleGain) this.rumbleGain.gain.value = 0;
  }

  /** Call from a pointerdown handler so the context can start. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    if (typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);
    // 1 s of white noise, reused by every burst.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // Continuous low rumble whose gain follows collapse activity.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    src.connect(lp).connect(this.rumbleGain).connect(this.master);
    src.start();
  }

  private noise(duration: number, gain: number, freq: number, q = 0.7, type: BiquadFilterType = "bandpass"): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.05);
  }

  private tone(freq0: number, freq1: number, duration: number, gain: number, type: OscillatorType = "sine", at = 0): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + at;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  fire(power: number): void {
    this.noise(0.35, 0.9, 900, 0.5);
    this.tone(120 + power * 40, 38, 0.45, 0.8, "triangle");
  }

  impact(speed: number): void {
    const k = Math.min(1, speed / 70);
    this.noise(0.18 + k * 0.2, 0.35 + k * 0.5, 1800 - k * 900, 0.8);
    this.tone(220 - k * 80, 60, 0.18, 0.35 + k * 0.3, "square");
  }

  crumble(mass: number): void {
    const k = Math.min(1, mass / 60);
    this.noise(0.3 + k * 0.4, 0.25 + k * 0.4, 380, 0.6, "lowpass");
  }

  /** Activity 0..1: how much is currently moving. */
  rumble(activity: number): void {
    if (!this.rumbleGain || !this.ctx) return;
    const target = this.enabled ? Math.min(0.6, activity * 0.6) : 0;
    this.rumbleGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
  }

  win(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => this.tone(f, f, 0.35, 0.35, "triangle", i * 0.11));
  }

  lose(): void {
    this.tone(330, 110, 0.7, 0.4, "sawtooth");
  }

  tap(): void {
    this.tone(880, 660, 0.06, 0.12, "sine");
  }
}
