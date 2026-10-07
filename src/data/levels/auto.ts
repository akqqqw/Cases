import type { StarThresholds } from '../../core/goal';

/** Default share of the move budget that has to stay unused for 3 / 2 stars. */
const THREE_STAR_SHARE = 0.34;
const TWO_STAR_SHARE = 0.16;

/**
 * Turns the verified solver solution (`par`) into a player friendly move budget.
 * The player is never asked to be better than the planner.
 */
export function autoMoveLimit(par: number, slack = 0.9): number {
  return Math.max(par + 3, Math.ceil(par * (1 + slack)));
}

export function autoStars(limit: number): StarThresholds {
  return {
    three: Math.max(2, Math.round(limit * THREE_STAR_SHARE)),
    two: Math.max(1, Math.round(limit * TWO_STAR_SHARE)),
  };
}
