/**
 * Core domain types. This module is intentionally free of Phaser / React /
 * browser APIs so that all rules stay unit-testable and reusable.
 */

/** Identifier of a product type, e.g. `'apple'` (see `src/data/items.ts`). */
export type ItemTypeId = string;

/** Unique id of a single item instance currently lying on the board. */
export type Uid = number;

/**
 * Special item kinds.
 *
 * - `golden` — pays a bonus move and coins when its triple is collected;
 * - `bomb`   — its triple explodes and takes one more product triple with it;
 * - `wildcard` / `double` are reserved for later level mechanics.
 */
export type SpecialKind = 'golden' | 'bomb' | 'wildcard' | 'double';

/** A single slot on a shelf. */
export interface Cell {
  /** Item instance living in this cell (`null` when the cell is free). */
  uid: Uid | null;
  /** Product type of the item in this cell. */
  type: ItemTypeId | null;
  /** Blocked cells cannot receive an item and lock the item inside. */
  locked: boolean;
  /**
   * Iced cells keep their product nailed to the shelf: it can still be part of
   * a match, but it cannot be dragged away. The ice breaks together with the
   * product (or melts after a few collected triples).
   */
  frozen: boolean;
  /** Special ability of the item in this cell. */
  special: SpecialKind | null;
}

/** Full board state: `rows` shelves with `cols` cells each, row-major. */
export interface BoardState {
  rows: number;
  cols: number;
  cells: Cell[];
  nextUid: Uid;
}

/** A planned drag between two cells (from → to). */
export interface PlannedMove {
  from: number;
  to: number;
}

export type MoveRejectReason =
  | 'not-playing'
  | 'same-cell'
  | 'empty-source'
  | 'source-locked'
  | 'source-frozen'
  | 'target-locked'
  | 'target-occupied'
  | 'out-of-bounds';

export interface ClearedItem {
  uid: Uid;
  type: ItemTypeId;
  /** Flat cell index the item was removed from. */
  index: number;
  special: SpecialKind | null;
}

export interface MatchGroup {
  type: ItemTypeId;
  /** Cell indices of the removed items. */
  indices: number[];
}

/** Extra removal caused by a bomb triple. */
export interface BlastGroup {
  type: ItemTypeId;
  indices: number[];
}

export interface MoveResult {
  ok: boolean;
  reason?: MoveRejectReason;
  /** Resulting board (a new object when the move was applied). */
  board: BoardState;
  /** `from` flat index. */
  from: number;
  /** `to` flat index. */
  to: number;
  /** Items removed by the match triggered by this move, if any. */
  cleared: ClearedItem[];
  match: MatchGroup | null;
  /** Items blown away by a bomb triple (already included in `cleared`). */
  blast: BlastGroup | null;
}
