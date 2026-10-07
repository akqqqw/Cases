import Phaser from 'phaser';
import { hexToInt } from '../data/colors';
import { ICON_VIEWBOX, ICONS, type IconShape } from '../data/iconShapes';
import { getItem } from '../data/items';

/**
 * Paints the very same vector icon descriptions that the HUD renders as SVG.
 * Coordinates live in a 100x100 box and are centred on (`cx`, `cy`).
 */
export function paintIcon(
  graphics: Phaser.GameObjects.Graphics,
  iconId: string,
  size: number,
  cx = 0,
  cy = 0,
): void {
  const icon = ICONS[iconId];
  if (!icon) return;

  const scale = size / ICON_VIEWBOX;
  const px = (x: number): number => cx + (x - ICON_VIEWBOX / 2) * scale;
  const py = (y: number): number => cy + (y - ICON_VIEWBOX / 2) * scale;

  for (const shape of icon.shapes) paintShape(graphics, shape, scale, px, py);
}

function paintShape(
  g: Phaser.GameObjects.Graphics,
  shape: IconShape,
  scale: number,
  px: (x: number) => number,
  py: (y: number) => number,
): void {
  const alpha = shape.alpha ?? 1;
  const fill = shape.fill ? hexToInt(shape.fill) : 0xffffff;
  const stroke = shape.stroke ? hexToInt(shape.stroke) : fill;

  switch (shape.k) {
    case 'circle':
      if (shape.stroke) g.lineStyle((shape.sw ?? 2) * scale, stroke, alpha);
      g.fillStyle(fill, alpha);
      g.fillCircle(px(shape.x), py(shape.y), shape.r * scale);
      if (shape.stroke) g.strokeCircle(px(shape.x), py(shape.y), shape.r * scale);
      break;

    case 'ring':
      g.lineStyle(shape.sw * scale, fill, alpha);
      g.strokeCircle(px(shape.x), py(shape.y), shape.r * scale);
      break;

    case 'rect': {
      const width = shape.w * scale;
      const height = shape.h * scale;
      const radius = Math.min((shape.r ?? 0) * scale, Math.min(width, height) / 2);
      g.fillStyle(fill, alpha);
      if (shape.stroke) g.lineStyle((shape.sw ?? 2) * scale, stroke, alpha);

      if (shape.rot) {
        g.save();
        g.translateCanvas(px(shape.x + shape.w / 2), py(shape.y + shape.h / 2));
        g.rotateCanvas(Phaser.Math.DegToRad(shape.rot));
        g.fillRoundedRect(-width / 2, -height / 2, width, height, radius);
        if (shape.stroke) g.strokeRoundedRect(-width / 2, -height / 2, width, height, radius);
        g.restore();
      } else {
        g.fillRoundedRect(px(shape.x), py(shape.y), width, height, radius);
        if (shape.stroke) g.strokeRoundedRect(px(shape.x), py(shape.y), width, height, radius);
      }
      break;
    }

    case 'poly': {
      const points = shape.points.map(([x, y]) => new Phaser.Geom.Point(px(x), py(y)));
      g.fillStyle(fill, alpha);
      g.fillPoints(points, true);
      if (shape.stroke) {
        g.lineStyle((shape.sw ?? 2) * scale, stroke, alpha);
        g.strokePoints(points, true);
      }
      break;
    }

    case 'line':
      g.lineStyle(shape.sw * scale, stroke, alpha);
      g.lineBetween(px(shape.x1), py(shape.y1), px(shape.x2), py(shape.y2));
      break;

    case 'arc': {
      g.lineStyle(shape.sw * scale, stroke, alpha);
      g.beginPath();
      const fullCircle = Math.abs(shape.to - shape.from) >= 359.9;
      g.arc(
        px(shape.x),
        py(shape.y),
        shape.r * scale,
        Phaser.Math.DegToRad(shape.from),
        Phaser.Math.DegToRad(fullCircle ? shape.from + 359.9 : shape.to),
        false,
      );
      g.strokePath();
      break;
    }

    default: {
      // Compile-time guard: a new shape kind must be painted here too.
      const unhandled: never = shape;
      void unhandled;
      break;
    }
  }
}

/** Rounded product tile with the icon on top, used for every item on a shelf. */
export function paintTile(
  g: Phaser.GameObjects.Graphics,
  iconId: string,
  size: number,
  background: string,
  variant: TileVariant = 'plain',
): void {
  const radius = size * 0.24;
  const half = size / 2;
  const golden = variant === 'golden';
  const bomb = variant === 'bomb';
  const tile = golden ? GOLDEN_TILE : bomb ? BOMB_TILE : background;

  g.fillStyle(hexToInt('#3a2412'), 0.14);
  g.fillRoundedRect(-half, -half + size * 0.045, size, size, radius);

  g.fillStyle(hexToInt(tile), 1);
  g.fillRoundedRect(-half, -half, size, size, radius);

  g.fillStyle(hexToInt('#ffffff'), 0.5);
  g.fillRoundedRect(-half + size * 0.09, -half + size * 0.07, size * 0.82, size * 0.26, radius * 0.6);

  if (golden) {
    // warm glow inside the tile + a small sparkle in the corner
    g.fillStyle(hexToInt('#ffb648'), 0.35);
    g.fillRoundedRect(-half + size * 0.06, size * 0.06, size * 0.88, size * 0.36, radius * 0.7);
    g.fillStyle(hexToInt('#fff3c4'), 0.95);
    g.fillCircle(-half + size * 0.2, -half + size * 0.19, size * 0.045);
    g.fillCircle(-half + size * 0.1, -half + size * 0.26, size * 0.026);
  }

  if (bomb) {
    // dark fuse corner + warning stripes so a bomb never reads as a plain item
    g.fillStyle(hexToInt('#ff7a3d'), 0.9);
    g.fillCircle(half - size * 0.17, -half + size * 0.17, size * 0.085);
    g.fillStyle(hexToInt('#fff3c4'), 0.95);
    g.fillCircle(half - size * 0.19, -half + size * 0.15, size * 0.032);
    g.lineStyle(size * 0.035, hexToInt('#c9471b'), 0.85);
    g.beginPath();
    g.moveTo(half - size * 0.23, -half + size * 0.23);
    g.lineTo(half - size * 0.31, -half + size * 0.34);
    g.strokePath();
  }

  g.fillStyle(hexToInt('#3a2412'), 0.1);
  g.fillRoundedRect(-half, -half, size, size, radius);

  const border = golden ? '#e08a1e' : bomb ? '#d8552a' : '#4a2c14';
  const width = size * (variant === 'plain' ? 0.02 : 0.035);
  g.lineStyle(Math.max(1, width), hexToInt(border), variant === 'plain' ? 0.18 : 0.85);
  g.strokeRoundedRect(-half, -half, size, size, radius);

  paintIcon(g, iconId, size * 0.74, 0, size * 0.03);
}

/** Which special skin an item tile wears. */
export type TileVariant = 'plain' | 'golden' | 'bomb';

/** Tile background of a golden (special) product. */
export const GOLDEN_TILE = '#ffe9a3';
/** Tile background of a bomb product. */
export const BOMB_TILE = '#ffe0cf';

/** Which tile skins a board needs, so every sprite can be drawn right away. */
export interface TileTextureNeeds {
  /** Every product on the board (each one needs its plain tile). */
  ids: string[];
  /** Premium skins: only for the products that actually wear one. */
  variants: Partial<Record<TileVariant, string[]>>;
}

/**
 * Collects the textures a board needs. Sprites may be created on any board
 * change (not only when the whole shelf is rebuilt), so this must be cheap and
 * must be called wherever items are drawn — a sprite built from a key that does
 * not exist yet shows Phaser's black "missing texture" square.
 */
export function itemTextureNeeds(
  cells: ReadonlyArray<{ type: string | null; special: string | null }>,
): TileTextureNeeds {
  const ids = new Set<string>();
  const golden = new Set<string>();
  const bomb = new Set<string>();

  for (const cell of cells) {
    if (cell.type === null) continue;
    ids.add(cell.type);
    if (cell.special === 'golden') golden.add(cell.type);
    else if (cell.special === 'bomb') bomb.add(cell.type);
  }

  const variants: Partial<Record<TileVariant, string[]>> = {};
  if (golden.size > 0) variants.golden = [...golden];
  if (bomb.size > 0) variants.bomb = [...bomb];

  return { ids: [...ids], variants };
}

/**
 * One texture per product type (plus a golden variant) keeps the shelves cheap
 * to draw: a shelf of 40 items is just 40 image draws.
 */
export function ensureItemTextures(
  scene: Phaser.Scene,
  ids: string[],
  variants: Partial<Record<TileVariant, string[]>> = {},
  size = 192,
): void {
  for (const id of ids) {
    for (const variant of VARIANTS) {
      if (variant !== 'plain' && !(variants[variant] ?? []).includes(id)) continue;
      if (scene.textures.exists(itemTextureKey(id, variant))) continue;
      generateTileTexture(scene, id, size, variant);
    }
  }
}

const VARIANTS: TileVariant[] = ['plain', 'golden', 'bomb'];

function generateTileTexture(scene: Phaser.Scene, id: string, size: number, variant: TileVariant): void {
  const item = getItem(id);
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.translateCanvas(size / 2, size / 2);
  paintTile(graphics, id, size * 0.94, item.tile, variant);
  graphics.generateTexture(itemTextureKey(id, variant), size, size);
  graphics.destroy();
}

export function itemTextureKey(id: string, variant: TileVariant = 'plain'): string {
  return variant === 'plain' ? `item-${id}` : `item-${id}-${variant}`;
}
