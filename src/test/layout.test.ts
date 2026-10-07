import { describe, expect, it } from 'vitest';
import { boardOuterRect, cellBox, cellIndexAt, computeShelfLayout, shelfRect } from '../game/layout';

const VIEWPORTS: Array<[number, number]> = [
  [320, 568],
  [360, 640],
  [390, 844],
  [414, 896],
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [1920, 1080],
];

const SHAPES: Array<[number, number]> = [
  [5, 6],
  [6, 6],
  [7, 6],
  [6, 7],
  [3, 3],
  [8, 9],
];

describe('shelf layout', () => {
  it('always keeps the board inside the area reserved for it', () => {
    for (const [width, height] of VIEWPORTS) {
      for (const [rows, cols] of SHAPES) {
        const insets = { top: 130, bottom: 112 };
        const layout = computeShelfLayout({ rows, cols, width, height, insets });

        expect(layout.cellSize).toBeGreaterThan(15);
        expect(layout.boardWidth).toBeLessThanOrEqual(width - 20 + 0.5);
        expect(layout.originY).toBeGreaterThanOrEqual(insets.top - 0.5);
        expect(layout.originY + layout.boardHeight).toBeLessThanOrEqual(height - insets.bottom + 0.5);
        expect(layout.originX).toBeGreaterThan(0);

        const outer = boardOuterRect(layout);
        expect(outer.x).toBeGreaterThanOrEqual(-1);
        expect(outer.x + outer.width).toBeLessThanOrEqual(width + 1);
      }
    }
  });

  it('maps every cell centre back to its own index (drag hit-testing)', () => {
    for (const [width, height] of VIEWPORTS) {
      for (const [rows, cols] of SHAPES) {
        const layout = computeShelfLayout({ rows, cols, width, height, insets: { top: 120, bottom: 110 } });

        for (let index = 0; index < rows * cols; index += 1) {
          const box = cellBox(layout, index);
          expect(cellIndexAt(layout, box.cx, box.cy), `${rows}x${cols} on ${width}x${height}`).toBe(index);

          // points slightly inside the cell also hit it
          expect(cellIndexAt(layout, box.cx + box.size * 0.35, box.cy)).toBe(index);
          expect(cellIndexAt(layout, box.cx, box.cy - box.size * 0.35)).toBe(index);
        }
      }
    }
  });

  it('ignores touches outside the board', () => {
    const layout = computeShelfLayout({ rows: 5, cols: 6, width: 390, height: 844, insets: { top: 130, bottom: 112 } });
    expect(cellIndexAt(layout, 5, 5)).toBeNull();
    expect(cellIndexAt(layout, 389, 843)).toBeNull();
    expect(cellIndexAt(layout, layout.originX - 40, layout.originY + 10)).toBeNull();
  });

  it('serves consecutive shelves with separate planks', () => {
    const layout = computeShelfLayout({ rows: 5, cols: 6, width: 900, height: 700, insets: { top: 120, bottom: 110 } });
    for (let row = 0; row < layout.rows; row += 1) {
      const plank = shelfRect(layout, row);
      expect(plank.width).toBeCloseTo(layout.boardWidth, 5);
      expect(plank.y).toBeGreaterThan(layout.originY);
    }
    expect(shelfRect(layout, 4).y).toBeGreaterThan(shelfRect(layout, 0).y);
  });

  it('grows cells for roomy screens but never beyond the cap', () => {
    const small = computeShelfLayout({ rows: 5, cols: 6, width: 360, height: 640, insets: { top: 130, bottom: 112 } });
    const big = computeShelfLayout({ rows: 5, cols: 6, width: 1920, height: 1080, insets: { top: 130, bottom: 112 } });
    expect(big.cellSize).toBeGreaterThan(small.cellSize);
    expect(big.cellSize).toBeLessThanOrEqual(116);
  });
});
