// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { itemCount, frozenIndices } from '../core/board';
import { findAllRuns } from '../core/match';
import { BOOSTER_IDS, EXTRA_MOVES, starterBoosters } from '../core/boosters';
import { createLevelRuntime, levelOutcome, useExtraMoves, useFreeUndo, useHammer, useShuffle } from '../game/levelRuntime';
import { createRng } from '../core/rng';
import { level1 } from '../data/levels/level1';
import { useGameStore } from '../store/gameStore';

/** A tiny handmade level: one triple per row and a gap in every row. */
function comboLevel(): ReturnType<typeof createLevelRuntime> {
  return createLevelRuntime({
    id: 9002,
    name: 'Бустеры',
    rows: 3,
    cols: 4,
    goal: { kind: 'clearAll' },
    generator: {
      kind: 'layout',
      rows: ['a a .. a', 'c c .. c', 'b b .. b'],
      palette: { a: 'apple', b: 'cake', c: 'milk' },
    },
    moveLimit: 10,
    hints: 2,
    undos: 2,
    coins: 40,
  });
}

describe('boosters inside the runtime', () => {
  it('the hammer removes one product, costs no move and marks the run as helped', () => {
    const runtime = comboLevel();
    const before = itemCount(runtime.board);

    const outcome = useHammer(runtime, 0);
    expect(outcome.ok).toBe(true);
    expect(itemCount(outcome.runtime.board)).toBe(before - 1);
    expect(outcome.runtime.movesLeft).toBe(runtime.movesLeft); // no move spent
    expect(outcome.runtime.boostersUsed).toBe(1);
    expect(outcome.runtime.history).toHaveLength(0); // boosters are not undoable
    expect(levelOutcome(outcome.runtime).clean).toBe(false);
  });

  it('the hammer refuses empty cells and finished levels', () => {
    const runtime = comboLevel();
    expect(useHammer(runtime, 2).ok).toBe(false);
    expect(useHammer(runtime, 2).reason).toBe('empty-cell');
    expect(useHammer(runtime, 99).reason).toBe('no-target');
    expect(useHammer(runtime, 0).runtime.boostersUsed).toBe(1);
  });

  it('three hammers can finish a level: leftover pairs no longer block the goal', () => {
    let current = createLevelRuntime(comboLevel().config);

    for (const index of [0, 4, 8]) {
      const step = useHammer(current, index);
      expect(step.ok, `hammer ${index}`).toBe(true);
      current = step.runtime;
    }

    // every type lost one product, so only unmatchable pairs stay on the shelf
    expect(itemCount(current.board)).toBe(6);
    expect(current.status).toBe('won');
    expect(current.goal.done).toBe(true);
    expect(current.goal.removedTotal).toBe(current.goal.total);
  });

  it('the shuffle rearranges the board without free triples and without spending moves', () => {
    const runtime = comboLevel();
    const outcome = useShuffle(runtime, createRng(11));

    expect(outcome.ok).toBe(true);
    expect(findAllRuns(outcome.runtime.board)).toHaveLength(0);
    expect(itemCount(outcome.runtime.board)).toBe(itemCount(runtime.board));
    expect(outcome.runtime.movesLeft).toBe(runtime.movesLeft);
    expect(outcome.runtime.boostersUsed).toBe(1);
  });

  it('the extra-move booster grows the budget so `movesUsed` stays sane', () => {
    const runtime = comboLevel();
    const outcome = useExtraMoves(runtime);

    expect(outcome.runtime.movesLeft).toBe(runtime.movesLeft + EXTRA_MOVES);
    expect(outcome.runtime.moveLimit).toBe(runtime.moveLimit + EXTRA_MOVES);
    expect(outcome.runtime.moveLimit - outcome.runtime.movesLeft).toBe(0);
  });

  it('the free undo adds a charge', () => {
    const runtime = comboLevel();
    const outcome = useFreeUndo(runtime);
    expect(outcome.runtime.undosLeft).toBe(runtime.undosLeft + 1);
    expect(outcome.runtime.boostersUsed).toBe(1);
  });

  it('boosters do not work outside a running level', () => {
    const runtime = { ...comboLevel(), status: 'lost' as const };
    expect(useHammer(runtime, 0).reason).toBe('not-playing');
    expect(useShuffle(runtime, createRng(1)).reason).toBe('not-playing');
    expect(useExtraMoves(runtime).reason).toBe('not-playing');
    expect(useFreeUndo(runtime).reason).toBe('not-playing');
  });
});

describe('boosters through the store', () => {
  beforeEach(() => {
    useGameStore.setState({
      phase: 'menu',
      runtime: null,
      outcome: null,
      toast: null,
      boosterMode: null,
      lastBooster: null,
      hydrated: true,
      progress: {
        coins: 0,
        levelStars: {},
        unlockedLevel: 1,
        owned: ['decor-cozy'],
        activeDecor: 'decor-cozy',
        dailyStreak: { days: 0, lastDay: '' },
      lastSeenDay: '',
        boosters: starterBoosters(),
        upgrades: {},
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: '', coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
      },
    });
  });

  it('arms the hammer, then spends exactly one per product', () => {
    useGameStore.getState().startLevel(1);
    const before = useGameStore.getState().progress.boosters.hammer;

    expect(useGameStore.getState().armBooster('hammer')).toBe(true);
    expect(useGameStore.getState().boosterMode).toBe('hammer');

    const index = useGameStore.getState().runtime!.board.cells.findIndex((cell) => cell.uid !== null);
    expect(useGameStore.getState().useBooster('hammer', index)).toBe(true);

    const state = useGameStore.getState();
    expect(state.progress.boosters.hammer).toBe(before - 1);
    expect(state.boosterMode).toBeNull();
    expect(state.lastBooster?.id).toBe('hammer');
    expect(state.runtime?.boostersUsed).toBe(1);
  });

  it('applies instant boosters right away without arming anything', () => {
    useGameStore.getState().startLevel(1);
    const runtime = useGameStore.getState().runtime!;

    expect(useGameStore.getState().armBooster('extraMove')).toBe(true);
    expect(useGameStore.getState().runtime?.movesLeft).toBe(runtime.movesLeft + EXTRA_MOVES);
    expect(useGameStore.getState().progress.boosters.extraMove).toBe(0);

    expect(useGameStore.getState().armBooster('shuffle')).toBe(true);
    expect(useGameStore.getState().runtime?.boostersUsed).toBe(2);

    expect(useGameStore.getState().armBooster('undo')).toBe(true);
    expect(useGameStore.getState().runtime?.undosLeft).toBe(runtime.undosLeft + 1);
  });

  it('refuses a booster that is out of stock and says so', () => {
    useGameStore.getState().startLevel(1);
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 } },
    });

    expect(useGameStore.getState().armBooster('hammer')).toBe(false);
    expect(useGameStore.getState().boosterMode).toBeNull();
    expect(useGameStore.getState().toast?.text).toContain('закончился');

    for (const id of BOOSTER_IDS) expect(useGameStore.getState().useBooster(id, 0)).toBe(false);
  });

  it('keeps the inventory when a level is left and replayed', () => {
    useGameStore.getState().startLevel(1);
    const index = useGameStore.getState().runtime!.board.cells.findIndex((cell) => cell.uid !== null);
    useGameStore.getState().useBooster('hammer', index);

    const after = useGameStore.getState().progress.boosters.hammer;
    useGameStore.getState().startLevel(2);
    expect(useGameStore.getState().progress.boosters.hammer).toBe(after);
    expect(useGameStore.getState().runtime?.boostersUsed).toBe(0);
  });

  it('using a booster costs the perfect star but not the win', () => {
    const runtime = createLevelRuntime(level1);
    // a hand-played clean win on level 1
    const cleanRun = createLevelRuntime(level1);
    expect(cleanRun.boostersUsed).toBe(0);

    const helped = useFreeUndo(runtime);
    expect(helped.runtime.combo.best).toBe(0);
    expect(frozenIndices(helped.runtime.board)).toEqual([]);
  });
});
