// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
// The scene itself needs a WebGL context, so the guard below reads its source.
import gameSceneSource from '../game/GameScene.ts?raw';

// `iconPainter` needs Phaser only for geometry helpers at paint time, and the
// fake graphics below records the drawing calls instead.
vi.mock('phaser', () => ({
  default: {
    Math: { DegToRad: (deg: number) => (deg * Math.PI) / 180 },
    Geom: { Point: class Point { constructor(public x: number, public y: number) {} } },
  },
}));

const { ensureItemTextures, itemTextureKey, itemTextureNeeds } = await import('../game/iconPainter');

interface FakeGraphics {
  generateTexture: (key: string) => FakeGraphics;
}

/** Minimal texture manager + graphics factory that records generated keys. */
function fakeScene(): {
  scene: { textures: { exists: (key: string) => boolean }; make: { graphics: () => FakeGraphics } };
  generated: string[];
} {
  const keys = new Set<string>();
  const generated: string[] = [];

  const graphics: FakeGraphics = new Proxy({} as FakeGraphics, {
    get(_target, prop: string) {
      if (prop === 'generateTexture') {
        return (key: string) => {
          keys.add(key);
          generated.push(key);
          return graphics;
        };
      }
      return () => graphics;
    },
    set: () => true,
  });

  return {
    scene: { textures: { exists: (key: string) => keys.has(key) }, make: { graphics: () => graphics } },
    generated,
  };
}

const cell = (type: string | null, special: string | null = null) => ({ type, special });

describe('tile texture keys', () => {
  it('names every skin separately', () => {
    expect(itemTextureKey('apple')).toBe('item-apple');
    expect(itemTextureKey('apple', 'plain')).toBe('item-apple');
    expect(itemTextureKey('apple', 'golden')).toBe('item-apple-golden');
    expect(itemTextureKey('apple', 'bomb')).toBe('item-apple-bomb');
  });
});

describe('which skins a board needs', () => {
  it('asks for plain tiles and nothing else on a normal board', () => {
    const needs = itemTextureNeeds([cell('apple'), cell('cake'), cell(null)]);
    expect(needs.ids.sort()).toEqual(['apple', 'cake']);
    expect(needs.variants).toEqual({});
  });

  it('asks for the golden and bomb skins of the products that wear them', () => {
    const needs = itemTextureNeeds([
      cell('candy'),
      cell('candy', 'golden'),
      cell('candy', 'golden'),
      cell('milk', 'bomb'),
      cell('apple'),
      cell(null),
    ]);

    expect(needs.ids.sort()).toEqual(['apple', 'candy', 'milk']);
    expect(needs.variants.golden).toEqual(['candy']);
    expect(needs.variants.bomb).toEqual(['milk']);
  });

  it('needs nothing on an empty board', () => {
    expect(itemTextureNeeds([cell(null), cell(null)])).toEqual({ ids: [], variants: {} });
  });
});

describe('texture creation', () => {
  it('creates the plain tile plus every requested skin', () => {
    const { scene, generated } = fakeScene();
    ensureItemTextures(scene as never, ['candy', 'milk'], { golden: ['candy'], bomb: ['milk'] });

    expect(generated.sort()).toEqual(['item-candy', 'item-candy-golden', 'item-milk', 'item-milk-bomb']);
  });

  it('does not touch textures that already exist', () => {
    const { scene, generated } = fakeScene();
    ensureItemTextures(scene as never, ['candy'], { golden: ['candy'] });
    const first = [...generated];

    ensureItemTextures(scene as never, ['candy'], { golden: ['candy'] });
    expect(generated).toEqual(first);
  });

  it('never creates a skin that was not asked for', () => {
    const { scene, generated } = fakeScene();
    ensureItemTextures(scene as never, ['candy'], { golden: ['candy'] });
    expect(generated).not.toContain('item-candy-bomb');
  });
});

describe('the scene keeps skins in sync with the sprites', () => {
  const source = gameSceneSource;

  it('ensures textures inside syncBoard, not only in rebuild', () => {
    const start = source.indexOf('private syncBoard(board: BoardState');
    expect(start, 'syncBoard exists').toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('\n  private ', start + 10));

    // Regression guard: sprites are created for a board whose shelf size did not
    // change (golden levels often match the previous level), so the skins must
    // be created there too — otherwise the items show up as black squares.
    expect(body).toContain('this.ensureBoardTextures(board)');
  });

  it('never draws a texture that may be missing', () => {
    expect(source).toContain('this.itemTexture(type, variant)');
    expect(source).toContain('this.itemTexture(cell.type, variant)');
    expect(source).toContain('if (this.textures.exists(wanted)) return wanted;');
  });
});
