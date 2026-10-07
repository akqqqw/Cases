import { cellAt, colOf, indexOf, isEmptyCell, rowOf } from './board';
import type { BoardState, ItemTypeId } from './types';

/**
 * Match rule of the game: three identical products standing **next to each
 * other on one shelf** (a horizontal run of 3+ equal items).
 *
 * Exactly three items are removed per match, even when the run is longer.
 * Together with level generation (item counts are multiples of three) this
 * keeps every level clearable.
 */
export const MATCH_LENGTH = 3;

function sameType(board: BoardState, index: number, type: ItemTypeId): boolean {
  const cell = cellAt(board, index);
  return !isEmptyCell(cell) && cell.type === type;
}

/** Length of the horizontal run of equal items through `index` (0 for empty cells). */
export function runLengthThrough(board: BoardState, index: number): number {
  const cell = cellAt(board, index);
  if (isEmptyCell(cell) || cell.type === null) return 0;

  const type = cell.type;
  const row = rowOf(board, index);
  const col = colOf(board, index);

  let length = 1;
  for (let c = col - 1; c >= 0 && sameType(board, indexOf(board, row, c), type); c -= 1) length += 1;
  for (let c = col + 1; c < board.cols && sameType(board, indexOf(board, row, c), type); c += 1) length += 1;
  return length;
}

/** Full horizontal run of equal items through `index`, or `null` when shorter than 3. */
export function findRunThrough(board: BoardState, index: number): number[] | null {
  const cell = cellAt(board, index);
  if (isEmptyCell(cell) || cell.type === null) return null;

  const type = cell.type;
  const row = rowOf(board, index);
  const col = colOf(board, index);

  let start = col;
  while (start - 1 >= 0 && sameType(board, indexOf(board, row, start - 1), type)) start -= 1;

  let end = col;
  while (end + 1 < board.cols && sameType(board, indexOf(board, row, end + 1), type)) end += 1;

  if (end - start + 1 < MATCH_LENGTH) return null;

  const run: number[] = [];
  for (let c = start; c <= end; c += 1) run.push(indexOf(board, row, c));
  return run;
}

/** Every horizontal run of 3+ equal items on the board. */
export function findAllRuns(board: BoardState): number[][] {
  const runs: number[][] = [];
  for (let row = 0; row < board.rows; row += 1) {
    let start = 0;
    while (start < board.cols) {
      const first = cellAt(board, indexOf(board, row, start));
      if (isEmptyCell(first) || first.type === null) {
        start += 1;
        continue;
      }
      let end = start;
      while (
        end + 1 < board.cols &&
        sameType(board, indexOf(board, row, end + 1), first.type)
      ) {
        end += 1;
      }
      const length = end - start + 1;
      if (length >= MATCH_LENGTH) {
        const run: number[] = [];
        for (let c = start; c <= end; c += 1) run.push(indexOf(board, row, c));
        runs.push(run);
      }
      start = end + 1;
    }
  }
  return runs;
}

export function hasAnyMatch(board: BoardState): boolean {
  return findAllRuns(board).length > 0;
}

/**
 * Picks the three items that disappear: the ones closest to `anchor`
 * (the cell the player just dropped an item into), then left to right.
 */
export function chooseRemoval(run: number[], anchor: number): number[] {
  const picked = [...run]
    .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)
    .slice(0, MATCH_LENGTH);
  return picked.sort((a, b) => a - b);
}
