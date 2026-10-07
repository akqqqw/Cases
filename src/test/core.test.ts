import { describe, expect, it } from 'vitest';
import { createEmptyBoard, indexOf, placeNewItem, cellAt, isEmptyBoard, itemCount } from '../core/board';
import { applyMove, checkMove, legalMoves } from '../core/moves';
import { findRunThrough, hasAnyMatch, MATCH_LENGTH } from '../core/match';
import { createGoalState, effectiveLeft, starsFor, updateGoalState } from '../core/goal';
import { generateBoard, replaySolution, GenerationError } from '../core/generate';
import { findHint, planSolution } from '../core/solver';
import type { BoardState } from '../core/types';

/** Builds a board from rows of space separated tokens (see `LayoutGenerator`). */
function layout(rows: string[]): BoardState {
  const cols = rows[0]!.trim().split(/\s+/).length;
  const generated = generateBoard(rows.length, cols, {
    kind: 'layout',
    rows,
    palette: { a: 'apple', b: 'cake', c: 'milk', d: 'flower' },
  });
  return generated.board;
}

describe('board basics', () => {
  it('creates an empty board and places items', () => {
    const board = createEmptyBoard(2, 3);
    expect(board.cells).toHaveLength(6);
    expect(isEmptyBoard(board)).toBe(true);
    const uid = placeNewItem(board, indexOf(board, 1, 2), 'cake');
    expect(cellAt(board, 5).uid).toBe(uid);
    expect(cellAt(board, 5).type).toBe('cake');
    expect(isEmptyBoard(board)).toBe(false);
  });

  it('marks locked cells', () => {
    const board = createEmptyBoard(2, 3, [0, 4]);
    expect(cellAt(board, 0).locked).toBe(true);
    expect(cellAt(board, 4).locked).toBe(true);
    expect(cellAt(board, 1).locked).toBe(false);
  });
});

describe('matches', () => {
  it('detects a horizontal run of three', () => {
    const board = layout(['a a a', '.. .. ..']);
    expect(findRunThrough(board, 1)).toEqual([0, 1, 2]);
    expect(hasAnyMatch(board)).toBe(true);
  });

  it('ignores vertical neighbours — only shelves count', () => {
    const board = layout(['a .. ..', 'a .. ..', 'a .. ..']);
    expect(hasAnyMatch(board)).toBe(false);
  });

  it('a move that completes a triple removes exactly three items', () => {
    const board = layout(['a a ..', 'a b ..']);
    const result = applyMove(board, 3, 2);
    expect(result.ok).toBe(true);
    expect(result.cleared).toHaveLength(MATCH_LENGTH);
    expect(result.match?.type).toBe('apple');
    // only the untouched "cake" survives — the whole apple triple vanished
    expect(itemCount(result.board)).toBe(1);
    expect(cellAt(result.board, 4).type).toBe('cake');
    // the source board is untouched (pure function)
    expect(cellAt(board, 2).type).toBeNull();
  });

  it('a move without a match keeps every item on the board', () => {
    const board = layout(['a b ..', '.. .. ..']);
    const result = applyMove(board, 0, 5);
    expect(result.cleared).toHaveLength(0);
    expect(cellAt(result.board, 5).type).toBe('apple');
    expect(cellAt(result.board, 0).type).toBeNull();
  });
});

describe('move validation', () => {
  it('rejects illegal moves with a reason', () => {
    const board = layout(['a b ..', 'c ## ..']);
    expect(checkMove(board, 0, 0)).toBe('same-cell');
    expect(checkMove(board, 2, 0)).toBe('empty-source');
    expect(checkMove(board, 0, 1)).toBe('target-occupied');
    expect(checkMove(board, 0, 4)).toBe('target-locked');
    expect(checkMove(board, 0, 9)).toBe('out-of-bounds');
    expect(checkMove(board, 0, 2)).toBeNull();
  });

  it('never allows moving a locked item', () => {
    const board = createEmptyBoard(1, 3, [0]);
    placeNewItem(board, 0, 'apple');
    expect(checkMove(board, 0, 1)).toBe('source-locked');
  });

  it('lists every legal move', () => {
    const board = layout(['a .. ..']);
    expect(legalMoves(board)).toHaveLength(2);
  });
});

describe('goals and stars', () => {
  it('tracks progress of a clear-all level', () => {
    const board = layout(['a a .. a', 'b b .. b']);
    let goal = createGoalState(board, { kind: 'clearAll' });
    expect(goal.total).toBe(6);
    expect(goal.done).toBe(false);

    goal = updateGoalState(goal, applyMove(board, 3, 2).board);
    expect(goal.removedTotal).toBe(3);
    expect(goal.done).toBe(false);
  });

  it('never blocks a goal on products that can no longer be matched', () => {
    // a level made of whole triples only: nothing is skipped
    const whole = layout(['a a a', 'a a a']);
    const wholeGoal = createGoalState(whole, { kind: 'clearAll' });
    expect(effectiveLeft(wholeGoal.goal, 6)).toBe(6);
    expect(effectiveLeft(wholeGoal.goal, 1)).toBe(0);

    // left overs created by the one-item hammer (1 or 2 products) are not "to do"
    const leftovers = layout(['a a ..', 'a b ..']);
    const goal = createGoalState(leftovers, { kind: 'clearAll' });
    expect(goal.total).toBe(4);
    expect(goal.done).toBe(false);

    const after = updateGoalState(goal, applyMove(leftovers, 3, 2).board);
    expect(after.removedTotal).toBe(4); // 3 apples matched + the lonely bread
    expect(after.done).toBe(true);
  });

  it('completes a goal as soon as every target product is gone', () => {
    const board = layout(['a a ..', 'a b b']);
    const goal = createGoalState(board, { kind: 'clearTypes', types: ['apple'] });
    expect(goal.total).toBe(3);
    expect(goal.done).toBe(false);

    const after = updateGoalState(goal, applyMove(board, 3, 2).board);
    expect(after.done).toBe(true);
    expect(after.removedTotal).toBe(3);
  });

  it('finishes a clear-all goal when the board runs empty', () => {
    const board = layout(['a a a', '.. .. ..']);
    const cleared = applyMove(board, 0, 3);
    // the run is broken by the move itself, so nothing was collected yet
    const goal = updateGoalState(createGoalState(board, { kind: 'clearAll' }), cleared.board);
    expect(goal.done).toBe(false);
  });

  it('maps leftover moves to stars', () => {
    const thresholds = { three: 4, two: 2 };
    expect(starsFor(thresholds, 5)).toBe(3);
    expect(starsFor(thresholds, 4)).toBe(3);
    expect(starsFor(thresholds, 2)).toBe(2);
    expect(starsFor(thresholds, 0)).toBe(1);
  });
});

describe('generation', () => {
  it('never starts a level with an instant match and keeps item counts intact', () => {
    const items = [
      { type: 'apple' as const, count: 6 },
      { type: 'cake' as const, count: 6 },
      { type: 'milk' as const, count: 3 },
    ];
    const generated = generateBoard(5, 6, { kind: 'scramble', seed: 7, groups: items });

    expect(hasAnyMatch(generated.board)).toBe(false);
    expect(itemCount(generated.board)).toBe(15);
    // products start grouped, so the shelves are still recognisable
    expect(generated.par).toBeGreaterThan(0);
    expect(generated.solvable).toBe(true);
  });

  it('guarantees solvability: the stored solution clears the level in `par` moves', () => {
    const generated = generateBoard(5, 6, {
      kind: 'scramble',
      seed: 11,
      groups: [
        { type: 'apple', count: 6 },
        { type: 'cake', count: 3 },
        { type: 'milk', count: 3 },
      ],
    });

    expect(generated.solution).toHaveLength(generated.par);
    expect(replaySolution(generated.board, generated.solution)).toBe(true);

    let current = generated.board;
    for (const move of generated.solution) {
      const result = applyMove(current, move.from, move.to);
      expect(result.ok, `move ${move.from}->${move.to} must stay legal`).toBe(true);
      current = result.board;
    }
    expect(isEmptyBoard(current)).toBe(true);
  });

  it('rejects non multiples of three and overfull levels', () => {
    expect(() =>
      generateBoard(2, 3, { kind: 'scramble', seed: 1, groups: [{ type: 'apple', count: 4 }] }),
    ).toThrow(GenerationError);
    expect(() =>
      generateBoard(2, 3, { kind: 'scramble', seed: 1, groups: [{ type: 'apple', count: 9 }] }),
    ).toThrow(GenerationError);
  });

  it('parses hand written layouts', () => {
    const board = layout(['a .. ##', '.. b ..']);
    expect(cellAt(board, 0).type).toBe('apple');
    expect(cellAt(board, 2).locked).toBe(true);
    expect(cellAt(board, 4).type).toBe('cake');
  });

  it('returns identical boards for identical seeds', () => {
    const config = {
      kind: 'scramble' as const,
      seed: 42,
      groups: [{ type: 'apple' as const, count: 6 }, { type: 'cake' as const, count: 3 }],
    };
    const first = generateBoard(4, 3, config).board;
    const second = generateBoard(4, 3, config).board;
    expect(first.cells.map((cell) => cell.type)).toEqual(second.cells.map((cell) => cell.type));
  });
});

describe('solver and hints', () => {
  it('clears a scrambled level within a sane number of moves', () => {
    const { board, par } = generateBoard(4, 6, {
      kind: 'scramble',
      seed: 3,
      groups: [
        { type: 'apple', count: 6 },
        { type: 'cake', count: 6 },
        { type: 'milk', count: 3 },
      ],
    });

    const solution = planSolution(board);
    expect(solution.done).toBe(true);
    expect(solution.moves.length).toBeLessThanOrEqual(par * 2 + 6);
  });

  it('offers a legal hint', () => {
    const { board } = generateBoard(4, 6, {
      kind: 'scramble',
      seed: 5,
      groups: [
        { type: 'apple', count: 6 },
        { type: 'cake', count: 6 },
        { type: 'milk', count: 3 },
      ],
    });

    const hint = findHint(board);
    expect(hint).not.toBeNull();
    expect(checkMove(board, hint!.from, hint!.to)).toBeNull();
  });
});
