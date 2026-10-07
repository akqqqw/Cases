import type { StarThresholds } from './goal';

/**
 * Combo: a run of triples collected one move after another. The counter tracks
 * *triples*, not moves — a bomb move that clears two triples pushes the combo
 * two steps further. A move that clears nothing drops the run back to zero
 * (the best run of the level is kept for the result screen).
 */
export interface ComboState {
  /** Triples collected in a row right now. */
  streak: number;
  /** Longest run of the level. */
  best: number;
}

export const EMPTY_COMBO: ComboState = { streak: 0, best: 0 };

/** The combo starts paying from the second triple in a row. */
export const COMBO_START = 2;
/** Coins per combo step beyond the first triple. */
export const COMBO_COIN_STEP = 2;
/** Ceiling for a single combo payout. */
export const COMBO_COIN_CAP = 12;

export function advanceCombo(state: ComboState, triples: number): ComboState {
  if (triples <= 0) return { streak: 0, best: state.best };
  const streak = state.streak + triples;
  return { streak, best: Math.max(state.best, streak) };
}

/** Coins paid for the combo level a move has just reached. */
export function comboBonus(streak: number): number {
  if (streak < COMBO_START) return 0;
  return Math.min(COMBO_COIN_CAP, (streak - 1) * COMBO_COIN_STEP);
}

/** Short label for the HUD / floating text. `null` means "no combo yet". */
export function comboLabel(streak: number): string | null {
  if (streak < COMBO_START) return null;
  if (streak >= 6) return `Огонь! ×${streak}`;
  if (streak >= 4) return `Серия ×${streak}`;
  return `Комбо ×${streak}`;
}

/** Extra coins for a win that kept the level tidy. */
export const CLEAN_RUN_BONUS = 15;
/** Coins per unused move (capped so the reward cannot explode). */
export const MOVES_LEFT_COIN = 2;
export const MOVES_LEFT_COIN_CAP = 30;

export function movesLeftBonus(movesLeft: number): number {
  return Math.min(MOVES_LEFT_COIN_CAP, Math.max(0, Math.floor(movesLeft)) * MOVES_LEFT_COIN);
}

/**
 * What a finished run looks like. Everything here is data the runtime already
 * has, so the star rules stay testable without a scene or a store.
 */
export interface RunSummary {
  movesLeft: number;
  moveLimit: number;
  /** Verified solution length of the level. */
  par: number;
  hintsUsed: number;
  undosUsed: number;
  /** Boosters are assists just like hints, so they cost the perfect star. */
  boostersUsed: number;
  comboBest: number;
}

export type StarKind = 1 | 2 | 3;

/**
 * ⭐ Победа — the level is finished.
 * ⭐⭐ Хорошее прохождение — finished with moves to spare, or without a single hint.
 * ⭐⭐⭐ Идеальное прохождение — finished clean (no hints, no undos) and with a
 * solid reserve of moves above the level's own 3-star threshold.
 */
export function starsForRun(run: RunSummary, thresholds: StarThresholds): StarKind {
  const clean = isCleanRun(run);
  if (clean && run.movesLeft >= thresholds.three) return 3;
  if (run.movesLeft >= thresholds.two || clean) return 2;
  return 1;
}

/** Whether the run deserves the "clean" bonus and the perfect wording. */
export function isCleanRun(run: RunSummary): boolean {
  return run.hintsUsed === 0 && run.undosUsed === 0 && run.boostersUsed === 0;
}

export const STAR_TITLES: Record<StarKind, string> = {
  1: 'Победа',
  2: 'Хорошее прохождение',
  3: 'Идеальное прохождение',
};

export function starTitle(stars: number): string {
  if (stars >= 3) return STAR_TITLES[3];
  if (stars === 2) return STAR_TITLES[2];
  if (stars === 1) return STAR_TITLES[1];
  return '';
}

export interface RewardLine {
  id: 'base' | 'stars' | 'combo' | 'golden' | 'clean' | 'moves';
  label: string;
  coins: number;
}

export interface RewardInput {
  stars: number;
  movesLeft: number;
  goldenCoins: number;
  comboCoins: number;
  clean: boolean;
  /** Level reward before any bonus. */
  baseCoins: number;
}

/**
 * Full coin breakdown of a finished level, ready to be rendered line by line on
 * the result screen. Zero lines are dropped so the panel only shows what the
 * player actually earned.
 */
export function rewardLines(input: RewardInput): RewardLine[] {
  const lines: RewardLine[] = [
    { id: 'base', label: 'Награда за уровень', coins: input.baseCoins },
    { id: 'stars', label: 'Бонус за звёзды', coins: input.stars > 1 ? (input.stars - 1) * 10 : 0 },
    { id: 'combo', label: 'Комбо', coins: input.comboCoins },
    { id: 'golden', label: 'Золотые тройки', coins: input.goldenCoins },
    { id: 'clean', label: 'Без подсказок, отмен и бустеров', coins: input.clean ? CLEAN_RUN_BONUS : 0 },
    { id: 'moves', label: 'Сэкономленные ходы', coins: movesLeftBonus(input.movesLeft) },
  ];

  return lines.filter((line) => line.coins > 0);
}
