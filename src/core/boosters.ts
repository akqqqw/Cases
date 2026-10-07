import { cellAt, clearCell, cloneBoard, isEmptyCell } from './board';
import { findAllRuns } from './match';
import { shuffleBoard } from './generate';
import type { BoardState, ClearedItem, ItemTypeId } from './types';

/**
 * Boosters are player tools, not level rules: they never take part in level
 * generation or in the solver. The generator keeps verifying boards exactly as
 * before, so a booster can never make a level unsolvable by construction — and
 * the runtime makes sure it cannot dead-lock one either (see `goal.ts` and the
 * leftover note below).
 */
export type BoosterId = 'hammer' | 'shuffle' | 'extraMove' | 'undo';

export const BOOSTER_IDS: BoosterId[] = ['hammer', 'shuffle', 'extraMove', 'undo'];

export interface BoosterDefinition {
  id: BoosterId;
  title: string;
  icon: string;
  /** One line description for the HUD tooltip. */
  hint: string;
  /** Needs a product on the shelf to point at (the hammer does). */
  needsTarget: boolean;
}

export const BOOSTERS: Record<BoosterId, BoosterDefinition> = {
  hammer: {
    id: 'hammer',
    title: 'Молоток',
    icon: '🔨',
    hint: 'Убирает один товар с полки',
    needsTarget: true,
  },
  shuffle: {
    id: 'shuffle',
    title: 'Перемешать',
    icon: '🔀',
    hint: 'Меняет местами товары на полках (тройки при этом не собираются)',
    needsTarget: false,
  },
  extraMove: {
    id: 'extraMove',
    title: '+3 хода',
    icon: '➕',
    hint: 'Добавляет три хода к запасу уровня',
    needsTarget: false,
  },
  undo: {
    id: 'undo',
    title: 'Отмена',
    icon: '↩',
    hint: 'Даёт одну бесплатную отмену хода',
    needsTarget: false,
  },
};

/** How many moves the `extraMove` booster adds. */
export const EXTRA_MOVES = 3;

/** Boosters a fresh save starts with. */
export const STARTER_BOOSTERS: BoosterInventory = { hammer: 2, shuffle: 2, extraMove: 1, undo: 2 };

export type BoosterInventory = Record<BoosterId, number>;

export function emptyBoosters(): BoosterInventory {
  return { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 };
}

export function starterBoosters(): BoosterInventory {
  return { ...STARTER_BOOSTERS };
}

export function boosterCount(inventory: BoosterInventory, id: BoosterId): number {
  const value = inventory[id];
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function hasBooster(inventory: BoosterInventory, id: BoosterId): boolean {
  return boosterCount(inventory, id) > 0;
}

/** Spends one booster; returns `null` when the player has none left. */
export function spendBooster(inventory: BoosterInventory, id: BoosterId): BoosterInventory | null {
  if (!hasBooster(inventory, id)) return null;
  return { ...inventory, [id]: boosterCount(inventory, id) - 1 };
}

export function grantBooster(inventory: BoosterInventory, id: BoosterId, count = 1): BoosterInventory {
  return { ...inventory, [id]: boosterCount(inventory, id) + Math.max(0, Math.floor(count)) };
}

/** Reasons a booster cannot be used, as a `MoveRejectReason`-style union. */
export type BoosterRejectReason =
  | 'no-booster'
  | 'no-target'
  | 'empty-cell'
  | 'not-playing'
  | 'nothing-to-shuffle';

export interface HammerResult {
  board: BoardState;
  /** The product that was destroyed. */
  cleared: ClearedItem;
  /**
   * Products of the same type that suddenly became unmatchable (fewer than
   * three of them are left). They stay on the shelf: a `clear` goal no longer
   * waits for them, so a one-item hammer can never block a level.
   */
  leftovers: ClearedItem[];
  leftoversLeft: number;
}

/** The hammer: destroys exactly one chosen product. */
export function canHammer(board: BoardState, index: number): BoosterRejectReason | null {
  const cell = board.cells[index];
  if (!cell) return 'no-target';
  if (cell.locked || isEmptyCell(cell) || cell.type === null) return 'empty-cell';
  return null;
}

export function hammerCell(board: BoardState, index: number): HammerResult | null {
  if (canHammer(board, index)) return null;

  const next = cloneBoard(board);
  const cell = cellAt(next, index);
  const cleared: ClearedItem = {
    uid: cell.uid as number,
    type: cell.type as ItemTypeId,
    index,
    special: cell.special,
  };
  // `clearCell` also melts the ice of that cell, so a frozen product can be
  // freed with the hammer — the main reason to have one.
  clearCell(next, index);

  const type = cleared.type;
  const leftovers: ClearedItem[] = [];
  next.cells.forEach((other, otherIndex) => {
    if (other.type !== type || other.uid === null) return;
    leftovers.push({ uid: other.uid, type, index: otherIndex, special: other.special });
  });

  return {
    board: next,
    cleared,
    leftovers: leftovers.length < 3 ? leftovers : [],
    leftoversLeft: leftovers.length,
  };
}

/** Products that can be moved by the shuffle booster. */
export function shufflableIndices(board: BoardState): number[] {
  const result: number[] = [];
  board.cells.forEach((cell, index) => {
    if (cell.locked || cell.frozen) return;
    if (isEmptyCell(cell)) return;
    result.push(index);
  });
  return result;
}

export interface ShuffleResult {
  board: BoardState;
  /** Cells whose products changed place. */
  moved: number;
  /** How many products took part in the shuffle. */
  shuffled: number;
}

/**
 * Shuffles the movable products around. Locked and iced products stay where they
 * are, no ready-made triple may appear (otherwise the player would be handed a
 * free match), and the move count of the board shape is untouched.
 */
export function shuffleItems(board: BoardState, rng: () => number, steps = 0): ShuffleResult | null {
  const movable = shufflableIndices(board);
  if (movable.length < 2) return null;

  const wanted = steps > 0 ? steps : Math.max(6, Math.min(40, movable.length * 2));
  const { board: shuffled, moves } = shuffleBoard(board, wanted, rng);

  if (moves.length === 0) return null;
  if (findAllRuns(shuffled).length > 0) return null;

  // How many movable cells actually hold a different product now.
  let moved = 0;
  for (const index of movable) {
    const before = cellAt(board, index).type;
    const after = cellAt(shuffled, index).type;
    if (before !== after) moved += 1;
  }

  return { board: shuffled, moved, shuffled: movable.length };
}

/** Products of one type that are left on the shelf (for the leftover hint). */
export function leftoverTypes(board: BoardState): Array<{ type: ItemTypeId; count: number }> {
  const counts = new Map<ItemTypeId, number>();
  for (const cell of board.cells) {
    if (cell.type === null) continue;
    counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 0 && count < 3)
    .map(([type, count]) => ({ type, count }));
}
