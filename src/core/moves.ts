import { cellAt, clearCell, cloneBoard, colOf, isEmptyCell, rowOf } from './board';
import { chooseRemoval, findAllRuns, findRunThrough } from './match';
import { applyBlast, hasBomb, planBlast } from './specials';
import type {
  BlastGroup,
  BoardState,
  ClearedItem,
  MatchGroup,
  MoveRejectReason,
  MoveResult,
} from './types';

/** Why a move is not allowed (or `null` when it is). */
export function checkMove(board: BoardState, from: number, to: number): MoveRejectReason | null {
  if (!board.cells[from] || !board.cells[to]) return 'out-of-bounds';
  if (from === to) return 'same-cell';

  const source = cellAt(board, from);
  const target = cellAt(board, to);

  if (source.locked) return 'source-locked';
  if (isEmptyCell(source)) return 'empty-source';
  if (source.frozen) return 'source-frozen';
  if (target.locked) return 'target-locked';
  if (!isEmptyCell(target)) return 'target-occupied';
  return null;
}

export function isLegalMove(board: BoardState, from: number, to: number): boolean {
  return checkMove(board, from, to) === null;
}

/** All legal moves for the current board (used by hints and tests). */
export function legalMoves(board: BoardState): Array<{ from: number; to: number }> {
  const moves: Array<{ from: number; to: number }> = [];
  for (let from = 0; from < board.cells.length; from += 1) {
    if (isEmptyCell(cellAt(board, from))) continue;
    for (let to = 0; to < board.cells.length; to += 1) {
      if (checkMove(board, from, to) === null) moves.push({ from, to });
    }
  }
  return moves;
}

/**
 * Applies a drag-move: the item from `from` is put into the free cell `to`.
 * Afterwards every complete run on the board disappears.
 *
 * The function is pure — the passed board never changes.
 */
export function applyMove(board: BoardState, from: number, to: number): MoveResult {
  const reason = checkMove(board, from, to);
  if (reason) {
    return { ok: false, reason, board, from, to, cleared: [], match: null, blast: null };
  }

  const next = cloneBoard(board);
  const source = cellAt(next, from);
  const target = cellAt(next, to);
  const movedUid = source.uid;
  const movedType = source.type;
  const movedSpecial = source.special;

  target.uid = movedUid;
  target.type = movedType;
  target.special = movedSpecial;
  clearCell(next, from);

  // Only the destination row can gain a new run, but resolving every run keeps
  // the board stable no matter what (and is future-proof for gravity/specials).
  const runs = collectRuns(next, to);
  const cleared: ClearedItem[] = [];
  let match: MatchGroup | null = null;

  for (const run of runs) {
    const removal = chooseRemoval(run, to);
    for (const index of removal) {
      const cell = cellAt(next, index);
      if (cell.type === null) continue;
      cleared.push({ uid: cell.uid as number, type: cell.type, index, special: cell.special });
      clearCell(next, index);
    }
    if (match === null && removal.some((index) => index === to)) {
      match = { type: movedType as string, indices: removal };
    }
  }

  if (match === null && cleared.length > 0) {
    match = { type: cleared[0]!.type, indices: cleared.map((item) => item.index) };
  }

  // A bomb triple takes one more product triple with it. Resolving it here (and
  // not in the UI) keeps the solver, the generator and the player in sync.
  let blast: BlastGroup | null = null;
  let finalBoard = next;

  if (cleared.length > 0 && hasBomb(cleared)) {
    const plan = planBlast(finalBoard);
    if (plan) {
      const result = applyBlast(finalBoard, plan);
      finalBoard = result.board;
      cleared.push(...result.cleared);
      blast = { type: plan.type, indices: plan.indices };
      if (match) match = { ...match, indices: [...match.indices] };
    }
  }

  return { ok: true, board: finalBoard, from, to, cleared, match, blast };
}

/** Runs touching the destination first, then any other run left on the board. */
function collectRuns(board: BoardState, anchor: number): number[][] {
  const runs: number[][] = [];
  const anchorRun = findRunThrough(board, anchor);
  if (anchorRun) runs.push(anchorRun);

  for (const run of findAllRuns(board)) {
    const overlaps = runs.some((known) => known.some((index) => run.includes(index)));
    if (!overlaps) runs.push(run);
  }
  return runs;
}

/**
 * Moves an item without resolving matches. Used by the level generator, where
 * intermediate boards are allowed to hold triples.
 */
export function moveItem(board: BoardState, from: number, to: number): BoardState | null {
  if (checkMove(board, from, to)) return null;
  const next = cloneBoard(board);
  const source = cellAt(next, from);
  const target = cellAt(next, to);
  target.uid = source.uid;
  target.type = source.type;
  target.special = source.special;
  clearCell(next, from);
  return next;
}

/** Row and column of a flat index — re-exported for convenience. */
export { colOf, rowOf };
