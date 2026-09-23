// Touch/mouse input on the canvas, on top of the engine's input core.
//
// While a shot can be taken, one finger (or the left mouse button) anywhere is
// the slingshot: press, pull back, release to fire (a short tap cancels). Two
// fingers orbit the camera (horizontal drag) and pinch to zoom. Outside the aim
// phase one finger orbits. On a desktop, right-drag orbits and the wheel (or a
// trackpad pinch) zooms.
//
// The slingshot is its own small state machine rather than a generic drag: it
// starts on the press, not after a slop, and a second finger cancels it.

import { createInput, prepareSurface, type PointerState } from "@voxolith/engine/input";

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
const WHEEL_ZOOM = 0.0015; // per pixel
const TRACKPAD_PINCH = 0.01; // per pixel of ctrl+wheel

export function attachInput(canvas: HTMLCanvasElement, h: InputHandlers): () => void {
  const undoSurface = prepareSurface(canvas, { contextMenu: false });
  const input = createInput(canvas);
  let mode: "none" | "aim" | "orbit" | "two" = "none";
  let aimId = -1;
  let lastDist = 0;
  let lastMidX = 0;

  const viewportMin = () => Math.min(window.innerWidth, window.innerHeight);
  const touches = (): PointerState[] => [...input.pointers().values()];

  const off = input.on((e) => {
    if (e.kind === "wheel") {
      h.pinch(Math.exp(-e.dy * (e.pinch ? TRACKPAD_PINCH : WHEEL_ZOOM)));
      return;
    }
    if (e.kind !== "pointer") return;
    const p = e.pointer;
    const n = input.pointers().size;

    if (e.phase === "down") {
      h.press();
      if (n === 1) {
        const primary = p.type !== "mouse" || p.button === 0;
        if (primary && h.canAim()) {
          mode = "aim";
          aimId = p.id;
          h.aimStart();
        } else mode = "orbit";
      } else if (n === 2) {
        if (mode === "aim") h.aimEnd(false);
        mode = "two";
        const [a, b] = touches();
        lastDist = Math.hypot(a.x - b.x, a.y - b.y);
        lastMidX = (a.x + b.x) / 2;
      }
      return;
    }

    if (e.phase === "move") {
      if (mode === "aim" && p.id === aimId) {
        h.aimMove(p.x - p.startX, p.y - p.startY, viewportMin());
      } else if (mode === "orbit" && n === 1) {
        h.orbit(p.x - p.lastX);
      } else if (mode === "two" && n === 2) {
        const [a, b] = touches();
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        if (lastDist > 0) h.pinch(dist / lastDist);
        h.orbit(midX - lastMidX);
        lastDist = dist;
        lastMidX = midX;
      }
      return;
    }

    // up / cancel (the pointer has already left the map)
    if (mode === "aim" && p.id === aimId) {
      const pull = Math.hypot(p.x - p.startX, p.y - p.startY);
      h.aimEnd(e.phase === "up" && pull >= FIRE_MIN_PULL);
      mode = "none";
      aimId = -1;
    } else if (n === 0) {
      mode = "none";
    } else if (n === 1) {
      // One finger left after a pinch: continue as orbit.
      mode = "orbit";
    }
  });

  return () => {
    off();
    input.dispose();
    undoSurface();
  };
}
