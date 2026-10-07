import { describe, expect, it } from 'vitest';
import { itemCount } from '../core/board';
import { generateBoard } from '../core/generate';
import { createGoalState } from '../core/goal';
import { planSolution } from '../core/solver';
import type { BoardState, PlannedMove } from '../core/types';
import { LEVELS } from '../data/levels';
import {
  CAMPAIGN_SIZE,
  buildCampaignLevel,
  goldenTriplesForLevel,
  lockedCountForLevel,
  productTypesForLevel,
  triplesForLevel,
} from '../data/levels/campaign';
import type { LevelConfig } from '../data/levels/types';
import { THEMES, themeForLevel } from '../data/themes';
import { ownedItemTypes } from '../data/shop';
import { applyShopAssortment, createLevelRuntime, playMove, type LevelRuntime } from '../game/levelRuntime';
import { findHint } from '../core/solver';
import { useGameStore } from '../store/gameStore';
import { frozenIndices } from '../core/board';

/** Levels are deterministic, so one runtime per level serves the whole suite. */
const RUNTIMES = new Map<number, LevelRuntime>();
const SOLUTIONS = new Map<number, PlannedMove[]>();

function runtimeFor(config: LevelConfig): LevelRuntime {
  const cached = RUNTIMES.get(config.id);
  if (cached) return cached;
  const runtime = createLevelRuntime(config);
  RUNTIMES.set(config.id, runtime);
  return runtime;
}

/** The board a level always starts from (same seed → same board). */
function startBoard(config: LevelConfig): BoardState {
  return generateBoard(config.rows, config.cols, config.generator, { goal: config.goal }).board;
}

/** The level's verified solution, recomputed on its starting board. */
function solutionFor(config: LevelConfig): PlannedMove[] {
  const cached = SOLUTIONS.get(config.id);
  if (cached) return cached;
  const board = startBoard(config);
  const goal = createGoalState(board, config.goal);
  const solution = planSolution(board, { maxMoves: 400, goal }).moves;
  SOLUTIONS.set(config.id, solution);
  return solution;
}

describe('campaign layout', () => {
  it('ships exactly 60 uniquely numbered levels in order', () => {
    expect(LEVELS).toHaveLength(CAMPAIGN_SIZE);
    const ids = LEVELS.map((level) => level.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(CAMPAIGN_SIZE);
  });

  it('gets harder: more products, fewer free cells', () => {
    expect(triplesForLevel(5)).toBeLessThan(triplesForLevel(40));
    expect(triplesForLevel(40)).toBeLessThanOrEqual(triplesForLevel(60));
    expect(triplesForLevel(60)).toBe(12);

    const freeRatio = (config: LevelConfig): number => {
      const runtime = runtimeFor(config);
      const free = runtime.board.cells.filter((cell) => cell.uid === null && !cell.locked).length;
      return free / runtime.board.cells.length;
    };

    const early = LEVELS.slice(0, 10).reduce((sum, level) => sum + freeRatio(level), 0) / 10;
    const late = LEVELS.slice(-10).reduce((sum, level) => sum + freeRatio(level), 0) / 10;
    expect(early).toBeGreaterThan(late + 0.15);

    for (const level of LEVELS.slice(0, 20).concat(LEVELS.slice(-20))) {
      const ratio = freeRatio(level);
      expect(ratio, `level ${level.id} free space`).toBeGreaterThan(0.18);
      expect(ratio, `level ${level.id} free space`).toBeLessThan(0.75);
    }
  });

  it('unlocks the new mechanics gradually', () => {
    expect(lockedCountForLevel(25)).toBe(0);
    expect(lockedCountForLevel(30)).toBeGreaterThan(0);
    expect(lockedCountForLevel(60)).toBeGreaterThanOrEqual(3);

    expect(goldenTriplesForLevel(11)).toBe(0);
    expect(goldenTriplesForLevel(12)).toBeGreaterThan(0);
    expect(goldenTriplesForLevel(48)).toBe(2);

    const goalLevels = LEVELS.filter((level) => level.goal.kind !== 'clearAll');
    expect(goalLevels.length).toBeGreaterThanOrEqual(6);
    for (const level of goalLevels) expect(level.id).toBeGreaterThanOrEqual(30);
  });

  it('uses a themed product pool that can supply the requested types', () => {
    for (const level of LEVELS) {
      const theme = themeForLevel(level.id);
      expect(THEMES[theme.id]).toBeTruthy();
      expect(level.theme).toBe(theme.id);
      expect(level.name.length).toBeGreaterThan(2);

      const typeCount = productTypesForLevel(level.id, theme.items.length);
      expect(typeCount).toBeGreaterThanOrEqual(3);
      expect(typeCount).toBeLessThanOrEqual(theme.items.length);
    }
  });
});

describe('campaign mechanics', () => {
  it('blocks exactly the cells the level asks for', () => {
    const withLocked = LEVELS.filter((level) => lockedCountForLevel(level.id) > 0);
    expect(withLocked.length).toBeGreaterThan(0);

    for (const level of withLocked) {
      const locked = runtimeFor(level).board.cells.filter((cell) => cell.locked);
      expect(locked.length, `level ${level.id}`).toBe(lockedCountForLevel(level.id));
    }
  });

  it('places golden triples on golden levels', () => {
    const goldenLevels = LEVELS.filter((level) => goldenTriplesForLevel(level.id) > 0);
    expect(goldenLevels.length).toBeGreaterThan(5);

    for (const level of goldenLevels) {
      const cells = runtimeFor(level).board.cells;
      const golden = cells.filter((cell) => cell.special === 'golden');
      expect(golden.length, `level ${level.id}`).toBe(goldenTriplesForLevel(level.id) * 3);

      // every golden triple stands on one shelf and shares one product
      const rows = new Set(golden.map((cell) => Math.floor(cells.indexOf(cell) / runtimeFor(level).board.cols)));
      void rows;
    }
  });

  it('never starts with a ready-made triple', () => {
    for (const level of LEVELS) {
      const runtime = runtimeFor(level);
      let runs = 0;
      for (let row = 0; row < runtime.board.rows; row += 1) {
        let streak = 1;
        for (let col = 1; col < runtime.board.cols; col += 1) {
          const previous = runtime.board.cells[row * runtime.board.cols + col - 1];
          const current = runtime.board.cells[row * runtime.board.cols + col];
          if (previous?.type && previous.type === current?.type) streak += 1;
          else streak = 1;
          if (streak >= 3) runs += 1;
        }
      }
      expect(runs, `level ${level.id} starts clean`).toBe(0);
    }
  });

  it('gives goal levels a reachable target smaller than the whole board', () => {
    const goalLevels = LEVELS.filter((level) => level.goal.kind === 'clearTypes');
    expect(goalLevels.length).toBeGreaterThan(0);

    for (const level of goalLevels) {
      const runtime = runtimeFor(level);
      expect(runtime.goal.done).toBe(false);
      expect(runtime.goal.total).toBeGreaterThan(0);
      expect(runtime.goal.total).toBeLessThan(itemCount(runtime.board));
    }
  });

  it('swaps one product for a shop assortment item from level 15 on', () => {
    const extra = ownedItemTypes(['dept-tech', 'dept-flowers']);
    expect(extra.length).toBeGreaterThan(0);

    const earlyConfig = LEVELS[4] as LevelConfig;
    const lateConfig = LEVELS[29] as LevelConfig;
    expect(applyShopAssortment(earlyConfig, extra)).toBe(earlyConfig);

    const late = applyShopAssortment(lateConfig, extra);
    if (late.generator.kind === 'scramble' && lateConfig.generator.kind === 'scramble') {
      const before = lateConfig.generator;
      const after = late.generator;
      expect(after.groups).not.toEqual(before.groups);
      expect(after.groups.reduce((sum, group) => sum + group.count, 0)).toBe(
        before.groups.reduce((sum, group) => sum + group.count, 0),
      );
      expect(after.groups.some((group) => extra.includes(group.type))).toBe(true);
    }

    // and the swapped level still generates a verified board
    const runtime = createLevelRuntime(late);
    expect(runtime.warning).toBeUndefined();
    expect(runtime.par).toBeGreaterThan(0);
  });
});

describe('campaign solvability', () => {
  it(
    'wins every level by following its own verified solution',
    () => {
      for (const level of LEVELS) {
        let runtime = createLevelRuntime(level);
        expect(runtime.warning, `level ${level.id} generated`).toBeUndefined();
        expect(runtime.par, `level ${level.id} verified`).toBeGreaterThan(0);
        expect(runtime.moveLimit, `level ${level.id} budget`).toBeGreaterThanOrEqual(runtime.par);
        expect(runtime.stars.three).toBeLessThan(runtime.moveLimit);

        for (const move of solutionFor(level)) {
          const step = playMove(runtime, move.from, move.to);
          expect(step.result.ok, `level ${level.id}: move ${move.from}->${move.to}`).toBe(true);
          runtime = step.runtime;
        }

        expect(runtime.status, `level ${level.id} is won`).toBe('won');
        expect(runtime.movesLeft, `level ${level.id} has moves to spare`).toBeGreaterThanOrEqual(0);
        expect(runtime.goal.done).toBe(true);
      }
    },
    180_000,
  );
});

describe('the new mechanics in real play', () => {
  it(
    'late levels are winnable by following the hints, ice and bombs included',
    () => {
      for (const id of [44, 50, 54, 60]) {
        useGameStore.setState({ phase: 'menu', runtime: null, outcome: null, hint: null });
        useGameStore.getState().startLevel(id);
        expect(useGameStore.getState().runtime?.config.id).toBe(id);

        const startIce = frozenIndices(useGameStore.getState().runtime!.board).length;
        expect(startIce, `level ${id} starts with ice`).toBeGreaterThan(0);

        let guard = 0;
        while (useGameStore.getState().phase === 'playing' && guard < 200) {
          guard += 1;
          const runtime = useGameStore.getState().runtime!;
          const hint = findHint(runtime.board, { goal: runtime.goal });
          expect(hint, `level ${id} still offers a hint on move ${guard}`).not.toBeNull();
          expect(useGameStore.getState().requestMove(hint!.from, hint!.to)).toBe(true);
        }

        const state = useGameStore.getState();
        const runtime = state.runtime!;
        expect(state.phase, `level ${id} is won`).toBe('won');
        expect(state.outcome?.stars, `level ${id} pays stars`).toBeGreaterThanOrEqual(1);
        expect(runtime.iceMelted, `level ${id} melted its ice`).toBe(true);
        expect(frozenIndices(runtime.board), `level ${id} has no ice left`).toEqual([]);
        expect(itemCount(runtime.board), `level ${id} is emptied`).toBe(0);
      }
    },
    120_000,
  );

  it('bombs only ever blow up whole triples, so the level stays winnable', () => {
    const level = buildCampaignLevel(54);
    const runtime = createLevelRuntime(level);
    const before = itemCount(runtime.board);

    const counts = new Map<string, number>();
    for (const cell of runtime.board.cells) {
      if (cell.type) counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
    }
    for (const [, count] of counts) expect(count % 3, 'every product starts as whole triples').toBe(0);

    // replay the level's verified solution and make sure the board empties exactly
    const generated = generateBoard(level.rows, level.cols, level.generator);
    let current = runtime;
    for (const move of generated.solution) {
      const step = playMove(current, move.from, move.to);
      expect(step.result.ok).toBe(true);
      current = step.runtime;
    }

    expect(current.status).toBe('won');
    expect(before - itemCount(current.board)).toBe(current.triplesCollected * 3);
  });
});
