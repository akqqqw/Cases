/**
 * Product icons are described as simple vector shapes in a 100x100 box.
 * The very same description is painted by Phaser (on the shelves) and by React
 * (in the HUD / shop), so an icon always looks identical everywhere.
 */

export interface ShapeBase {
  /** Fill colour, `#rrggbb`. */
  fill?: string;
  /** Fill opacity, 0..1 (default 1). */
  alpha?: number;
  /** Outline colour, `#rrggbb`. */
  stroke?: string;
  /** Outline width in the 100x100 space. */
  sw?: number;
}

export interface CircleShape extends ShapeBase {
  k: 'circle';
  x: number;
  y: number;
  r: number;
}

export interface RingShape extends ShapeBase {
  k: 'ring';
  x: number;
  y: number;
  r: number;
  /** Ring thickness. */
  sw: number;
}

export interface RectShape extends ShapeBase {
  k: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius. */
  r?: number;
  /** Rotation around the rect centre, degrees. */
  rot?: number;
}

export interface PolyShape extends ShapeBase {
  k: 'poly';
  points: Array<[number, number]>;
}

export interface LineShape extends ShapeBase {
  k: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sw: number;
}

export interface ArcShape extends ShapeBase {
  k: 'arc';
  x: number;
  y: number;
  r: number;
  /** Start angle in degrees, 0 = right, growing clockwise. */
  from: number;
  to: number;
  sw: number;
}

export type IconShape = CircleShape | RingShape | RectShape | PolyShape | LineShape | ArcShape;

export interface IconDef {
  /** Extra colour used by particles and highlights. */
  accent: string;
  shapes: IconShape[];
}

const ICON_SIZE = 100;

export const ICONS: Record<string, IconDef> = {
  apple: {
    accent: '#e5484d',
    shapes: [
      { k: 'circle', x: 50, y: 62, r: 32, fill: '#e5484d' },
      { k: 'circle', x: 36, y: 50, r: 9, fill: '#ffffff', alpha: 0.35 },
      { k: 'rect', x: 47, y: 20, w: 7, h: 18, r: 3, fill: '#7a4b2a', rot: -12 },
      { k: 'poly', points: [[52, 26], [78, 14], [58, 34]], fill: '#43a047' },
    ],
  },
  bread: {
    accent: '#d9a05b',
    shapes: [
      { k: 'rect', x: 14, y: 34, w: 72, h: 46, r: 22, fill: '#d9a05b' },
      { k: 'rect', x: 20, y: 38, w: 60, h: 16, r: 8, fill: '#e8b877' },
      { k: 'line', x1: 33, y1: 44, x2: 41, y2: 60, stroke: '#a9743b', sw: 4 },
      { k: 'line', x1: 50, y1: 42, x2: 58, y2: 58, stroke: '#a9743b', sw: 4 },
      { k: 'line', x1: 66, y1: 42, x2: 73, y2: 54, stroke: '#a9743b', sw: 4 },
    ],
  },
  cheese: {
    accent: '#f6c445',
    shapes: [
      { k: 'poly', points: [[14, 78], [62, 16], [88, 78]], fill: '#f6c445' },
      { k: 'circle', x: 46, y: 56, r: 7, fill: '#dfa72a' },
      { k: 'circle', x: 64, y: 66, r: 5.5, fill: '#dfa72a' },
      { k: 'circle', x: 53, y: 70, r: 4, fill: '#dfa72a' },
    ],
  },
  milk: {
    accent: '#4a90e2',
    shapes: [
      { k: 'rect', x: 28, y: 30, w: 44, h: 56, r: 6, fill: '#f5f7fa' },
      { k: 'poly', points: [[28, 32], [50, 10], [72, 32]], fill: '#dbe3ec' },
      { k: 'rect', x: 28, y: 54, w: 44, h: 20, r: 3, fill: '#4a90e2' },
      { k: 'circle', x: 50, y: 64, r: 5, fill: '#ffffff' },
    ],
  },
  juice: {
    accent: '#f28c28',
    shapes: [
      { k: 'poly', points: [[32, 26], [68, 26], [62, 86], [38, 86]], fill: '#ffffff', alpha: 0.75, stroke: '#c9d3dd', sw: 3 },
      { k: 'poly', points: [[35, 44], [65, 44], [60, 84], [40, 84]], fill: '#f28c28' },
      { k: 'circle', x: 50, y: 60, r: 9, fill: '#ffb648' },
      { k: 'line', x1: 57, y1: 12, x2: 66, y2: 42, stroke: '#e5484d', sw: 6 },
    ],
  },
  coffee: {
    accent: '#6b4226',
    shapes: [
      { k: 'rect', x: 16, y: 84, w: 68, h: 8, r: 4, fill: '#dfe4e9' },
      { k: 'poly', points: [[26, 34], [66, 34], [60, 84], [32, 84]], fill: '#f5f7fa' },
      { k: 'poly', points: [[30, 40], [62, 40], [58, 58], [34, 58]], fill: '#6b4226' },
      { k: 'arc', x: 68, y: 54, r: 13, from: -75, to: 75, stroke: '#f5f7fa', sw: 8 },
    ],
  },
  cake: {
    accent: '#f06292',
    shapes: [
      { k: 'rect', x: 12, y: 80, w: 76, h: 8, r: 4, fill: '#e6dccb' },
      { k: 'poly', points: [[16, 80], [84, 80], [50, 34]], fill: '#f8bbd0' },
      { k: 'line', x1: 28, y1: 68, x2: 72, y2: 68, stroke: '#f06292', sw: 5 },
      { k: 'line', x1: 36, y1: 55, x2: 64, y2: 55, stroke: '#f06292', sw: 5 },
      { k: 'circle', x: 50, y: 28, r: 7, fill: '#e5484d' },
    ],
  },
  donut: {
    accent: '#f7a1c4',
    shapes: [
      { k: 'ring', x: 50, y: 52, r: 24, sw: 22, fill: '#e2a05f' },
      { k: 'ring', x: 50, y: 52, r: 24, sw: 14, fill: '#f7a1c4' },
      { k: 'rect', x: 30, y: 40, w: 7, h: 3, r: 1.5, fill: '#ffffff', rot: 20 },
      { k: 'rect', x: 62, y: 34, w: 7, h: 3, r: 1.5, fill: '#f6c445', rot: -15 },
      { k: 'rect', x: 66, y: 62, w: 7, h: 3, r: 1.5, fill: '#8fd6d0', rot: 30 },
      { k: 'rect', x: 36, y: 70, w: 7, h: 3, r: 1.5, fill: '#ffffff', rot: -25 },
    ],
  },
  candy: {
    accent: '#7e57c2',
    shapes: [
      { k: 'poly', points: [[36, 52], [12, 34], [12, 70]], fill: '#9b7ede' },
      { k: 'poly', points: [[64, 52], [88, 34], [88, 70]], fill: '#9b7ede' },
      { k: 'circle', x: 50, y: 52, r: 19, fill: '#7e57c2' },
      { k: 'ring', x: 50, y: 52, r: 10, sw: 4, fill: '#ffffff', alpha: 0.6 },
    ],
  },
  bear: {
    accent: '#c08a4a',
    shapes: [
      { k: 'circle', x: 28, y: 30, r: 13, fill: '#a9743b' },
      { k: 'circle', x: 72, y: 30, r: 13, fill: '#a9743b' },
      { k: 'circle', x: 50, y: 54, r: 30, fill: '#c08a4a' },
      { k: 'circle', x: 50, y: 66, r: 15, fill: '#edcf9f' },
      { k: 'circle', x: 50, y: 58, r: 5.5, fill: '#5b3a1e' },
      { k: 'circle', x: 38, y: 46, r: 3.6, fill: '#3f2a14' },
      { k: 'circle', x: 62, y: 46, r: 3.6, fill: '#3f2a14' },
    ],
  },
  robot: {
    accent: '#8a94a6',
    shapes: [
      { k: 'line', x1: 50, y1: 12, x2: 50, y2: 26, stroke: '#8a94a6', sw: 5 },
      { k: 'circle', x: 50, y: 11, r: 6, fill: '#e5484d' },
      { k: 'rect', x: 28, y: 26, w: 44, h: 32, r: 9, fill: '#b6c0cd' },
      { k: 'circle', x: 40, y: 40, r: 5.5, fill: '#2f3b4d' },
      { k: 'circle', x: 60, y: 40, r: 5.5, fill: '#2f3b4d' },
      { k: 'rect', x: 22, y: 60, w: 56, h: 32, r: 8, fill: '#8a94a6' },
      { k: 'rect', x: 36, y: 68, w: 28, h: 14, r: 4, fill: '#dbe3ec' },
    ],
  },
  ball: {
    accent: '#6ec1e4',
    shapes: [
      { k: 'circle', x: 50, y: 52, r: 33, fill: '#f5f7fa', stroke: '#c9d3dd', sw: 3 },
      { k: 'poly', points: [[50, 38], [63, 48], [58, 63], [42, 63], [37, 48]], fill: '#2f3b4d' },
      { k: 'line', x1: 50, y1: 38, x2: 50, y2: 21, stroke: '#2f3b4d', sw: 4 },
      { k: 'line', x1: 63, y1: 48, x2: 79, y2: 43, stroke: '#2f3b4d', sw: 4 },
      { k: 'line', x1: 42, y1: 63, x2: 34, y2: 78, stroke: '#2f3b4d', sw: 4 },
    ],
  },
  phone: {
    accent: '#6ec1e4',
    shapes: [
      { k: 'rect', x: 30, y: 12, w: 40, h: 76, r: 10, fill: '#3a4552' },
      { k: 'rect', x: 35, y: 20, w: 30, h: 58, r: 5, fill: '#6ec1e4' },
      { k: 'rect', x: 44, y: 15, w: 12, h: 3, r: 1.5, fill: '#2a333d' },
      { k: 'circle', x: 50, y: 83, r: 4, fill: '#8a94a6' },
    ],
  },
  headphones: {
    accent: '#4a90e2',
    shapes: [
      { k: 'arc', x: 50, y: 56, r: 30, from: 195, to: 345, stroke: '#3a4552', sw: 9 },
      { k: 'rect', x: 14, y: 54, w: 18, h: 28, r: 8, fill: '#4a90e2' },
      { k: 'rect', x: 68, y: 54, w: 18, h: 28, r: 8, fill: '#4a90e2' },
      { k: 'rect', x: 19, y: 62, w: 8, h: 12, r: 4, fill: '#dbe3ec' },
      { k: 'rect', x: 73, y: 62, w: 8, h: 12, r: 4, fill: '#dbe3ec' },
    ],
  },
  camera: {
    accent: '#3a4552',
    shapes: [
      { k: 'rect', x: 62, y: 20, w: 18, h: 10, r: 4, fill: '#c9d3dd' },
      { k: 'rect', x: 14, y: 30, w: 72, h: 48, r: 11, fill: '#3a4552' },
      { k: 'circle', x: 50, y: 54, r: 18, fill: '#8a94a6' },
      { k: 'circle', x: 50, y: 54, r: 11, fill: '#2a333d' },
      { k: 'circle', x: 50, y: 54, r: 4.5, fill: '#6ec1e4' },
      { k: 'circle', x: 74, y: 40, r: 4, fill: '#f6c445' },
    ],
  },
  book: {
    accent: '#2f7d5d',
    shapes: [
      { k: 'rect', x: 20, y: 18, w: 60, h: 68, r: 6, fill: '#2f7d5d' },
      { k: 'rect', x: 20, y: 18, w: 14, h: 68, r: 6, fill: '#245f47' },
      { k: 'rect', x: 34, y: 24, w: 42, h: 56, r: 3, fill: '#fdf6e6' },
      { k: 'line', x1: 42, y1: 38, x2: 68, y2: 38, stroke: '#c9bfa6', sw: 3 },
      { k: 'line', x1: 42, y1: 48, x2: 68, y2: 48, stroke: '#c9bfa6', sw: 3 },
      { k: 'line', x1: 42, y1: 58, x2: 60, y2: 58, stroke: '#c9bfa6', sw: 3 },
    ],
  },
  magazine: {
    accent: '#f2c14e',
    shapes: [
      { k: 'rect', x: 20, y: 14, w: 60, h: 74, r: 5, fill: '#f2c14e' },
      { k: 'rect', x: 27, y: 21, w: 46, h: 60, r: 3, fill: '#fdf6e6' },
      { k: 'rect', x: 32, y: 26, w: 36, h: 24, r: 3, fill: '#6ec1e4' },
      { k: 'line', x1: 32, y1: 58, x2: 66, y2: 58, stroke: '#c9bfa6', sw: 3 },
      { k: 'line', x1: 32, y1: 68, x2: 58, y2: 68, stroke: '#c9bfa6', sw: 3 },
    ],
  },
  notebook: {
    accent: '#e5484d',
    shapes: [
      { k: 'rect', x: 24, y: 16, w: 54, h: 72, r: 7, fill: '#e5484d' },
      { k: 'rect', x: 33, y: 32, w: 36, h: 44, r: 3, fill: '#fdf6e6' },
      { k: 'line', x1: 40, y1: 46, x2: 62, y2: 46, stroke: '#c9bfa6', sw: 3 },
      { k: 'line', x1: 40, y1: 56, x2: 62, y2: 56, stroke: '#c9bfa6', sw: 3 },
      { k: 'line', x1: 40, y1: 66, x2: 55, y2: 66, stroke: '#c9bfa6', sw: 3 },
      { k: 'ring', x: 24, y: 30, r: 5, sw: 3, fill: '#c9d3dd' },
      { k: 'ring', x: 24, y: 52, r: 5, sw: 3, fill: '#c9d3dd' },
      { k: 'ring', x: 24, y: 74, r: 5, sw: 3, fill: '#c9d3dd' },
    ],
  },
  flower: {
    accent: '#f48fb1',
    shapes: [
      { k: 'line', x1: 50, y1: 50, x2: 50, y2: 88, stroke: '#43a047', sw: 5 },
      { k: 'poly', points: [[50, 66], [76, 58], [56, 80]], fill: '#4caf50' },
      { k: 'circle', x: 50, y: 24, r: 13, fill: '#f48fb1' },
      { k: 'circle', x: 74, y: 40, r: 13, fill: '#f48fb1' },
      { k: 'circle', x: 65, y: 64, r: 13, fill: '#f48fb1' },
      { k: 'circle', x: 35, y: 64, r: 13, fill: '#f48fb1' },
      { k: 'circle', x: 26, y: 40, r: 13, fill: '#f48fb1' },
      { k: 'circle', x: 50, y: 44, r: 12, fill: '#f6c445' },
    ],
  },
  cactus: {
    accent: '#4caf50',
    shapes: [
      { k: 'rect', x: 16, y: 42, w: 18, h: 26, r: 9, fill: '#43a047' },
      { k: 'rect', x: 66, y: 34, w: 18, h: 30, r: 9, fill: '#43a047' },
      { k: 'rect', x: 39, y: 18, w: 22, h: 58, r: 11, fill: '#4caf50' },
      { k: 'circle', x: 50, y: 18, r: 7.5, fill: '#f06292' },
      { k: 'poly', points: [[30, 74], [70, 74], [63, 92], [37, 92]], fill: '#d98a5f' },
    ],
  },
  tulip: {
    accent: '#ef5350',
    shapes: [
      { k: 'line', x1: 50, y1: 44, x2: 50, y2: 90, stroke: '#43a047', sw: 5 },
      { k: 'poly', points: [[50, 62], [24, 54], [46, 82]], fill: '#4caf50' },
      { k: 'circle', x: 36, y: 34, r: 14, fill: '#ef5350' },
      { k: 'circle', x: 64, y: 34, r: 14, fill: '#ef5350' },
      { k: 'circle', x: 50, y: 28, r: 15, fill: '#e5484d' },
    ],
  },
  perfume: {
    accent: '#c8a2f0',
    shapes: [
      { k: 'rect', x: 40, y: 8, w: 20, h: 18, r: 5, fill: '#f6c445' },
      { k: 'rect', x: 44, y: 26, w: 12, h: 12, r: 3, fill: '#8a94a6' },
      { k: 'rect', x: 30, y: 36, w: 40, h: 52, r: 10, fill: '#c8a2f0' },
      { k: 'rect', x: 35, y: 52, w: 30, h: 31, r: 7, fill: '#a06fe0' },
      { k: 'circle', x: 42, y: 46, r: 4, fill: '#ffffff', alpha: 0.5 },
    ],
  },
  candle: {
    accent: '#ffb648',
    shapes: [
      { k: 'circle', x: 50, y: 30, r: 11, fill: '#ffb648' },
      { k: 'circle', x: 50, y: 33, r: 6, fill: '#ff8a3d' },
      { k: 'line', x1: 50, y1: 38, x2: 50, y2: 45, stroke: '#5b3a1e', sw: 4 },
      { k: 'rect', x: 33, y: 44, w: 34, h: 42, r: 8, fill: '#f7e7c6' },
      { k: 'rect', x: 26, y: 84, w: 48, h: 9, r: 4, fill: '#c9a06a' },
    ],
  },
  soap: {
    accent: '#8fd6d0',
    shapes: [
      { k: 'circle', x: 74, y: 26, r: 12, fill: '#bfe8f5', alpha: 0.85 },
      { k: 'circle', x: 57, y: 18, r: 7, fill: '#bfe8f5', alpha: 0.85 },
      { k: 'rect', x: 20, y: 42, w: 58, h: 38, r: 14, fill: '#8fd6d0' },
      { k: 'rect', x: 29, y: 50, w: 28, h: 9, r: 4.5, fill: '#ffffff', alpha: 0.6 },
    ],
  },
};

export const ICON_VIEWBOX = ICON_SIZE;
