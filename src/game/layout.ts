/**
 * Shelf geometry. Everything is computed from the real canvas size, so the game
 * looks the same on a phone in portrait and on a desktop screen.
 */

export interface LayoutInsets {
  /** Space reserved for the top HUD. */
  top: number;
  /** Space reserved for the bottom HUD. */
  bottom: number;
}

export interface ShelfLayout {
  rows: number;
  cols: number;
  cellSize: number;
  gap: number;
  shelfGap: number;
  originX: number;
  originY: number;
  boardWidth: number;
  boardHeight: number;
  plankHeight: number;
  sideWidth: number;
  centerX: number;
  centerY: number;
  /** Screen width the layout was built for. */
  width: number;
  height: number;
}

export interface CellBox {
  x: number;
  y: number;
  size: number;
  cx: number;
  cy: number;
}

const MIN_CELL = 34;
const MIN_CELL_TIGHT = 20;
const MAX_CELL = 116;

export function computeShelfLayout(options: {
  rows: number;
  cols: number;
  width: number;
  height: number;
  insets: LayoutInsets;
}): ShelfLayout {
  const { rows, cols, width, height, insets } = options;
  const sidePadding = Math.max(10, Math.min(36, width * 0.035));
  const availableWidth = Math.max(80, width - sidePadding * 2);
  const availableHeight = Math.max(80, height - insets.top - insets.bottom);

  const gapRatio = 0.12;
  const shelfGapRatio = 0.34;
  // Two bookcase sides (0.26 cell each) plus a little breathing room.
  const furnitureRatio = 0.62;

  // Cell size limited by width: cols * cell + (cols - 1) * gap + sides <= availableWidth
  const widthLimited = availableWidth / (cols + (cols - 1) * gapRatio + furnitureRatio);
  // Cell size limited by height: rows * cell * (1 + shelfGap) <= availableHeight
  const heightLimited = availableHeight / (rows + (rows - 1) * shelfGapRatio);

  // Comfortable size, but never so small that the board leaves its band: on a
  // tiny screen a big shelf layout must still fit between the HUD bars.
  let cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, widthLimited, heightLimited));
  if (rows * cellSize > availableHeight) cellSize = Math.max(MIN_CELL_TIGHT, (availableHeight / rows) * 0.96);
  if (cols * cellSize * (1 + furnitureRatio / cols) > availableWidth * 0.985) {
    cellSize = Math.max(MIN_CELL_TIGHT, (availableWidth * 0.96) / (cols + furnitureRatio));
  }

  const gap = cellSize * gapRatio;
  const shelfGap = cellSize * shelfGapRatio;

  const boardWidth = cols * cellSize + (cols - 1) * gap;
  const boardHeight = rows * cellSize + (rows - 1) * shelfGap;

  const originX = (width - boardWidth) / 2;
  const originY = insets.top + (availableHeight - boardHeight) / 2;

  return {
    rows,
    cols,
    cellSize,
    gap,
    shelfGap,
    originX,
    originY,
    boardWidth,
    boardHeight,
    plankHeight: Math.max(6, cellSize * 0.14),
    sideWidth: Math.max(7, cellSize * 0.26),
    centerX: width / 2,
    centerY: insets.top + availableHeight / 2,
    width,
    height,
  };
}

export function cellBox(layout: ShelfLayout, index: number): CellBox {
  const row = Math.floor(index / layout.cols);
  const col = index % layout.cols;
  const x = layout.originX + col * (layout.cellSize + layout.gap);
  const y = layout.originY + row * (layout.cellSize + layout.shelfGap);

  return {
    x,
    y,
    size: layout.cellSize,
    cx: x + layout.cellSize / 2,
    cy: y + layout.cellSize / 2,
  };
}

/** Flat cell index under a point, or `null` when the point misses the board. */
export function cellIndexAt(layout: ShelfLayout, x: number, y: number, padding = 0): number | null {
  const step = layout.cellSize + layout.gap;
  const localX = x - layout.originX;
  const localY = y - layout.originY;
  if (localX < -padding || localY < -padding) return null;

  const col = Math.floor(localX / step);
  const row = Math.floor(localY / (layout.cellSize + layout.shelfGap));
  if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return null;

  const box = cellBox(layout, row * layout.cols + col);
  const insideX = Math.abs(x - box.cx) <= layout.cellSize / 2 + padding;
  const insideY = Math.abs(y - box.cy) <= layout.cellSize / 2 + padding;
  return insideX && insideY ? row * layout.cols + col : null;
}

/** Screen rect of one shelf plank (used for drawing). */
export function shelfRect(layout: ShelfLayout, row: number): { x: number; y: number; width: number; height: number } {
  const first = cellBox(layout, row * layout.cols);
  const width = layout.boardWidth;
  const x = layout.originX;
  const y = first.y + layout.cellSize - layout.plankHeight * 0.2;
  return { x, y, width, height: layout.plankHeight };
}

/** Total height used by the board plus its furniture (for centring decorations). */
export function boardOuterRect(layout: ShelfLayout): { x: number; y: number; width: number; height: number } {
  return {
    x: layout.originX - layout.sideWidth,
    y: layout.originY - layout.sideWidth * 0.9,
    width: layout.boardWidth + layout.sideWidth * 2,
    height: layout.boardHeight + layout.sideWidth * 1.6,
  };
}
