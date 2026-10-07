import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS, ITEMS, ITEM_IDS } from '../data/items';
import { ICONS } from '../data/iconShapes';
import { hexToInt, mixColors, shade } from '../data/colors';

const HEX = /^#[0-9a-f]{6}$/i;

describe('product catalogue', () => {
  it('ships at least 20 products', () => {
    expect(ITEM_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it('covers food, drinks, toys, electronics, books and flowers', () => {
    const categories = new Set(Object.values(ITEMS).map((item) => item.category));
    for (const required of ['food', 'drinks', 'toys', 'electronics', 'books', 'flowers'] as const) {
      expect(categories.has(required), `missing category ${required}`).toBe(true);
    }
    for (const category of categories) expect(CATEGORY_LABELS[category]).toBeTruthy();
  });

  it('gives every product a unique name and a tile colour', () => {
    const names = new Set<string>();
    for (const item of Object.values(ITEMS)) {
      expect(names.has(item.name), `duplicate name ${item.name}`).toBe(false);
      names.add(item.name);
      expect(item.tile).toMatch(HEX);
      expect(item.accent).toMatch(HEX);
      expect(item.name.length).toBeGreaterThan(2);
    }
  });
});

describe('vector icons', () => {
  it('has an icon for every product and no orphan icons', () => {
    for (const id of ITEM_IDS) expect(ICONS[id], `missing icon for ${id}`).toBeTruthy();
    for (const id of Object.keys(ICONS)) expect(ITEMS[id], `icon ${id} has no product`).toBeTruthy();
  });

  it('describes every icon with drawable, well formed shapes', () => {
    for (const [id, icon] of Object.entries(ICONS)) {
      expect(icon.shapes.length, `${id} needs at least two shapes`).toBeGreaterThanOrEqual(2);
      expect(icon.accent).toMatch(HEX);

      for (const shape of icon.shapes) {
        for (const colour of [shape.fill, shape.stroke]) {
          if (colour) expect(colour, `${id} has a bad colour`).toMatch(HEX);
        }
        const numbers: number[] = [];
        switch (shape.k) {
          case 'circle':
          case 'ring':
          case 'arc':
            numbers.push(shape.x, shape.y, shape.r);
            break;
          case 'rect':
            numbers.push(shape.x, shape.y, shape.w, shape.h);
            break;
          case 'line':
            numbers.push(shape.x1, shape.y1, shape.x2, shape.y2);
            break;
          case 'poly':
            for (const [x, y] of shape.points) numbers.push(x, y);
            break;
        }
        for (const value of numbers) expect(Number.isFinite(value), `${id} has a broken shape`).toBe(true);
        expect(numbers.every((value) => value >= -10 && value <= 120), `${id} draws outside the icon box`).toBe(true);
      }
    }
  });

  it('keeps every icon visually distinguishable by colour set', () => {
    const fingerprints = new Set<string>();
    for (const [id, icon] of Object.entries(ICONS)) {
      const fingerprint = icon.shapes.map((shape) => shape.fill ?? shape.stroke ?? '').join('|');
      expect(fingerprints.has(fingerprint), `${id} looks identical to another icon`).toBe(false);
      fingerprints.add(fingerprint);
    }
  });
});

describe('colour helpers', () => {
  it('parses, mixes and shades hex colours', () => {
    expect(hexToInt('#ff8800')).toBe(0xff8800);
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(shade('#808080', 0.5)).toBe('#c0c0c0');
    expect(shade('#808080', -0.5)).toBe('#404040');
  });
});
