// Win condition and star rating. Pure functions so tools/verify.ts can table-test them.

export interface ShotResult {
  /** Original voxels no longer standing (the score). */
  knockedOff: number;
  /** Subset that left the platform entirely (for the result screen). */
  offPlatform?: number;
  initial: number;
  target: number; // 0..1
  ballsTotal: number;
  ballsUsed: number;
}

export const progress = (r: { knockedOff: number; initial: number }): number =>
  r.initial > 0 ? r.knockedOff / r.initial : 0;

export const isWin = (r: ShotResult): boolean => progress(r) >= r.target - 1e-9;

/** 3 stars: won with the first ball. 2: won with a ball to spare. 1: won. 0: not won. */
export function stars(r: ShotResult): 0 | 1 | 2 | 3 {
  if (!isWin(r)) return 0;
  if (r.ballsUsed <= 1) return 3;
  if (r.ballsUsed < r.ballsTotal) return 2;
  return 1;
}
