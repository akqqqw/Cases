import { cellAt, countByType, indexOf, isEmptyCell, itemCount } from './board';
import { updateGoalState, type GoalState } from './goal';
import { MATCH_LENGTH } from './match';
import { applyMove, legalMoves } from './moves';
import { createRng, shuffle } from './rng';
import type { BoardState, ItemTypeId, PlannedMove } from './types';

export interface Solution {
  moves: PlannedMove[];
  /** `true` when the requested goal (or the whole board) has been cleared. */
  done: boolean;
}

export type HintKind = 'instant' | 'setup' | 'plan';

export interface Hint {
  from: number;
  to: number;
  kind: HintKind;
}

export interface PlanOptions {
  maxMoves?: number;
  /** Track this goal and stop as soon as it is completed. */
  goal?: GoalState;
  /** Only collect these product types (null / omitted = every type). */
  allowedTypes?: ItemTypeId[] | null;
}

interface TripleCandidate {
  type: ItemTypeId;
  cost: number;
  board: BoardState;
  moves: PlannedMove[];
}

/**
 * Greedy planner: repeatedly picks the cheapest way to collect one more triple.
 * It is not optimal, but it is fast and good enough for hints, for the level
 * generator and for the "every level can be finished within its budget" check.
 */
export function planSolution(board: BoardState, options: PlanOptions = {}): Solution {
  const maxMoves = options.maxMoves ?? 500;
  const allowed = options.allowedTypes && options.allowedTypes.length > 0 ? new Set(options.allowedTypes) : null;

  let current = board;
  let goalState = options.goal;
  const moves: PlannedMove[] = [];

  const isDone = (): boolean => (goalState ? goalState.done : itemCount(current) === 0);

  for (let guard = 0; guard < 400; guard += 1) {
    if (isDone()) return { moves, done: true };
    if (moves.length >= maxMoves) break;

    const candidate = chooseBestTriple(current, allowed);
    if (!candidate) break;

    current = candidate.board;
    moves.push(...candidate.moves);
    if (goalState) goalState = updateGoalState(goalState, current);
  }

  return { moves, done: isDone() };
}

function chooseBestTriple(board: BoardState, allowed: Set<ItemTypeId> | null): TripleCandidate | null {
  const counts = countByType(board);
  const types = Object.keys(counts)
    .filter((type) => (counts[type] ?? 0) >= MATCH_LENGTH && (!allowed || allowed.has(type)))
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));

  let best: TripleCandidate | null = null;

  for (const type of types) {
    for (let row = 0; row < board.rows; row += 1) {
      for (let start = 0; start + MATCH_LENGTH <= board.cols; start += 1) {
        const targets: number[] = [];
        let usable = true;
        for (let offset = 0; offset < MATCH_LENGTH; offset += 1) {
          const index = indexOf(board, row, start + offset);
          if (cellAt(board, index).locked) usable = false;
          targets.push(index);
        }
        if (!usable) continue;

        const candidate = planTriple(board, type, targets);
        if (!candidate) continue;
        if (best === null || candidate.cost < best.cost) {
          best = candidate;
          // One move cannot be beaten, so this triple is a perfect pick.
          if (candidate.cost <= 1) return candidate;
        }
      }
    }
  }

  return best;
}

/** Plans the moves needed to make exactly `targets` hold the same product. */
function planTriple(start: BoardState, type: ItemTypeId, targets: number[]): TripleCandidate | null {
  let board = start;
  const moves: PlannedMove[] = [];
  const targetSet = new Set(targets);
  const before = countByType(start)[type] ?? 0;
  const typeCount = (): number => countByType(board)[type] ?? 0;

  // Phase 1 — push foreign products out of the target window.
  for (let guard = 0; guard < MATCH_LENGTH * 3; guard += 1) {
    const foreign = targets.find((index) => {
      const cell = cellAt(board, index);
      return !isEmptyCell(cell) && cell.type !== type;
    });
    if (foreign === undefined) break;

    let destination = -1;
    for (let index = 0; index < board.cells.length; index += 1) {
      const cell = cellAt(board, index);
      if (cell.locked || targetSet.has(index) || !isEmptyCell(cell)) continue;
      destination = index;
      break;
    }
    if (destination < 0) return null;

    const result = applyMove(board, foreign, destination);
    if (!result.ok) return null;
    board = result.board;
    moves.push({ from: foreign, to: destination });
  }

  const stillForeign = targets.some((index) => {
    const cell = cellAt(board, index);
    return !isEmptyCell(cell) && cell.type !== type;
  });
  if (stillForeign) return null;

  // Phase 2 — fill the free target cells with the requested product.
  for (let guard = 0; guard < MATCH_LENGTH * 3; guard += 1) {
    if (typeCount() <= before - MATCH_LENGTH) break;

    const need = targets.find((index) => isEmptyCell(cellAt(board, index)));
    if (need === undefined) break;

    const source = pickSource(board, type, targets, targetSet);
    if (source < 0) return null;

    const result = applyMove(board, source, need);
    if (!result.ok) return null;
    board = result.board;
    moves.push({ from: source, to: need });
  }

  if (typeCount() > before - MATCH_LENGTH) return null;
  if (moves.length === 0) return null;

  return { type, cost: moves.length, board, moves };
}

function pickSource(board: BoardState, type: ItemTypeId, targets: number[], targetSet: Set<number>): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < board.cells.length; index += 1) {
    const cell = cellAt(board, index);
    if (cell.locked || targetSet.has(index) || isEmptyCell(cell) || cell.type !== type) continue;
    const distance = Math.min(...targets.map((target) => Math.abs(target - index)));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

/**
 * Hint for the player: prefers a move that collects a required triple, then a
 * move that sets one up, and only then falls back to the planner.
 */
export function findHint(board: BoardState, options: PlanOptions = {}): Hint | null {
  const allowed = options.allowedTypes && options.allowedTypes.length > 0 ? new Set(options.allowedTypes) : null;
  const moves = legalMoves(board).filter((move) => {
    if (!allowed) return true;
    const cell = cellAt(board, move.from);
    return cell.type !== null && allowed.has(cell.type);
  });
  if (moves.length === 0) return null;

  for (const move of moves) {
    const result = applyMove(board, move.from, move.to);
    if (result.cleared.length >= MATCH_LENGTH && helpsGoal(result.cleared, allowed)) {
      return { ...move, kind: 'instant' };
    }
  }

  const capped = shuffle(moves, createRng(20260406)).slice(0, 48);
  for (const move of capped) {
    const first = applyMove(board, move.from, move.to);
    if (!first.ok) continue;
    for (const next of legalMoves(first.board)) {
      const second = applyMove(first.board, next.from, next.to);
      if (second.cleared.length >= MATCH_LENGTH && helpsGoal(second.cleared, allowed)) {
        return { ...move, kind: 'setup' };
      }
    }
  }

  const plan = planSolution(board, { ...options, maxMoves: 60 });
  const step = plan.moves[0];
  if (step) return { ...step, kind: 'plan' };

  return { ...(moves[0] as PlannedMove), kind: 'plan' };
}

function helpsGoal(cleared: Array<{ type: ItemTypeId }>, allowed: Set<ItemTypeId> | null): boolean {
  if (!allowed) return true;
  return cleared.some((item) => allowed.has(item.type));
}
