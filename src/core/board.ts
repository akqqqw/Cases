import type { BoardState, Cell, ItemTypeId, SpecialKind, Uid } from './types';

export function createEmptyCell(): Cell {
  return { uid: null, type: null, locked: false, frozen: false, special: null };
}

/** Creates a board with `rows` shelves of `cols` cells, all free by default. */
export function createEmptyBoard(
  rows: number,
  cols: number,
  lockedIndices: number[] = [],
  frozenIndices: number[] = [],
): BoardState {
  const size = rows * cols;
  const cells: Cell[] = Array.from({ length: size }, createEmptyCell);
  for (const index of lockedIndices) {
    const cell = cells[index];
    if (cell) cell.locked = true;
  }
  for (const index of frozenIndices) {
    const cell = cells[index];
    if (cell) cell.frozen = true;
  }
  return { rows, cols, cells, nextUid: 1 };
}

export function boardSize(board: BoardState): number {
  return board.rows * board.cols;
}

export function isInside(board: BoardState, row: number, col: number): boolean {
  return row >= 0 && row < board.rows && col >= 0 && col < board.cols;
}

export function indexOf(board: BoardState, row: number, col: number): number {
  if (!isInside(board, row, col)) {
    throw new RangeError(`cell (${row}, ${col}) is outside of a ${board.rows}x${board.cols} board`);
  }
  return row * board.cols + col;
}

export function rowOf(board: BoardState, index: number): number {
  return Math.floor(index / board.cols);
}

export function colOf(board: BoardState, index: number): number {
  return index % board.cols;
}

/** Returns the cell at a flat index, throwing when the index is out of range. */
export function cellAt(board: BoardState, index: number): Cell {
  const cell = board.cells[index];
  if (!cell) throw new RangeError(`cell index ${index} is outside of the board`);
  return board.cells[index] as Cell;
}

export function cloneBoard(board: BoardState): BoardState {
  return {
    rows: board.rows,
    cols: board.cols,
    nextUid: board.nextUid,
    cells: board.cells.map((cell) => ({ ...cell })),
  };
}

/** Low level mutable helper — always call it on a private clone. */
export function setCell(
  board: BoardState,
  index: number,
  value: { uid: Uid | null; type: ItemTypeId | null; special?: SpecialKind | null },
): void {
  const cell = cellAt(board, index);
  cell.uid = value.uid;
  cell.type = value.type;
  cell.special = value.special ?? null;
}

/** Puts a *new* item instance into a cell, assigning it a fresh uid. */
export function placeNewItem(
  board: BoardState,
  index: number,
  type: ItemTypeId,
  special: SpecialKind | null = null,
): Uid {
  const uid = board.nextUid;
  board.nextUid += 1;
  const cell = cellAt(board, index);
  cell.uid = uid;
  cell.type = type;
  cell.special = special;
  return uid;
}

/**
 * Empties a cell. The ice breaks with the product that was standing on it —
 * an empty cell is never frozen.
 */
export function clearCell(board: BoardState, index: number): void {
  const cell = cellAt(board, index);
  cell.uid = null;
  cell.type = null;
  cell.special = null;
  cell.frozen = false;
}

/** Melts every remaining ice on the board (called after a few collected triples). */
export function thawAll(board: BoardState): BoardState {
  if (!board.cells.some((cell) => cell.frozen)) return board;
  const next = cloneBoard(board);
  for (const cell of next.cells) cell.frozen = false;
  return next;
}

export function frozenIndices(board: BoardState): number[] {
  const result: number[] = [];
  board.cells.forEach((cell, index) => {
    if (cell.frozen) result.push(index);
  });
  return result;
}

export function isEmptyCell(cell: Cell): boolean {
  return cell.uid === null || cell.type === null;
}

/** Indices of cells that can receive an item. */
export function findEmptyCells(board: BoardState): number[] {
  const result: number[] = [];
  for (let i = 0; i < board.cells.length; i += 1) {
    const cell = board.cells[i] as Cell;
    if (!cell.locked && isEmptyCell(cell)) result.push(i);
  }
  return result;
}

/** Indices of cells that currently hold a movable item (ice pins products). */
export function findMovableIndices(board: BoardState): number[] {
  const result: number[] = [];
  for (let i = 0; i < board.cells.length; i += 1) {
    const cell = board.cells[i] as Cell;
    if (!cell.locked && !cell.frozen && !isEmptyCell(cell)) result.push(i);
  }
  return result;
}

export function itemCount(board: BoardState): number {
  let count = 0;
  for (const cell of board.cells) if (!isEmptyCell(cell)) count += 1;
  return count;
}

export function countByType(board: BoardState): Record<ItemTypeId, number> {
  const counts: Record<ItemTypeId, number> = {};
  for (const cell of board.cells) {
    if (cell.type === null) continue;
    counts[cell.type] = (counts[cell.type] ?? 0) + 1;
  }
  return counts;
}

export function isEmptyBoard(board: BoardState): boolean {
  return itemCount(board) === 0;
}

/** Stable, human readable snapshot used in tests and debug logs. */
export function boardToString(board: BoardState): string {
  const rows: string[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    const line: string[] = [];
    for (let col = 0; col < board.cols; col += 1) {
      const cell = cellAt(board, indexOf(board, row, col));
      if (cell.locked) line.push('##');
      else if (cell.type === null) line.push('..');
      else line.push(`${cell.type.slice(0, 2)}${cell.frozen ? '*' : ''}`);
    }
    rows.push(line.join(' '));
  }
  return rows.join('\n');
}
