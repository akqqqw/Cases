import {
  cellAt,
  colOf,
  createEmptyBoard,
  indexOf,
  isEmptyBoard,
  isEmptyCell,
  placeNewItem,
  rowOf,
} from './board';
import { createGoalState, updateGoalState, type GoalState, type LevelGoal } from './goal';
import { findAllRuns, runLengthThrough } from './match';
import { applyMove, moveItem } from './moves';
import { createRng, shuffle } from './rng';
import { planSolution } from './solver';
import type { BoardState, ItemTypeId, PlannedMove, SpecialKind } from './types';

export type { PlannedMove };

export interface ScrambleGenerator {
  kind: 'scramble';
  /** Same seed → same board. */
  seed: number;
  /** Item groups; every count must be a positive multiple of 3. */
  groups: Array<{ type: ItemTypeId; count: number }>;
  /**
   * Golden triples: the very same product, but marked as special. Collecting one
   * pays a bonus (extra move and coins). Also a multiple of 3.
   */
  golden?: Array<{ type: ItemTypeId; count: number }>;
  /**
   * Bomb triples: collecting one blows away another product triple for free.
   * Also a multiple of 3.
   */
  bombs?: Array<{ type: ItemTypeId; count: number }>;
  /** Blocked (nailed down) cells: how many to pick, or exact cell indices. */
  locked?: number | number[];
  /** Iced products: pinned to their cell (still matchable in place). */
  frozen?: number | number[];
  /** How many disruptive moves to perform while shuffling (default: 2 per triple). */
  scrambleMoves?: number;
}

export interface LayoutGenerator {
  kind: 'layout';
  /**
   * Hand written board rows. Each row is a list of space separated tokens:
   * `..` free cell, `##` blocked cell, otherwise a key of `palette`.
   */
  rows: string[];
  palette: Record<string, ItemTypeId>;
}

export type LevelGenerator = ScrambleGenerator | LayoutGenerator;

export interface GenerateOptions {
  /** Verify against this goal instead of "clear the whole board". */
  goal?: LevelGoal;
  /** Safety valve used by the level runtime fallback. */
  allowUnverified?: boolean;
}

export interface GeneratedBoard {
  board: BoardState;
  /** Verified solution found by the planner (`par` moves long). */
  solution: PlannedMove[];
  /** Length of the verified solution. */
  par: number;
  /** Whether the level goal can be reached with the verified solution. */
  solvable: boolean;
  /** Flat indices of the blocked cells. */
  locked: number[];
  /** Flat indices of the iced cells. */
  frozen: number[];
  /** The shuffling moves (debug info, empty for hand written layouts). */
  scramble: PlannedMove[];
}

export class GenerationError extends Error {}

const GENERATION_ATTEMPTS = 12;

export function generateBoard(
  rows: number,
  cols: number,
  generator: LevelGenerator,
  options: GenerateOptions = {},
): GeneratedBoard {
  const generated =
    generator.kind === 'scramble'
      ? generateScrambledBoard(rows, cols, generator, options)
      : generateLayoutBoard(rows, cols, generator);

  if (generated.solvable || options.allowUnverified) return generated;

  const verified = verify(generated.board, options.goal, 400);
  return { ...generated, solution: verified.moves, par: verified.moves.length, solvable: verified.done };
}

/** Item groups per triple — used by level configs and tests. */
export function triplesOf(groups: Array<{ type: ItemTypeId; count: number }>): number {
  return groups.reduce((sum, group) => sum + group.count / 3, 0);
}

function verify(
  board: BoardState,
  goal: LevelGoal | undefined,
  maxMoves: number,
): { moves: PlannedMove[]; done: boolean } {
  const goalState = goal ? createGoalState(board, goal) : undefined;
  return planSolution(board, { maxMoves, ...(goalState ? { goal: goalState } : {}) });
}

function generateScrambledBoard(
  rows: number,
  cols: number,
  config: ScrambleGenerator,
  options: GenerateOptions,
): GeneratedBoard {
  if (rows < 1 || cols < 3) throw new GenerationError(`board ${rows}x${cols} is too small`);
  if (cols % 3 !== 0) {
    throw new GenerationError(`board width ${cols} must be a multiple of 3 for "scramble" levels`);
  }

  const chunks = expandGroups(config.groups, 'item');
  const goldenChunks = expandGroups(config.golden ?? [], 'golden');
  const bombChunks = expandGroups(config.bombs ?? [], 'bomb');
  const totalChunks = chunks.length + goldenChunks.length + bombChunks.length;

  if (totalChunks === 0) throw new GenerationError('a level needs at least one item group');

  const wantedMoves = Math.max(totalChunks, config.scrambleMoves ?? totalChunks * 2);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    // Deterministic retries: a level always generates the very same board.
    const rng = createRng((config.seed + attempt * 7919) >>> 0);

    const locked = resolveLocked(config.locked, rows * cols, rng);
    const lockedSet = new Set(locked);

    // A triple slot is usable when none of its three cells is blocked.
    const slots: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let start = 0; start + 3 <= cols; start += 3) {
        const cells = [0, 1, 2].map((offset) => row * cols + start + offset);
        if (cells.some((index) => lockedSet.has(index))) continue;
        slots.push(row * cols + start);
      }
    }

    if (locked.length > 0 && slots.length === 0) {
      throw new GenerationError('every triple slot is blocked — the level cannot be played');
    }
    if (totalChunks > slots.length - 1) {
      throw new GenerationError(
        `level uses ${totalChunks} triples but only ${slots.length} triple slots are available — ` +
          'at least one free triple slot is required so that products can be moved',
      );
    }

    const grouped = createEmptyBoard(rows, cols, locked);
    const pool: Array<{ type: ItemTypeId; special: SpecialKind | null }> = [
      ...chunks.map((type) => ({ type, special: null as SpecialKind | null })),
      ...goldenChunks.map((type) => ({ type, special: 'golden' as SpecialKind | null })),
      ...bombChunks.map((type) => ({ type, special: 'bomb' as SpecialKind | null })),
    ];

    const assignment = assignChunks(grouped, shuffle(slots, rng).slice(0, totalChunks), pool, rng);

    for (const { slot, type, special } of assignment) {
      const row = rowOf(grouped, slot);
      const startCol = colOf(grouped, slot);
      for (let offset = 0; offset < 3; offset += 1) {
        placeNewItem(grouped, indexOf(grouped, row, startCol + offset), type, special);
      }
    }

    const { board, moves } = shuffleBoard(grouped, wantedMoves, rng);
    if (findAllRuns(board).length > 0) {
      lastError = new GenerationError('shuffle left complete triples on the board');
      continue;
    }

    // Ice is applied last: freezing never moves anything, so it can neither
    // create a ready-made triple nor break the board layout.
    let frozen: number[] = [];
    try {
      frozen = freezeCells(board, config.frozen, rng);
    } catch (error) {
      lastError = error as Error;
      continue;
    }

    const maxMoves = totalChunks * 12 + 20;
    const solution = verify(board, options.goal, maxMoves);
    if (!solution.done) {
      lastError = new GenerationError('planner could not complete the level goal');
      continue;
    }

    return {
      board,
      par: solution.moves.length,
      scramble: moves,
      solution: solution.moves,
      solvable: true,
      locked,
      frozen,
    };
  }

  throw new GenerationError(
    `could not generate a solvable board for seed ${config.seed}: ${lastError?.message ?? 'unknown reason'}`,
  );
}

/** Pins the requested amount of products to their cells. */
function freezeCells(board: BoardState, spec: number | number[] | undefined, rng: () => number): number[] {
  if (spec === undefined) return [];

  const candidates: number[] = [];
  board.cells.forEach((cell, index) => {
    if (!cell.locked && !cell.frozen && cell.type !== null) candidates.push(index);
  });

  if (Array.isArray(spec)) {
    for (const index of spec) {
      const cell = board.cells[index];
      if (!cell) throw new GenerationError(`iced cell ${index} is outside of the board`);
      if (cell.locked || cell.type === null) {
        throw new GenerationError(`iced cell ${index} cannot hold a product`);
      }
    }
    const picked = [...new Set(spec)].sort((a, b) => a - b);
    for (const index of picked) cellAt(board, index).frozen = true;
    return picked;
  }

  if (spec <= 0) return [];
  if (spec > candidates.length) throw new GenerationError('not enough products to ice');

  const picked = shuffle(candidates, rng)
    .slice(0, spec)
    .sort((a, b) => a - b);
  for (const index of picked) cellAt(board, index).frozen = true;
  return picked;
}

function expandGroups(
  groups: Array<{ type: ItemTypeId; count: number }>,
  label: string,
): ItemTypeId[] {
  const chunks: ItemTypeId[] = [];
  for (const group of groups) {
    if (group.count <= 0 || group.count % 3 !== 0) {
      throw new GenerationError(
        `${label} group "${group.type}" must have a positive multiple of 3 (got ${group.count})`,
      );
    }
    for (let i = 0; i < group.count / 3; i += 1) chunks.push(group.type);
  }
  return chunks;
}

function resolveLocked(locked: number | number[] | undefined, size: number, rng: () => number): number[] {
  if (locked === undefined) return [];
  if (Array.isArray(locked)) {
    for (const index of locked) {
      if (!Number.isInteger(index) || index < 0 || index >= size) {
        throw new GenerationError(`blocked cell ${index} is outside of the board`);
      }
    }
    return [...new Set(locked)].sort((a, b) => a - b);
  }
  if (locked <= 0) return [];
  if (locked >= size) throw new GenerationError('a level cannot block every cell');

  const all = Array.from({ length: size }, (_, index) => index);
  return shuffle(all, rng)
    .slice(0, locked)
    .sort((a, b) => a - b);
}

/** Places the triples row by row, never putting equals next to each other. */
function assignChunks(
  board: BoardState,
  slotStarts: number[],
  pool: Array<{ type: ItemTypeId; special: SpecialKind | null }>,
  rng: () => number,
): Array<{ slot: number; type: ItemTypeId; special: SpecialKind | null }> {
  const ordered = [...slotStarts].sort((a, b) => a - b);
  const items = [...pool];

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const bag = shuffle(items, rng);
    const used = new Map<number, { type: ItemTypeId; special: SpecialKind | null }>();
    let ok = true;

    for (const slot of ordered) {
      const col = colOf(board, slot);
      const leftType = col >= 3 ? used.get(slot - 3)?.type : undefined;
      const index = bag.findIndex((entry) => entry.type !== leftType);
      if (index < 0) {
        ok = false;
        break;
      }
      used.set(slot, bag[index] as { type: ItemTypeId; special: SpecialKind | null });
      bag.splice(index, 1);
    }

    if (ok) {
      return ordered.map((slot) => {
        const entry = used.get(slot) as { type: ItemTypeId; special: SpecialKind | null };
        return { slot, type: entry.type, special: entry.special };
      });
    }
  }

  // Degenerate level (e.g. a single product type): fall back to a plain shuffle.
  const bag = shuffle(items, rng);
  return ordered.map((slot, i) => {
    const entry = bag[i] as { type: ItemTypeId; special: SpecialKind | null };
    return { slot, type: entry.type, special: entry.special };
  });
}

/** Hand written layouts keep full control over the board. */
function generateLayoutBoard(rows: number, cols: number, config: LayoutGenerator): GeneratedBoard {
  if (config.rows.length !== rows) {
    throw new GenerationError(`layout has ${config.rows.length} rows, level declares ${rows}`);
  }

  const board = createEmptyBoard(rows, cols);
  const locked: number[] = [];

  const frozen: number[] = [];

  config.rows.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== cols) {
      throw new GenerationError(`layout row ${row + 1} has ${tokens.length} cells, level declares ${cols}`);
    }
    tokens.forEach((token, col) => {
      const index = indexOf(board, row, col);
      if (token === '..') return;
      if (token === '##') {
        cellAt(board, index).locked = true;
        locked.push(index);
        return;
      }
      const iced = token.endsWith('~');
      const bare = iced ? token.slice(0, -1) : token;
      const special = bare.endsWith('!') ? 'bomb' : bare.endsWith('*') ? 'golden' : null;
      const key = special ? bare.slice(0, -1) : bare;
      const type = config.palette[key];
      if (!type) throw new GenerationError(`unknown layout token "${token}" in row ${row + 1}`);
      placeNewItem(board, index, type, special);
      if (iced) {
        cellAt(board, index).frozen = true;
        frozen.push(index);
      }
    });
  });

  return { board, scramble: [], par: 0, solution: [], solvable: false, locked, frozen };
}

/**
 * Turns a neatly grouped board into a puzzle. Only moves that do not create new
 * triples are used, and the number of complete triples on the board never grows
 * — so the shuffle always ends with a board without instant matches.
 */
export function shuffleBoard(
  start: BoardState,
  wanted: number,
  rng: () => number,
): { board: BoardState; moves: PlannedMove[] } {
  let board = start;
  const moves: PlannedMove[] = [];
  let previous: PlannedMove | null = null;

  for (let step = 0; step < wanted; step += 1) {
    const runsLeft = findAllRuns(board).length;
    let best: { from: number; to: number; score: number; next: BoardState } | null = null;

    for (let from = 0; from < board.cells.length; from += 1) {
      const source = cellAt(board, from);
      if (source.locked || isEmptyCell(source) || source.type === null) continue;
      if (previous && previous.to === from) continue;

      for (let to = 0; to < board.cells.length; to += 1) {
        const target = cellAt(board, to);
        if (target.locked || !isEmptyCell(target)) continue;
        if (previous && previous.from === to && previous.to === from) continue;

        const next = moveItem(board, from, to);
        if (!next) continue;
        if (findAllRuns(next).length > runsLeft) continue;

        let score = 0;
        // Breaking an existing pair is the most disruptive kind of move.
        if (runLengthThrough(board, from) >= 2) score += 3;
        // Spreading products over different shelves keeps the puzzle messy.
        if (!rowHasType(board, rowOf(board, to), source.type)) score += 1;
        // Vertical looking swaps are visually boring.
        if (colOf(board, from) === colOf(board, to)) score -= 2;
        score += rng() * 0.99;

        if (!best || score > best.score) best = { from, to, score, next };
      }
    }

    if (!best) break;
    board = best.next;
    previous = { from: best.from, to: best.to };
    moves.push({ from: best.from, to: best.to });
  }

  return { board, moves };
}

function rowHasType(board: BoardState, row: number, type: ItemTypeId): boolean {
  for (let col = 0; col < board.cols; col += 1) {
    const cell = cellAt(board, indexOf(board, row, col));
    if (!isEmptyCell(cell) && cell.type === type) return true;
  }
  return false;
}

/**
 * Replays a move list through the real engine (matches included) and reports
 * whether every move stayed legal and the board ended up empty.
 */
export function replaySolution(board: BoardState, moves: PlannedMove[]): boolean {
  let current = board;
  for (const move of moves) {
    const result = applyMove(current, move.from, move.to);
    if (!result.ok) return false;
    current = result.board;
  }
  return isEmptyBoard(current);
}

/** Replays a move list against a goal (used by tests and the level validator). */
export function replayGoal(board: BoardState, moves: PlannedMove[], goal: LevelGoal): boolean {
  let current = board;
  let state: GoalState = createGoalState(board, goal);
  for (const move of moves) {
    const result = applyMove(current, move.from, move.to);
    if (!result.ok) return false;
    current = result.board;
    state = updateGoalState(state, current);
  }
  return state.done;
}
