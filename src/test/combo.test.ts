import { describe, expect, it } from 'vitest';
import {
  CLEAN_RUN_BONUS,
  COMBO_COIN_CAP,
  COMBO_START,
  EMPTY_COMBO,
  advanceCombo,
  comboBonus,
  comboLabel,
  isCleanRun,
  movesLeftBonus,
  rewardLines,
  starTitle,
  starsForRun,
  type ComboState,
  type RunSummary,
} from '../core/combo';
import type { StarThresholds } from '../core/goal';

const thresholds: StarThresholds = { three: 10, two: 5 };

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    movesLeft: 0,
    moveLimit: 30,
    par: 12,
    hintsUsed: 0,
    undosUsed: 0,
    boostersUsed: 0,
    comboBest: 0,
    ...overrides,
  };
}

describe('combo counter', () => {
  it('grows with every collected triple and remembers the best run', () => {
    let combo: ComboState = { ...EMPTY_COMBO };

    combo = advanceCombo(combo, 1);
    expect(combo).toEqual({ streak: 1, best: 1 });
    expect(comboBonus(combo.streak)).toBe(0); // the first triple pays nothing extra

    combo = advanceCombo(combo, 1);
    expect(combo).toEqual({ streak: 2, best: 2 });
    expect(comboBonus(combo.streak)).toBe(2);

    combo = advanceCombo(combo, 1);
    expect(combo.streak).toBe(3);
    expect(comboBonus(combo.streak)).toBe(4);
  });

  it('breaks the run on a move that collects nothing but keeps the best', () => {
    const combo = advanceCombo(advanceCombo({ ...EMPTY_COMBO }, 1), 1);
    const broken = advanceCombo(combo, 0);

    expect(broken.streak).toBe(0);
    expect(broken.best).toBe(2);

    // and it starts counting from one again
    expect(advanceCombo(broken, 1).streak).toBe(1);
    expect(advanceCombo(broken, 1).best).toBe(2);
  });

  it('counts a bomb move as two triples', () => {
    const combo = advanceCombo({ streak: 0, best: 0 }, 2);
    expect(combo.streak).toBe(2);
    expect(combo.best).toBe(2);
    expect(comboBonus(combo.streak)).toBe(2);
  });

  it('caps the payout of a single move', () => {
    expect(comboBonus(COMBO_START)).toBe(2);
    expect(comboBonus(4)).toBe(6);
    expect(comboBonus(7)).toBe(COMBO_COIN_CAP);
    expect(comboBonus(50)).toBe(COMBO_COIN_CAP);
    expect(comboBonus(1)).toBe(0);
    expect(comboBonus(0)).toBe(0);
  });

  it('has a label for every combo level and none below the start', () => {
    expect(comboLabel(0)).toBeNull();
    expect(comboLabel(1)).toBeNull();
    expect(comboLabel(2)).toContain('Комбо');
    expect(comboLabel(4)).toContain('Серия');
    expect(comboLabel(6)).toContain('Огонь');
    expect(comboLabel(9)).toContain('9');
  });
});

describe('stars of a finished run', () => {
  it('gives one star for simply winning', () => {
    expect(starsForRun(run({ movesLeft: 0, hintsUsed: 2 }), thresholds)).toBe(1);
    expect(starTitle(1)).toBe('Победа');
  });

  it('gives two stars for a good run: moves to spare or not a single hint', () => {
    expect(starsForRun(run({ movesLeft: 6 }), thresholds)).toBe(2);
    expect(starsForRun(run({ movesLeft: 0, hintsUsed: 0, undosUsed: 0 }), thresholds)).toBe(2);
    expect(starsForRun(run({ movesLeft: 4, hintsUsed: 1 }), thresholds)).toBe(1);
    expect(starTitle(2)).toBe('Хорошее прохождение');
  });

  it('gives three stars only for a clean run with a real reserve of moves', () => {
    expect(starsForRun(run({ movesLeft: 12 }), thresholds)).toBe(3);
    expect(starsForRun(run({ movesLeft: 30 }), thresholds)).toBe(3);
    // a hint costs the perfect star, but a comfortable reserve still counts as good
    expect(starsForRun(run({ movesLeft: 12, hintsUsed: 1 }), thresholds)).toBe(2);
    expect(starsForRun(run({ movesLeft: 12, undosUsed: 1 }), thresholds)).toBe(2);
    // no reserve and a hint — only the win is left
    expect(starsForRun(run({ movesLeft: 2, hintsUsed: 1 }), thresholds)).toBe(1);
    expect(starsForRun(run({ movesLeft: 30, hintsUsed: 1, undosUsed: 1 }), thresholds)).toBe(2);
    expect(starTitle(3)).toBe('Идеальное прохождение');
  });

  it('knows what a clean run is', () => {
    expect(isCleanRun(run())).toBe(true);
    expect(isCleanRun(run({ hintsUsed: 1 }))).toBe(false);
    expect(isCleanRun(run({ undosUsed: 2 }))).toBe(false);
    // boosters are assists too: using one costs the perfect star
    expect(isCleanRun(run({ boostersUsed: 1 }))).toBe(false);
    expect(starsForRun(run({ movesLeft: 30, boostersUsed: 1 }), thresholds)).toBe(2);
  });

  it('has no title without stars', () => {
    expect(starTitle(0)).toBe('');
  });
});

describe('reward breakdown', () => {
  it('pays for leftovers, combos, gold and a clean run', () => {
    const lines = rewardLines({
      stars: 3,
      movesLeft: 8,
      goldenCoins: 4,
      comboCoins: 10,
      clean: true,
      baseCoins: 60,
    });

    const byId = Object.fromEntries(lines.map((line) => [line.id, line.coins]));
    expect(byId.base).toBe(60);
    expect(byId.stars).toBe(20);
    expect(byId.combo).toBe(10);
    expect(byId.golden).toBe(4);
    expect(byId.clean).toBe(CLEAN_RUN_BONUS);
    expect(byId.moves).toBe(16);
    expect(lines.every((line) => line.coins > 0)).toBe(true);
  });

  it('drops everything the player did not earn', () => {
    const lines = rewardLines({
      stars: 1,
      movesLeft: 0,
      goldenCoins: 0,
      comboCoins: 0,
      clean: false,
      baseCoins: 30,
    });

    expect(lines).toEqual([{ id: 'base', label: 'Награда за уровень', coins: 30 }]);
  });

  it('caps the reward for a huge pile of unused moves', () => {
    expect(movesLeftBonus(0)).toBe(0);
    expect(movesLeftBonus(3)).toBe(6);
    expect(movesLeftBonus(15)).toBe(30);
    expect(movesLeftBonus(120)).toBe(30);
    expect(movesLeftBonus(-4)).toBe(0);
  });
});
