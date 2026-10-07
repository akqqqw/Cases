import { cellAt, clearCell, cloneBoard, countByType, isEmptyCell } from './board';
import type { BoardState, ClearedItem, ItemTypeId } from './types';

/**
 * Bomb rule: when a bomb triple is collected, the products around it are blown
 * away as well. To keep the "products are always removed in triples" invariant
 * (which is what makes every level clearable) a blast always takes exactly three
 * products of one type — never a random number of leftovers.
 */
export const BLAST_SIZE = 3;

export interface BlastPlan {
  type: ItemTypeId;
  /** Cell indices the blast removes. */
  indices: number[];
}

/**
 * Picks what a blast destroys: the most numerous product on the board (at least
 * three of it). Returns `null` when nothing suitable is left — the bomb then
 * simply pops without a blast.
 */
export function planBlast(board: BoardState): BlastPlan | null {
  const counts = countByType(board);
  let bestType: ItemTypeId | null = null;
  let bestCount = 0;

  for (const [type, count] of Object.entries(counts)) {
    if (count < BLAST_SIZE) continue;
    const better = count > bestCount || (count === bestCount && bestType !== null && type < bestType);
    if (better) {
      bestType = type;
      bestCount = count;
    }
  }

  if (!bestType) return null;

  const indices: number[] = [];
  for (let index = 0; index < board.cells.length && indices.length < BLAST_SIZE; index += 1) {
    const cell = cellAt(board, index);
    if (!isEmptyCell(cell) && cell.type === bestType) indices.push(index);
  }

  return indices.length === BLAST_SIZE ? { type: bestType, indices } : null;
}

/** Applies a blast to a board clone and reports the products it removed. */
export function applyBlast(board: BoardState, plan: BlastPlan): { board: BoardState; cleared: ClearedItem[] } {
  const next = cloneBoard(board);
  const cleared: ClearedItem[] = [];

  for (const index of plan.indices) {
    const cell = cellAt(next, index);
    if (cell.type === null) continue;
    cleared.push({ uid: cell.uid as number, type: cell.type, index, special: cell.special });
    // `clearCell` also melts ice, so a blast frees iced shelves.
    clearCell(next, index);
  }

  return { board: next, cleared };
}

export function hasBomb(cleared: ClearedItem[]): boolean {
  return cleared.some((item) => item.special === 'bomb');
}

export function hasGolden(cleared: ClearedItem[]): boolean {
  return cleared.some((item) => item.special === 'golden');
}
