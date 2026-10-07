import { countByType, itemCount } from './board';
import { MATCH_LENGTH } from './match';
import type { BoardState, ItemTypeId } from './types';

/**
 * Level goals are data — new goal kinds can be added without touching the
 * rendering or the store.
 */
export type LevelGoal =
  /** Clear every product from the shelves. */
  | { kind: 'clearAll' }
  /** Remove a given amount of specific products. */
  | { kind: 'collect'; targets: Record<ItemTypeId, number> }
  /** Remove every instance of the listed product types. */
  | { kind: 'clearTypes'; types: ItemTypeId[] };

export interface GoalState {
  goal: LevelGoal;
  /** Item counts measured on the level start board. */
  initial: Record<ItemTypeId, number>;
  targets: Record<ItemTypeId, number>;
  /** Items that must be removed in total. */
  total: number;
  /** Removed items per type (never above the target). */
  removed: Record<ItemTypeId, number>;
  removedTotal: number;
  done: boolean;
}

function zeroesFor(targets: Record<ItemTypeId, number>): Record<ItemTypeId, number> {
  const result: Record<ItemTypeId, number> = {};
  for (const type of Object.keys(targets)) result[type] = 0;
  return result;
}

export function createGoalState(board: BoardState, goal: LevelGoal): GoalState {
  const initial = countByType(board);
  let targets: Record<ItemTypeId, number>;

  if (goal.kind === 'clearAll') {
    targets = { ...initial };
  } else if (goal.kind === 'clearTypes') {
    targets = {};
    for (const type of goal.types) if (initial[type]) targets[type] = initial[type] as number;
  } else {
    targets = { ...goal.targets };
  }

  const total = Object.values(targets).reduce((sum, value) => sum + value, 0);
  return {
    goal,
    initial,
    targets,
    total,
    removed: zeroesFor(targets),
    removedTotal: 0,
    done: total === 0,
  };
}

/**
 * Products of a type that can never be matched again — fewer than three of them
 * are left, so no triple can be built any more. This normally never happens
 * (boards are built from triples and matches remove exactly three), but the
 * one-item hammer booster does create such leftovers. They must not block the
 * goal, otherwise a hammer would make a level impossible to finish.
 *
 * `collect` goals are exempt: there the player counts collected products, and a
 * leftover is not "collected".
 */
export function unmatchableLeft(goal: LevelGoal, left: number): number {
  if (goal.kind === 'collect') return 0;
  return left % MATCH_LENGTH;
}

/** Products of a type the player still has to work for (goal-wise). */
export function effectiveLeft(goal: LevelGoal, left: number): number {
  return Math.max(0, left - unmatchableLeft(goal, left));
}

/** Recomputes progress from the current board. */
export function updateGoalState(state: GoalState, board: BoardState): GoalState {
  const current = countByType(board);
  const removed: Record<ItemTypeId, number> = {};
  let removedTotal = 0;
  let done = true;

  for (const [type, target] of Object.entries(state.targets)) {
    const left = current[type] ?? 0;
    const pending = effectiveLeft(state.goal, left);
    const gone = Math.min(target, Math.max(0, (state.initial[type] ?? 0) - pending));
    removed[type] = gone;
    removedTotal += gone;
    if (gone < target) done = false;
  }

  return { ...state, removed, removedTotal, done: state.total <= 0 ? true : done };
}

/** 0..1 progress of the level goal. */
export function goalRatio(state: GoalState): number {
  if (state.total <= 0) return 1;
  return Math.min(1, state.removedTotal / state.total);
}

/** Items left on the board that belong to the goal (used for the HUD counter). */
export function goalItemsLeft(board: BoardState, state: GoalState): number {
  const counts = countByType(board);
  let left = 0;
  for (const type of Object.keys(state.targets)) left += counts[type] ?? 0;
  return left;
}

export function boardItemCount(board: BoardState): number {
  return itemCount(board);
}

/** Stars for leftover moves: 3 stars from `three`, 2 stars from `two`. */
export interface StarThresholds {
  three: number;
  two: number;
}

export function starsFor(thresholds: StarThresholds, movesLeft: number): 1 | 2 | 3 {
  if (movesLeft >= thresholds.three) return 3;
  if (movesLeft >= thresholds.two) return 2;
  return 1;
}

/**
 * Product types the player has to collect for this goal. `null` means "every
 * product on the board" (clear-all levels).
 */
export function goalProductTypes(goal: LevelGoal): ItemTypeId[] | null {
  if (goal.kind === 'clearAll') return null;
  if (goal.kind === 'clearTypes') return [...goal.types];
  return Object.keys(goal.targets);
}

/** Human readable goal label for the HUD (kept in the data layer). */
export function goalSummary(goal: LevelGoal): string {
  if (goal.kind === 'clearAll') return 'Убрать все товары с полок';
  if (goal.kind === 'clearTypes') return 'Убрать выбранные товары';
  return 'Собрать нужные товары';
}
