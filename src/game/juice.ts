/**
 * The motion budget of the game — one small pure module that every visual and
 * sound effect asks before it plays something loud.
 *
 * Two reasons to keep it here (and not inside Phaser code):
 *   - `prefers-reduced-motion` is an accessibility setting, not a decoration:
 *     players who get motion sickness keep the game readable, only the big
 *     movements (screen shake, confetti, camera zoom) are switched off;
 *   - the numbers are pure functions, so they can be unit tested without a
 *     canvas, and the Phaser layer stays about drawing.
 */

/** 1 = normal, `REDUCED_SCALE` = the player asked for less motion. */
export const REDUCED_SCALE = 0.35;

let scale = 1;

/** Clamps the motion budget into `0..1` (also the test seam). */
export function setMotionScale(value: number): void {
  scale = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

export function motionScale(): number {
  return scale;
}

/** `true` while the big effects are toned down. */
export function motionReduced(): boolean {
  return scale < 1;
}

/**
 * Reads the media query. `match` is injectable so the tests do not need a real
 * `MediaQueryList`; a window without `matchMedia` (jsdom, old browsers) simply
 * means "no preference".
 */
export function prefersReducedMotion(
  match: ((query: string) => { matches: boolean } | null) | null = defaultMatchMedia(),
): boolean {
  if (!match) return false;
  try {
    return match('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

function defaultMatchMedia(): ((query: string) => { matches: boolean } | null) | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  const scope = window;
  return (query: string) => {
    try {
      return scope.matchMedia(query);
    } catch {
      return null;
    }
  };
}

/**
 * Applies the preference to the global budget. Called once at boot; the game
 * stores nothing, so the setting is never out of sync with the browser.
 */
export function applyMotionPreference(
  match: ((query: string) => { matches: boolean } | null) | null = defaultMatchMedia(),
): number {
  setMotionScale(prefersReducedMotion(match) ? REDUCED_SCALE : 1);
  return motionScale();
}

/** How many particles of a burst survive the budget (never a lonely one). */
export function particleCount(base: number, reduced = motionScale()): number {
  const wanted = Math.round(Math.max(0, base) * (reduced < 1 ? REDUCED_SCALE : 1));
  return Math.max(reduced < 1 ? 2 : 4, wanted);
}

/**
 * Stereo position of an effect by its horizontal place on the board: what
 * happens on the left is heard slightly on the left. Clamped, so a wide desktop
 * board never pans a sound fully away from a speaker.
 */
export function panFor(x: number, width: number, spread = 0.6): number {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, x / width)) * 2 - 1;
  return Math.round(ratio * spread * 100) / 100;
}

/** Tilt of a dragged product, degrees — follows the horizontal speed. */
export function swayAngle(vx: number, limit = 7): number {
  if (!Number.isFinite(vx)) return 0;
  return Math.min(limit, Math.max(-limit, vx * 0.18));
}

/**
 * Deterministic pitch offset in cents (±9) for the sound `seed`: the same move
 * always sounds the same, but two moves in a row never sound identical — the
 * difference that keeps a repeated tap from turning into a machine gun.
 */
export function detuneCents(seed: number, spread = 9): number {
  const step = Math.abs(Math.floor(Number(seed) || 0)) % 19;
  return Math.round(((step - 9) / 9) * spread);
}
