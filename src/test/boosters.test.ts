import { describe, expect, it } from 'vitest';
import { cellAt, createEmptyBoard, frozenIndices, itemCount, placeNewItem } from '../core/board';
import { applyMove, legalMoves } from '../core/moves';
import { findAllRuns } from '../core/match';
import { createRng } from '../core/rng';
import { generateBoard } from '../core/generate';
import { createGoalState, updateGoalState } from '../core/goal';
import {
  BOOSTERS,
  BOOSTER_IDS,
  EXTRA_MOVES,
  boosterCount,
  canHammer,
  emptyBoosters,
  grantBooster,
  hammerCell,
  hasBooster,
  leftoverTypes,
  shufflableIndices,
  shuffleItems,
  spendBooster,
  starterBoosters,
} from '../core/boosters';
import type { BoardState } from '../core/types';

/** Goal progress, i.e. how many products the player still has to see disappear. */
function runtimeProgress(goal: ReturnType<typeof createGoalState>, board: BoardState): number {
  return updateGoalState(goal, board).removedTotal;
}

function layout(rows: string[], palette: Record<string, string> = {}): BoardState {
  const cols = rows[0]!.trim().split(/\s+/).length;
  return generateBoard(rows.length, cols, {
    kind: 'layout',
    rows,
    palette: { a: 'apple', b: 'bread', c: 'milk', d: 'flower', ...palette },
  }).board;
}

describe('booster catalogue', () => {
  it('has four boosters with unique icons and ids', () => {
    expect(BOOSTER_IDS).toHaveLength(4);
    expect(new Set(BOOSTER_IDS).size).toBe(4);
    for (const id of BOOSTER_IDS) {
      const def = BOOSTERS[id];
      expect(def.id).toBe(id);
      expect(def.title.length).toBeGreaterThan(0);
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.hint.length).toBeGreaterThan(0);
    }
    expect(BOOSTERS.hammer.needsTarget).toBe(true);
    expect(BOOSTERS.shuffle.needsTarget).toBe(false);
  });
});

describe('inventory', () => {
  it('starts with a small usable set', () => {
    const inventory = starterBoosters();
    for (const id of BOOSTER_IDS) expect(hasBooster(inventory, id)).toBe(true);
    expect(boosterCount(inventory, 'hammer')).toBeGreaterThan(0);
  });

  it('spends one at a time and refuses to go negative', () => {
    let inventory = emptyBoosters();
    expect(spendBooster(inventory, 'hammer')).toBeNull();

    inventory = grantBooster(inventory, 'hammer', 2);
    expect(boosterCount(inventory, 'hammer')).toBe(2);

    const after = spendBooster(inventory, 'hammer');
    expect(after && boosterCount(after, 'hammer')).toBe(1);
    expect(boosterCount(inventory, 'hammer')).toBe(2); // pure

    const last = spendBooster(after!, 'hammer');
    expect(last && boosterCount(last, 'hammer')).toBe(0);
    expect(spendBooster(last!, 'hammer')).toBeNull();
  });

  it('ignores broken counts', () => {
    const broken = { ...emptyBoosters(), hammer: Number.NaN, shuffle: -3, extraMove: 1.7 } as never;
    expect(boosterCount(broken, 'hammer')).toBe(0);
    expect(hasBooster(broken, 'shuffle')).toBe(false);
    expect(boosterCount(broken, 'extraMove')).toBe(1);
  });
});

describe('hammer', () => {
  it('removes exactly one product', () => {
    const board = layout(['a a a', 'b b b']);
    const before = itemCount(board);
    const result = hammerCell(board, 0);

    expect(result).not.toBeNull();
    expect(result!.cleared.type).toBe('apple');
    expect(result!.cleared.index).toBe(0);
    expect(itemCount(result!.board)).toBe(before - 1);
    expect(cellAt(result!.board, 0).type).toBeNull();
    // the original board is untouched
    expect(itemCount(board)).toBe(before);
  });

  it('refuses empty and locked cells', () => {
    const board = createEmptyBoard(2, 3, [1]);
    placeNewItem(board, 0, 'apple');

    expect(canHammer(board, 0)).toBeNull();
    expect(canHammer(board, 1)).toBe('empty-cell');
    expect(canHammer(board, 2)).toBe('empty-cell');
    expect(canHammer(board, 99)).toBe('no-target');
    expect(hammerCell(board, 2)).toBeNull();
  });

  it('frees a frozen product and melts its ice', () => {
    const board = layout(['a~ a a a', 'b b b ..']);
    expect(cellAt(board, 0).frozen).toBe(true);

    const result = hammerCell(board, 0)!;
    expect(cellAt(result.board, 0).frozen).toBe(false);
    expect(frozenIndices(result.board)).toEqual([]);
  });

  it('reports the products that became unmatchable', () => {
    const board = layout(['a a a a', 'b b b ..']);
    const result = hammerCell(board, 0)!;

    expect(result.leftoversLeft).toBe(3); // 4 apples - 1 = 3, still matchable
    expect(result.leftovers).toEqual([]);

    const second = hammerCell(result.board, 1)!;
    expect(second.leftoversLeft).toBe(2);
    expect(second.leftovers).toHaveLength(2);
    expect(second.leftovers.every((item) => item.type === 'apple')).toBe(true);
  });

  it('never makes a level impossible: the goal ignores the leftovers', () => {
    const board = layout(['a a a ..', 'b b b ..']);
    const goal = createGoalState(board, { kind: 'clearAll' });
    expect(goal.total).toBe(6);

    // the hammer eats one apple, the other two can never be matched again
    const hammered = hammerCell(board, 0)!;
    const state = updateGoalState(goal, hammered.board);
    expect(state.done).toBe(false); // the bread is still there
    expect(state.removedTotal).toBe(3); // the hammered apple + two unmatchable ones

    // clearing the bread finishes the level, even though two apples stay behind
    const finished = updateGoalState(state, layout(['a a ..', '.. .. ..'], { a: 'apple' }));
    expect(finished.done).toBe(true);
    expect(finished.removedTotal).toBe(6);

    // a collect goal is not credited like that: leftovers are not "collected"
    const collect = createGoalState(board, { kind: 'collect', targets: { bread: 3 } });
    const collectState = updateGoalState(collect, hammered.board);
    expect(collectState.removed.bread).toBe(0);
    expect(collectState.done).toBe(false);
  });

  it('lists the leftovers of a board', () => {
    expect(leftoverTypes(layout(['a a a', 'b b ..']))).toEqual([{ type: 'bread', count: 2 }]);
    expect(leftoverTypes(layout(['a a a', 'b b b']))).toEqual([]);
  });
});

describe('shuffle', () => {
  it('rearranges the products without creating triples', () => {
    const board = layout(['a a .. a a', 'b b .. b b']);

    const count = (b: BoardState): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const cell of b.cells) if (cell.type) counts[cell.type] = (counts[cell.type] ?? 0) + 1;
      return counts;
    };

    for (const seed of [1, 3, 5, 9, 17]) {
      const result = shuffleItems(board, createRng(seed));
      expect(result, `seed ${seed}`).not.toBeNull();

      // same products, same number of free cells, no ready-made triple
      expect(itemCount(result!.board)).toBe(itemCount(board));
      expect(count(result!.board)).toEqual(count(board));
      expect(findAllRuns(result!.board)).toHaveLength(0);

      const free = (b: BoardState): number => b.cells.filter((cell) => cell.type === null).length;
      expect(free(result!.board)).toBe(free(board));
      expect(result!.moved).toBeGreaterThan(0);
    }
  });

  it('never moves a locked or frozen product', () => {
    const board = layout(['a~ a .. b', 'c c .. b']);

    const frozen = frozenIndices(board)[0];
    expect(frozen).toBe(0);

    const movable = shufflableIndices(board);
    expect(movable).not.toContain(0);

    const result = shuffleItems(board, createRng(5));
    expect(result).not.toBeNull();
    expect(cellAt(result!.board, 0).type).toBe(cellAt(board, 0).type);
    expect(cellAt(result!.board, 0).frozen).toBe(true);
    expect(cellAt(result!.board, 0).uid).toBe(cellAt(board, 0).uid);
  });

  it('does nothing when there is nothing to shuffle', () => {
    const board = createEmptyBoard(2, 3);
    placeNewItem(board, 0, 'apple');
    expect(shufflableIndices(board)).toEqual([0]);
    expect(shuffleItems(board, createRng(1))).toBeNull();
  });

  it('cannot break a level: the shuffled board still has legal moves', () => {
    const board = layout(['a a a .. a a a', 'b b b .. .. ..  ..']);
    const goal = createGoalState(board, { kind: 'clearAll' });
    const result = shuffleItems(board, createRng(9))!;

    expect(updateGoalState(goal, result.board).done).toBe(false);
    // nothing was removed, so the shuffle cannot have made progress for free
    expect(runtimeProgress(goal, result.board)).toBe(0);
    expect(findAllRuns(result.board)).toHaveLength(0);

    const moves = legalMoves(result.board);
    expect(moves.length).toBeGreaterThan(0);
    expect(applyMove(result.board, moves[0]!.from, moves[0]!.to).ok).toBe(true);
  });
});

describe('boosters do not touch the generator', () => {
  it('the level generator and the solver know nothing about boosters', () => {
    // a booster is applied to a board, never to a `LevelConfig`
    const generated = generateBoard(4, 6, {
      kind: 'scramble',
      seed: 77,
      groups: [
        { type: 'apple', count: 6 },
        { type: 'bread', count: 6 },
      ],
      scrambleMoves: 8,
    });

    const hammered = hammerCell(generated.board, generated.solution[0]!.from)!;
    expect(itemCount(hammered.board)).toBe(itemCount(generated.board) - 1);
    // the verified solution is still there and untouched
    expect(generated.solution.length).toBeGreaterThan(0);
    expect(generated.par).toBe(generated.solution.length);
  });
});

describe('constants used by the runtime', () => {
  it('adds three moves per extra-move booster', () => {
    expect(EXTRA_MOVES).toBe(3);
  });
});
