// Touch/mouse input on the canvas via Pointer Events.
//
// While a shot can be taken, one finger anywhere is the slingshot: press, pull
// back, release to fire (a short tap cancels). Two fingers orbit the camera
// (horizontal drag) and pinch to zoom. Outside the aim phase one finger orbits.

export interface InputHandlers {
  /** Whether a one-finger drag should aim (true) or orbit (false) right now. */
  canAim(): boolean;
  aimStart(): void;
  /** Pull vector in CSS pixels from the press point, plus the viewport's shorter side. */
  aimMove(dx: number, dy: number, viewportMin: number): void;
  /** Release: `fire` is false for a tap or a tiny pull. */
  aimEnd(fire: boolean): void;
  orbit(dxPx: number): void;
  pinch(ratio: number): void;
  /** Any press (used to unlock audio). */
  press(): void;
}

const FIRE_MIN_PULL = 18; // px

export function attachInput(canvas: HTMLCanvasElement, h: InputHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  let mode: "none" | "aim" | "orbit" | "two" = "none";
  let lastDist = 0;
  let lastMidX = 0;

  const viewportMin = () => Math.min(window.innerWidth, window.innerHeight);

  const down = (e: PointerEvent) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    h.press();
    if (pointers.size === 1) {
      if (h.canAim()) {
        mode = "aim";
        h.aimStart();
      } else mode = "orbit";
    } else if (pointers.size === 2) {
      if (mode === "aim") h.aimEnd(false);
      mode = "two";
      const [a, b] = [...pointers.values()];
      lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      lastMidX = (a.x + b.x) / 2;
    }
  };

  const move = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (mode === "aim") {
      h.aimMove(p.x - p.sx, p.y - p.sy, viewportMin());
    } else if (mode === "orbit" && pointers.size === 1) {
      h.orbit(e.movementX || 0);
    } else if (mode === "two" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      if (lastDist > 0) h.pinch(dist / lastDist);
      h.orbit(midX - lastMidX);
      lastDist = dist;
      lastMidX = midX;
    }
  };

  const up = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (mode === "aim" && p) {
      const pull = Math.hypot(p.x - p.sx, p.y - p.sy);
      h.aimEnd(pull >= FIRE_MIN_PULL);
      mode = "none";
    } else if (pointers.size === 0) {
      mode = "none";
    } else if (pointers.size === 1) {
      // One finger left after a pinch: continue as orbit.
      mode = "orbit";
    }
  };

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
  };
}
