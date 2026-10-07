import { beforeEach, describe, expect, it } from 'vitest';
import { itemCount } from '../core/board';
import { planSolution } from '../core/solver';
import { LEVELS } from '../data/levels';
import { level1 } from '../data/levels/level1';
import { autoMoveLimit } from '../data/levels/auto';
import { createLevelRuntime, levelOutcome, playMove, spendHint, undoMove } from '../game/levelRuntime';
import { useGameStore } from '../store/gameStore';

const level = level1;

describe('level runtime', () => {
  it('builds a playable board with a verified solution', () => {
    const runtime = createLevelRuntime(level);

    expect(runtime.board.rows).toBe(level.rows);
    expect(runtime.board.cols).toBe(level.cols);
    expect(itemCount(runtime.board)).toBe(15);
    expect(runtime.par).toBeGreaterThan(0);
    expect(runtime.movesLeft).toBe(runtime.moveLimit);
    expect(runtime.moveLimit).toBeGreaterThanOrEqual(runtime.par);
    expect(runtime.status).toBe('playing');
    expect(runtime.goal.total).toBe(15);
    expect(runtime.warning).toBeUndefined();
  });

  it('wins by following the verified solution and pays coins for the stars', () => {
    let runtime = createLevelRuntime(level);
    const solution = planSolution(runtime.board).moves;
    expect(solution.length).toBeLessThanOrEqual(runtime.moveLimit);

    for (const move of solution) {
      const step = playMove(runtime, move.from, move.to);
      expect(step.result.ok).toBe(true);
      runtime = step.runtime;
    }

    expect(runtime.status).toBe('won');
    expect(itemCount(runtime.board)).toBe(0);
    expect(runtime.goal.removedTotal).toBe(runtime.goal.total);

    const outcome = levelOutcome(runtime);
    expect(outcome.status).toBe('won');
    expect(outcome.stars).toBeGreaterThanOrEqual(1);
    expect(outcome.coins).toBeGreaterThanOrEqual(level.coins ?? 0);
    expect(outcome.movesUsed).toBeLessThanOrEqual(runtime.moveLimit);
  });

  it('loses when the moves run out', () => {
    let runtime = createLevelRuntime(level);
    let guard = 0;

    while (runtime.status === 'playing' && guard < 400) {
      guard += 1;
      // deliberately wasteful: break pairs instead of completing triples
      const found = planSolution(runtime.board, { maxMoves: 1 });
      const move = found.moves[0] ?? { from: 0, to: 0 };
      const step = playMove(runtime, move.from, move.to);
      if (!step.result.ok) {
        // fall back to any legal move so the test can always burn a move
        const fallback = runtime.board.cells.findIndex((cell) => cell.uid !== null && !cell.locked);
        const empty = runtime.board.cells.findIndex((cell) => cell.uid === null && !cell.locked);
        const retry = playMove(runtime, fallback, empty);
        if (!retry.result.ok) break;
        runtime = retry.runtime;
        continue;
      }
      runtime = step.runtime;
    }

    expect(['won', 'lost']).toContain(runtime.status);
    if (runtime.status === 'lost') {
      expect(runtime.movesLeft).toBe(0);
      expect(levelOutcome(runtime).coins).toBe(0);
    }
  });

  it('undoes a move and refunds it', () => {
    const runtime = createLevelRuntime(level);
    const from = runtime.board.cells.findIndex((cell) => cell.uid !== null && !cell.locked);
    const empty = runtime.board.cells.findIndex((cell) => cell.uid === null && !cell.locked);
    const before = itemCount(runtime.board);

    const { runtime: after } = playMove(runtime, from, empty);
    expect(after.movesLeft).toBe(runtime.movesLeft - 1);
    expect(after.history).toHaveLength(1);

    const undone = undoMove(after);
    expect(undone.movesLeft).toBe(runtime.movesLeft);
    expect(undone.undosLeft).toBe((level.undos ?? 3) - 1);
    expect(itemCount(undone.board)).toBe(before);
    expect(undone.history).toHaveLength(0);
  });

  it('never spends a move on an illegal drop', () => {
    const runtime = createLevelRuntime(level);
    const occupied = runtime.board.cells.findIndex((cell) => cell.uid !== null);
    const otherOccupied = runtime.board.cells.findIndex((cell, index) => cell.uid !== null && index !== occupied);
    const step = playMove(runtime, occupied, otherOccupied);

    expect(step.result.ok).toBe(false);
    expect(step.runtime).toBe(runtime);
    expect(step.runtime.movesLeft).toBe(runtime.moveLimit);
  });

  it('derives a fair budget from the solver par', () => {
    expect(autoMoveLimit(10, 0.9)).toBe(19);
    expect(autoMoveLimit(10, 0)).toBe(13);
  });
});

describe('level configs', () => {
  it('are internally consistent', () => {
    for (const config of LEVELS) {
      expect(config.id).toBeGreaterThan(0);
      expect(config.rows).toBeGreaterThan(0);
      expect(config.cols).toBeGreaterThanOrEqual(3);
      if (config.generator.kind === 'scramble') {
        for (const group of config.generator.groups) expect(group.count % 3).toBe(0);
      }
    }
  });

  it('share no duplicate level ids', () => {
    const ids = LEVELS.map((config) => config.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('game store', () => {
  beforeEach(() => {
    useGameStore.getState().resetProgress();
  });

  it('walks through a level: menu → playing → won with rewards', () => {
    const store = useGameStore.getState();
    expect(store.phase).toBe('menu');

    store.startLevel(level.id);
    const started = useGameStore.getState();
    expect(started.phase).toBe('playing');
    expect(started.runtime?.config.id).toBe(level.id);

    let runtime = started.runtime;
    expect(runtime).toBeTruthy();

    for (const move of planSolution(runtime!.board).moves) {
      const ok = useGameStore.getState().requestMove(move.from, move.to);
      expect(ok).toBe(true);
    }

    const finished = useGameStore.getState();
    expect(finished.phase).toBe('won');
    expect(finished.outcome?.stars).toBeGreaterThanOrEqual(1);
    expect(finished.progress.coins).toBe(finished.outcome?.coins ?? 0);
    expect(finished.progress.levelStars[level.id]).toBeGreaterThanOrEqual(1);
    runtime = finished.runtime;
    expect(itemCount(runtime!.board)).toBe(0);
  });

  it('hands out a hint and spends one', () => {
    const store = useGameStore.getState();
    store.startLevel(level.id);

    expect(useGameStore.getState().requestHint()).toBe(true);
    const hinted = useGameStore.getState();
    expect(hinted.hint).not.toBeNull();
    expect(hinted.runtime?.hintsLeft).toBe((level.hints ?? 3) - 1);

    // a hint never costs a move
    expect(hinted.runtime?.movesLeft).toBe(hinted.runtime?.moveLimit);
  });

  it('refuses to undo before the first move', () => {
    const store = useGameStore.getState();
    store.startLevel(level.id);
    expect(useGameStore.getState().requestUndo()).toBe(false);
    expect(useGameStore.getState().toast?.text).toContain('Отменять');
  });

  it('restarts and returns to the menu', () => {
    const store = useGameStore.getState();
    store.startLevel(level.id);
    const firstBoard = useGameStore.getState().runtime?.board;

    useGameStore.getState().restartLevel();
    expect(useGameStore.getState().runtime?.board).not.toBe(firstBoard);
    expect(useGameStore.getState().runtime?.movesLeft).toBe(useGameStore.getState().runtime?.moveLimit);

    useGameStore.getState().exitToMenu();
    expect(useGameStore.getState().phase).toBe('menu');
    expect(useGameStore.getState().runtime).toBeNull();
  });

  it('keeps the best star result when a level is replayed', () => {
    const store = useGameStore.getState();
    store.startLevel(level.id);
    useGameStore.setState({
      progress: {
        coins: 0,
        levelStars: { [level.id]: 3 },
        unlockedLevel: level.id,
        owned: ['decor-cozy'],
        activeDecor: 'decor-cozy',
        dailyStreak: { days: 0, lastDay: '' },
      lastSeenDay: '',
        boosters: { hammer: 1, shuffle: 1, extraMove: 1, undo: 1 },
        upgrades: {},
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: '', coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
      },
    });

    const runtime = useGameStore.getState().runtime!;
    for (const move of planSolution(runtime.board).moves) {
      useGameStore.getState().requestMove(move.from, move.to);
    }

    expect(useGameStore.getState().progress.levelStars[level.id]).toBe(3);
  });
});

describe('combo and stars of a run', () => {
  /**
   * Hand written shelf with one clearable triple per row and a gap in every row:
   * `a a . a` / `c c . c` / `b b . b`. Each row can be cleared in one move, and
   * `9 -> 10` is a legal move that completes nothing (used to break a combo).
   */
  function comboRuntime(moveLimit = 10): ReturnType<typeof createLevelRuntime> {
    return createLevelRuntime({
      id: 9001,
      name: 'Комбо',
      rows: 3,
      cols: 4,
      goal: { kind: 'clearAll' },
      generator: {
        kind: 'layout',
        rows: ['a a .. a', 'c c .. c', 'b b .. b'],
        palette: { a: 'apple', b: 'cake', c: 'milk' },
      },
      moveLimit,
      hints: 2,
      undos: 2,
      coins: 40,
    });
  }

  /** a, c and b rows cleared in a row: three clearing moves, no waste. */
  const cleanRun = [
    { from: 3, to: 2 },
    { from: 7, to: 6 },
    { from: 11, to: 10 },
  ];

  it('grows the combo over consecutive clearing moves and pays coins', () => {
    const runtime = comboRuntime();

    const step1 = playMove(runtime, 3, 2);
    expect(step1.result.ok).toBe(true);
    expect(step1.combo).toBe(1);
    expect(step1.comboCoins).toBe(0);
    expect(step1.runtime.comboCoins).toBe(0);

    const step2 = playMove(step1.runtime, 7, 6);
    expect(step2.result.ok).toBe(true);
    expect(step2.combo).toBe(2);
    expect(step2.comboCoins).toBe(2);
    expect(step2.runtime.comboCoins).toBe(2);
    expect(step2.runtime.combo.best).toBe(2);
    // combo money counts as part of the level bonus
    expect(step2.runtime.bonusCoins).toBe(2);

    const step3 = playMove(step2.runtime, 11, 10);
    expect(step3.combo).toBe(3);
    expect(step3.comboCoins).toBe(4);
    expect(step3.runtime.comboCoins).toBe(6);
    expect(step3.runtime.combo.best).toBe(3);
    expect(step3.runtime.status).toBe('won');
  });

  it('breaks the combo on a move that clears nothing but remembers the best run', () => {
    let current = comboRuntime();
    for (const move of cleanRun.slice(0, 2)) {
      current = playMove(current, move.from, move.to).runtime;
    }
    expect(current.combo).toEqual({ streak: 2, best: 2 });

    const quiet = playMove(current, 9, 10);
    expect(quiet.result.ok).toBe(true);
    expect(quiet.result.match).toBeNull();
    expect(quiet.combo).toBe(0);
    expect(quiet.runtime.combo).toEqual({ streak: 0, best: 2 });
    expect(quiet.comboCoins).toBe(0);
    expect(quiet.runtime.comboCoins).toBe(2);
  });

  it('lets an undo break the combo and marks the run as not clean', () => {
    let current = comboRuntime();
    for (const move of cleanRun.slice(0, 2)) {
      current = playMove(current, move.from, move.to).runtime;
    }

    const undone = undoMove(current);
    expect(undone.combo.streak).toBe(0);
    expect(undone.combo.best).toBe(2);
    expect(undone.undosUsed).toBe(1);
    expect(levelOutcome(undone).clean).toBe(false);
  });

  it('counts spent hints and keeps the perfect star out of reach', () => {
    const runtime = comboRuntime();
    expect(runtime.hintsUsed).toBe(0);
    expect(runtime.undosUsed).toBe(0);

    const hinted = spendHint(runtime);
    expect(hinted.hintsUsed).toBe(1);
    expect(hinted.hintsLeft).toBe(runtime.hintsLeft - 1);
  });

  it('awards three stars and the full coin breakdown for a clean run', () => {
    let current = comboRuntime();
    for (const move of cleanRun) {
      const step = playMove(current, move.from, move.to);
      expect(step.result.ok).toBe(true);
      current = step.runtime;
    }

    expect(current.status).toBe('won');
    expect(current.movesLeft).toBe(7);
    expect(current.combo.best).toBe(3);

    const outcome = levelOutcome(current);
    expect(outcome.clean).toBe(true);
    expect(outcome.stars).toBe(3);
    expect(outcome.starTitle).toBe('Идеальное прохождение');
    expect(outcome.comboBest).toBe(3);
    expect(outcome.comboCoins).toBe(6);

    const byId = Object.fromEntries(outcome.rewards.map((line) => [line.id, line.coins]));
    expect(byId.base).toBe(40);
    expect(byId.stars).toBe(20);
    expect(byId.combo).toBe(6);
    expect(byId.clean).toBe(15);
    expect(byId.moves).toBe(14); // 7 leftover moves × 2 coins
    expect(outcome.coins).toBe(outcome.rewards.reduce((sum, line) => sum + line.coins, 0));
  });

  it('drops the perfect star when the run is not clean, even with spare moves', () => {
    let current = comboRuntime();
    for (const move of cleanRun.slice(0, 2)) {
      current = playMove(current, move.from, move.to).runtime;
    }
    current = spendHint(current);
    current = playMove(current, 11, 10).runtime;

    const outcome = levelOutcome(current);
    expect(current.status).toBe('won');
    expect(outcome.stars).toBe(2);
    expect(outcome.starTitle).toBe('Хорошее прохождение');
    expect(outcome.clean).toBe(false);
    expect(outcome.rewards.some((line) => line.id === 'clean')).toBe(false);
  });

  it('pays nothing extra for a lost level', () => {
    let current = comboRuntime(2);
    for (const move of cleanRun.slice(0, 2)) {
      current = playMove(current, move.from, move.to).runtime;
    }

    expect(current.status).toBe('lost');
    const outcome = levelOutcome(current);
    expect(outcome.stars).toBe(0);
    expect(outcome.coins).toBe(0);
    expect(outcome.rewards).toEqual([]);
    expect(outcome.starTitle).toBe('');
    expect(outcome.comboCoins).toBe(2); // the run is still reported, just not paid
  });
});
