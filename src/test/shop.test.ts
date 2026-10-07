import { beforeEach, describe, expect, it } from 'vitest';
import { generateBoard } from '../core/generate';
import { findHint } from '../core/solver';
import type { LevelConfig } from '../data/levels/types';
import { ITEMS } from '../data/items';
import {
  EMPTY_BONUS,
  FREE_DECOR_ID,
  SHOP_ITEMS,
  decorPreset,
  ownedBonus,
  ownedItemTypes,
  totalShopPrice,
} from '../data/shop';
import { LEVELS } from '../data/levels';
import { coinsForLevel } from '../data/levels/campaign';
import { createLevelRuntime, levelOutcome, playMove } from '../game/levelRuntime';
import { useGameStore } from '../store/gameStore';

const HEX = /^#[0-9a-f]{6}$/i;

describe('shop catalogue', () => {
  it('has unique ids and valid prices', () => {
    const ids = SHOP_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of SHOP_ITEMS) {
      expect(item.price).toBeGreaterThanOrEqual(0);
      expect(item.name.length).toBeGreaterThan(3);
      expect(item.description.length).toBeGreaterThan(8);
      expect(ITEMS[item.icon], `${item.id} icon`).toBeTruthy();
    }
  });

  it('sells departments, sets and interior presets', () => {
    const kinds = new Set(SHOP_ITEMS.map((item) => item.kind));
    expect(kinds).toEqual(new Set(['department', 'set', 'decor']));
    expect(SHOP_ITEMS.filter((item) => item.kind === 'department').length).toBeGreaterThanOrEqual(4);
    expect(SHOP_ITEMS.filter((item) => item.kind === 'set').length).toBeGreaterThanOrEqual(4);
    expect(SHOP_ITEMS.filter((item) => item.kind === 'decor').length).toBeGreaterThanOrEqual(4);
  });

  it('offers only existing products and paintable interior presets', () => {
    for (const item of SHOP_ITEMS) {
      for (const type of item.items ?? []) expect(ITEMS[type], `${item.id} sells ${type}`).toBeTruthy();

      if (item.kind === 'decor') {
        expect(item.decor, `${item.id} has a preset`).toBeTruthy();
        const preset = item.decor!;
        for (const colour of [preset.wallTop, preset.wallBottom, preset.plank, preset.plankLight, preset.caseColor, preset.well]) {
          expect(colour).toMatch(HEX);
        }
        expect(decorPreset(preset.id).id).toBe(preset.id);
      } else {
        expect((item.items ?? []).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('has a free starter interior', () => {
    const free = SHOP_ITEMS.find((item) => item.id === FREE_DECOR_ID);
    expect(free?.price).toBe(0);
    expect(decorPreset('unknown-preset').id).toBe('cozy');
  });

  it('sums the bonuses of the purchased items', () => {
    expect(ownedBonus([])).toEqual(EMPTY_BONUS);

    const bonus = ownedBonus(['dept-toys', 'dept-tech', 'dept-flowers']);
    expect(bonus.bonusMoves).toBe(2);
    expect(bonus.bonusHints).toBe(1);
    expect(bonus.bonusUndos).toBe(1);
    expect(bonus.coinBonus).toBeCloseTo(0.15);

    const types = ownedItemTypes(['dept-tech']);
    expect(types).toContain('phone');
    expect(new Set(types).size).toBe(types.length);
  });

  it('stays affordable: everything can be bought from level rewards', () => {
    // Worst case: a player finishes every level with one star (base reward only).
    const available = LEVELS.reduce((sum, level) => sum + (level.coins ?? coinsForLevel(level.id)), 0);
    expect(available).toBeGreaterThan(totalShopPrice() * 1.3);

    // and a perfect run (three stars everywhere) leaves a comfortable surplus
    const perfect = LEVELS.reduce((sum, level) => sum + (level.coins ?? coinsForLevel(level.id)) + 20, 0);
    expect(perfect).toBeGreaterThan(totalShopPrice() * 1.6);
  });
});

describe('golden products', () => {
  const config: LevelConfig = {
    id: 999,
    name: 'Золотая полка',
    rows: 4,
    cols: 6,
    generator: {
      kind: 'scramble',
      seed: 4242,
      groups: [{ type: 'bread', count: 3 }],
      golden: [{ type: 'apple', count: 3 }],
      scrambleMoves: 4,
    },
    goal: { kind: 'clearAll' },
    moveLimit: 20,
    hints: 2,
    undos: 2,
    coins: 30,
  };

  it('keeps the golden flag on the board', () => {
    const runtime = createLevelRuntime(config);
    const golden = runtime.board.cells.filter((cell) => cell.special === 'golden');
    expect(golden).toHaveLength(3);
    expect(golden.every((cell) => cell.type === 'apple')).toBe(true);
  });

  it('pays one extra move and bonus coins for the golden triple', () => {
    let runtime = createLevelRuntime(config);
    const limit = runtime.moveLimit;
    expect(runtime.goldenCollected).toBe(0);

    // apples exist only as the golden triple, so collecting apples means golden
    let moves = 0;
    while (runtime.status === 'playing' && moves < 40) {
      const step = planStep(runtime);
      if (!step) break;
      const outcome = playMove(runtime, step.from, step.to);
      expect(outcome.result.ok).toBe(true);
      runtime = outcome.runtime;
      moves += 1;
    }

    expect(runtime.status).toBe('won');
    expect(runtime.goldenCollected).toBe(1);
    expect(runtime.bonusCoins).toBe(2);
    expect(runtime.movesLeft).toBe(limit - moves + 1);

    const outcome = levelOutcome(runtime);
    expect(outcome.golden).toBe(1);
    expect(outcome.coins).toBeGreaterThan(30);
  });

  it('applies the shop coin bonus to the reward', () => {
    let runtime = createLevelRuntime(config);
    let moves = 0;
    while (runtime.status === 'playing' && moves < 40) {
      const step = planStep(runtime);
      if (!step) break;
      runtime = playMove(runtime, step.from, step.to).runtime;
      moves += 1;
    }

    const plain = levelOutcome(runtime);
    const boosted = levelOutcome(runtime, { bonus: { ...EMPTY_BONUS, coinBonus: 0.5 } });
    expect(boosted.coins).toBe(Math.round(plain.coins * 1.5));
    expect(plain.status).toBe('won');
  });

  it('applies shop bonuses to the level runtime', () => {
    const plain = createLevelRuntime(config);
    const boosted = createLevelRuntime(config, {
      bonus: { bonusMoves: 3, bonusHints: 2, bonusUndos: 1, coinBonus: 0 },
    });

    expect(boosted.moveLimit).toBe(plain.moveLimit + 3);
    expect(boosted.movesLeft).toBe(boosted.moveLimit);
    expect(boosted.hintsLeft).toBe(plain.hintsLeft + 2);
    expect(boosted.undosLeft).toBe(plain.undosLeft + 1);
    expect(boosted.par).toBe(plain.par);
  });

  it('never breaks the board layout with locked cells', () => {
    const generated = generateBoard(4, 6, {
      kind: 'scramble',
      seed: 77,
      groups: [{ type: 'apple', count: 3 }],
      locked: [5, 11],
    });
    expect(generated.locked).toEqual([5, 11]);
    expect(generated.board.cells[5]?.locked).toBe(true);
    expect(generated.board.cells[5]?.type).toBeNull();
  });
});

/** One hint-driven step — the solver always finds a way to collect a triple. */
function planStep(runtime: ReturnType<typeof createLevelRuntime>): { from: number; to: number } | null {
  const hint = findHint(runtime.board, {});
  return hint ? { from: hint.from, to: hint.to } : null;
}

describe('game store · shop', () => {
  beforeEach(async () => {
    await useGameStore.getState().resetProgress();
    useGameStore.setState({ hydrated: true });
  });

  it('buys an item, deducts coins and remembers it', () => {
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 500, unlockedLevel: 20 } });

    expect(useGameStore.getState().purchase('dept-sweets')).toBe(true);
    const after = useGameStore.getState();
    expect(after.progress.owned).toContain('dept-sweets');
    expect(after.progress.coins).toBe(500 - 220);
    expect(after.toast?.tone).toBe('good');
    expect(ownedBonus(after.progress.owned).bonusHints).toBe(1);

    // a second purchase of the same item is refused
    expect(useGameStore.getState().purchase('dept-sweets')).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(280);
  });

  it('refuses purchases without coins or before the unlock level', () => {
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 10, unlockedLevel: 1 } });

    expect(useGameStore.getState().purchase('dept-sweets')).toBe(false);
    expect(useGameStore.getState().toast?.tone).toBe('info'); // locked level comes first

    useGameStore.setState({ progress: { ...useGameStore.getState().progress, unlockedLevel: 30 } });
    expect(useGameStore.getState().purchase('dept-sweets')).toBe(false);
    expect(useGameStore.getState().toast?.tone).toBe('bad'); // not enough coins
    expect(useGameStore.getState().progress.owned).not.toContain('dept-sweets');
  });

  it('switches the interior once it is owned', () => {
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 400, unlockedLevel: 20 } });

    expect(useGameStore.getState().setActiveDecor('decor-mint')).toBe(false); // not owned yet
    expect(useGameStore.getState().purchase('decor-mint')).toBe(true);
    expect(useGameStore.getState().progress.activeDecor).toBe('decor-mint');
    expect(useGameStore.getState().setActiveDecor(FREE_DECOR_ID)).toBe(true);
    expect(useGameStore.getState().progress.activeDecor).toBe(FREE_DECOR_ID);
  });

  it('levels up with shop bonuses applied', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 1000, unlockedLevel: 30, owned: ['decor-cozy', 'dept-toys', 'dept-tech'] },
    });

    useGameStore.getState().startLevel(30);
    const runtime = useGameStore.getState().runtime;
    expect(runtime?.config.id).toBe(30);
    expect(runtime?.hintsLeft).toBeGreaterThanOrEqual(3);
    // +2 moves from the toy department
    expect(runtime?.moveLimit).toBeGreaterThan(runtime!.par + 2);
  });
});
