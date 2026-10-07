import { describe, expect, it } from 'vitest';
import { cellAt, clearCell, countByType, createEmptyBoard, frozenIndices, itemCount, placeNewItem, thawAll } from '../core/board';
import { applyMove, checkMove } from '../core/moves';
import { generateBoard } from '../core/generate';
import { BLAST_SIZE, applyBlast, hasBomb, hasGolden, planBlast } from '../core/specials';
import { createLevelRuntime, playMove } from '../game/levelRuntime';
import { LEVELS } from '../data/levels';
import { buildCampaignLevel, bombTriplesForLevel, frozenCountForLevel, ICE_MELT_AFTER } from '../data/levels/campaign';
import type { BoardState } from '../core/types';

function layout(rows: string[]): BoardState {
  const cols = rows[0]!.trim().split(/\s+/).length;
  return generateBoard(rows.length, cols, {
    kind: 'layout',
    rows,
    palette: { a: 'apple', b: 'cake', c: 'milk', d: 'flower' },
  }).board;
}

describe('iced products', () => {
  it('freezes cells and blocks dragging out of them', () => {
    const board = createEmptyBoard(2, 3, [], [1]);
    expect(cellAt(board, 1).frozen).toBe(true);
    expect(frozenIndices(board)).toEqual([1]);

    placeNewItem(board, 0, 'apple');
    placeNewItem(board, 1, 'apple');
    expect(checkMove(board, 1, 2)).toBe('source-frozen');
    expect(checkMove(board, 0, 2)).toBeNull();
  });

  it('freezes real products through the generator and keeps the level valid', () => {
    const generated = generateBoard(5, 6, {
      kind: 'scramble',
      seed: 4242,
      groups: [{ type: 'apple', count: 6 }, { type: 'cake', count: 6 }, { type: 'milk', count: 3 }],
      frozen: 2,
      scrambleMoves: 6,
    });

    expect(generated.frozen).toHaveLength(2);
    for (const index of generated.frozen) {
      expect(cellAt(generated.board, index).frozen).toBe(true);
      expect(cellAt(generated.board, index).type).not.toBeNull();
    }
    // the stored solution still clears the level, even though it was planned
    // before the ice appeared: matches happen in place
    const replay = generated.solution.reduce<BoardState | null>(
      (state, move, index) => {
        if (!state) return null;
        const result = applyMove(state, move.from, move.to);
        expect(result.ok, `move ${index + 1} rejected`).toBe(true);
        return result.board;
      },
      generated.board,
    );
    expect(replay && itemCount(replay)).toBe(0);
  });

  it('melts the ice of a cell as soon as the product leaves it', () => {
    const board = createEmptyBoard(1, 3, [], [0, 1, 2]);
    placeNewItem(board, 0, 'apple');
    placeNewItem(board, 1, 'apple');
    placeNewItem(board, 2, 'apple');

    expect(checkMove(board, 2, 5)).toBe('out-of-bounds');

    clearCell(board, 0);
    expect(cellAt(board, 0).frozen).toBe(false);
    expect(frozenIndices(board)).toEqual([1, 2]);

    const thawed = thawAll(board);
    expect(frozenIndices(thawed)).toEqual([]);
    // the original board is untouched — thawAll is pure
    expect(frozenIndices(board)).toEqual([1, 2]);
  });

  it('only unlocks a frozen product once it is matched in place', () => {
    const board = layout([
      'a~ a .. a',
      'b b c c',
    ]);
    expect(cellAt(board, 0).frozen).toBe(true);

    // moving the frozen item is rejected, matching it in place is not
    expect(checkMove(board, 0, 4)).toBe('source-frozen');
    expect(checkMove(board, 1, 0)).toBe('target-occupied');

    // pulling the last "a" into the gap completes the triple — ice and all
    const result = applyMove(board, 3, 2);
    expect(result.ok).toBe(true);
    expect(cellAt(result.board, 0).type).toBeNull();
    expect(cellAt(result.board, 0).frozen).toBe(false);
  });
});

describe('bombs', () => {
  it('always blasts exactly three products of the most numerous type', () => {
    const board = layout([
      'a a a b b c',
      'c d d a a a',
    ]);
    const plan = planBlast(board);
    expect(plan).not.toBeNull();
    expect(plan?.indices).toHaveLength(BLAST_SIZE);

    const before = countByType(board);
    const { board: after, cleared } = applyBlast(board, plan!);
    const victim = plan!.type;
    expect(cleared).toHaveLength(BLAST_SIZE);
    expect(countByType(after)[victim]).toBe((before[victim] ?? 0) - BLAST_SIZE);
  });

  it('never removes something it cannot pay for in full triples', () => {
    const board = createEmptyBoard(1, 3);
    placeNewItem(board, 0, 'apple');
    placeNewItem(board, 1, 'cake');
    placeNewItem(board, 2, 'milk');
    expect(planBlast(board)).toBeNull();
  });

  it('picks the type that has the most products left', () => {
    const board = layout([
      'a a a b',
      'a a b d',
    ]);
    expect(planBlast(board)?.type).toBe('apple');
  });

  it('detects specials in a cleared group', () => {
    expect(hasBomb([{ uid: 1, type: 'apple', index: 0, special: 'bomb' }])).toBe(true);
    expect(hasGolden([{ uid: 1, type: 'apple', index: 0, special: 'golden' }])).toBe(true);
    expect(hasBomb([{ uid: 1, type: 'apple', index: 0, special: null }])).toBe(false);
  });

  it('detonates for real inside the engine on a campaign bomb level', () => {
    const level = buildCampaignLevel(36);
    const generated = generateBoard(level.rows, level.cols, level.generator);
    expect(generated.solution.length).toBeGreaterThan(0);

    let runtime = createLevelRuntime(level);
    const before = itemCount(runtime.board);

    for (const move of generated.solution) {
      const outcome = playMove(runtime, move.from, move.to);
      expect(outcome.result.ok).toBe(true);
      runtime = outcome.runtime;
    }

    expect(runtime.status).toBe('won');
    expect(runtime.bombsDetonated).toBeGreaterThan(0);
    expect(itemCount(runtime.board)).toBe(0);
    // parity: everything vanished in whole triples
    expect((before - runtime.triplesCollected * 3)).toBe(0);
    expect(runtime.bombsDetonated).toBeLessThanOrEqual(runtime.triplesCollected);
  });

  it('keeps the parity rule: the blast empties a multiple of three', () => {
    const board = layout([
      'a a a a b b',
      'c c d d b b',
    ]);
    const plan = planBlast(board);
    expect(plan).not.toBeNull();
    const { board: after } = applyBlast(board, plan!);
    expect((itemCount(board) - itemCount(after)) % 3).toBe(0);
  });
});

describe('levels with the new mechanics', () => {
  it('unlocks bombs and ice only in the late campaign', () => {
    for (const id of [1, 12, 20, 35]) {
      expect(bombTriplesForLevel(id)).toBe(0);
      expect(frozenCountForLevel(id)).toBe(0);
    }
    expect(bombTriplesForLevel(36)).toBeGreaterThan(0);
    expect(frozenCountForLevel(44)).toBe(1);
    expect(frozenCountForLevel(58)).toBe(3);
  });

  it('bakes ice and bombs into the generated boards of the campaign', () => {
    const bombs = LEVELS.filter((level) =>
      level.generator.kind === 'scramble' && (level.generator.bombs?.length ?? 0) > 0,
    );
    const iced = LEVELS.filter((level) => level.id >= 44);

    expect(bombs.length).toBeGreaterThanOrEqual(5);
    expect(iced.length).toBeGreaterThan(0);

    for (const level of [LEVELS.find((l) => l.id === 44)!, LEVELS.find((l) => l.id === 60)!]) {
      const runtime = createLevelRuntime(level);
      expect(frozenIndices(runtime.board).length).toBeGreaterThan(0);
      expect(runtime.iceMelted).toBe(false);
      expect(level.iceMeltAfter).toBe(ICE_MELT_AFTER);
    }
  });

  it('melts all the ice after a few collected triples', () => {
    const level = buildCampaignLevel(44);
    const generated = generateBoard(level.rows, level.cols, level.generator);
    expect(generated.frozen).toHaveLength(1);

    let runtime = createLevelRuntime(level);
    expect(frozenIndices(runtime.board).length).toBeGreaterThan(0);

    for (const move of generated.solution) {
      // the planner already knows about the ice and never drags a frozen product
      const source = runtime.board.cells[move.from]!;
      expect(source.frozen, `move ${move.from}->${move.to} drags a frozen product`).toBe(false);

      const outcome = playMove(runtime, move.from, move.to);
      expect(outcome.result.ok).toBe(true);
      runtime = outcome.runtime;
      if (runtime.iceMelted) break;
    }

    expect(runtime.triplesCollected).toBeGreaterThanOrEqual(ICE_MELT_AFTER);
    expect(runtime.iceMelted).toBe(true);
    expect(frozenIndices(runtime.board)).toEqual([]);
    expect(runtime.status).not.toBe('lost');
  });

  it('thawAll melts everything on a board', () => {
    const board = createEmptyBoard(1, 2, [], [0, 1]);
    placeNewItem(board, 0, 'apple');
    expect(frozenIndices(thawAll(board))).toEqual([]);
  });
});

describe('bomb payload from hand written layouts', () => {
  it('parses `!` as a bomb token and blasts when its triple lands', () => {
    const board = layout([
      'a a! .. a',
      'c c d c',
    ]);
    expect(cellAt(board, 1).special).toBe('bomb');

    const before = itemCount(board);
    const result = applyMove(board, 3, 2);
    expect(result.ok).toBe(true);
    expect(result.blast).not.toBeNull();
    // triple of apples + three blasted products
    expect(result.cleared).toHaveLength(6);
    expect(before - itemCount(result.board)).toBe(6);
    expect((before - itemCount(result.board)) % 3).toBe(0);
  });
});
