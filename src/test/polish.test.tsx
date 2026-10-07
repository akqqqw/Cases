// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The effects need Phaser only for geometry helpers; the fake scene below
// records what they would have drawn instead of drawing it.
import effectsSource from '../game/effects.ts?raw';
import gameSceneSource from '../game/GameScene.ts?raw';
import audioSource from '../game/audio.ts?raw';
import {
  REDUCED_SCALE,
  applyMotionPreference,
  detuneCents,
  motionReduced,
  motionScale,
  panFor,
  particleCount,
  prefersReducedMotion,
  setMotionScale,
  swayAngle,
} from '../game/juice';
import { arpeggioNotes, chordAt, shakerTicks, voicePan } from '../game/musicTheory';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CoinPill, Star, StarRow } from '../ui/components';

vi.mock('phaser', () => ({
  default: {
    Geom: { Point: class Point { constructor(public x: number, public y: number) {} } },
    Math: { Between: (min: number) => min },
  },
}));

const { burst, confetti, floatText, landing, shake, vignette } = await import('../game/effects');

declare global {
  // React needs this flag to allow `act()` outside of its own test renderer.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** Real DOM render: the polish lives in markup (classes, ids), so jsdom sees it. */
function mount(element: ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  act(() => {
    mounted.render(element);
  });
  return container;
}

// ------------------------------------------------------------------ fake scene

interface FakeScene {
  add: Record<string, (...args: unknown[]) => unknown>;
  tweens: { add: (config: Record<string, unknown>) => unknown; killTweensOf: () => void };
  scale: { width: number; height: number };
  textures: { exists: () => boolean };
  make: { graphics: () => unknown };
  created: Array<{ kind: string; args: unknown[] }>;
  tweenConfigs: Array<Record<string, unknown>>;
}

function fakeScene(): FakeScene {
  const created: Array<{ kind: string; args: unknown[] }> = [];
  const tweenConfigs: Array<Record<string, unknown>> = [];

  const gameObject = (kind: string) => (...args: unknown[]) => {
    created.push({ kind, args });
    const object: Record<string, unknown> = {
      setDepth: () => object,
      setTint: () => object,
      setScale: () => object,
      setAlpha: () => object,
      setAngle: () => object,
      setPosition: () => object,
      setVisible: () => object,
      setOrigin: () => object,
      setStrokeStyle: () => object,
      setStroke: () => object,
      setShadow: () => object,
      setScrollFactor: () => object,
      destroy: () => undefined,
      x: 0,
      y: 0,
      angle: 0,
      scale: 1,
      width: 64,
      height: 64,
      displayWidth: 64,
      texture: { key: 'item-apple' },
    };
    return object;
  };

  const graphics: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, prop: string) => (prop === 'generateTexture' ? () => graphics : () => graphics),
      set: () => true,
    },
  );

  return {
    add: {
      circle: gameObject('circle'),
      rectangle: gameObject('rectangle'),
      ellipse: gameObject('ellipse'),
      image: gameObject('image'),
      text: gameObject('text'),
    },
    tweens: {
      add: (config: Record<string, unknown>) => {
        tweenConfigs.push(config);
        return { stop: () => undefined };
      },
      killTweensOf: () => undefined,
    },
    scale: { width: 800, height: 600 },
    textures: { exists: () => true },
    make: { graphics: () => graphics },
    created,
    tweenConfigs,
  };
}

beforeEach(() => {
  setMotionScale(1);
});

afterEach(() => {
  setMotionScale(1);
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

// ------------------------------------------------------------------ juice

describe('the motion budget', () => {
  it('clamps the scale and reports when motion is reduced', () => {
    setMotionScale(0.5);
    expect(motionScale()).toBe(0.5);
    expect(motionReduced()).toBe(true);

    setMotionScale(4);
    expect(motionScale()).toBe(1);
    expect(motionReduced()).toBe(false);

    setMotionScale(Number.NaN);
    expect(motionScale()).toBe(1);

    setMotionScale(-3);
    expect(motionScale()).toBe(0);
  });

  it('reads the system preference and applies it', () => {
    const reduce = (): { matches: boolean } => ({ matches: true });
    const normal = (): { matches: boolean } => ({ matches: false });

    expect(prefersReducedMotion(reduce)).toBe(true);
    expect(prefersReducedMotion(normal)).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
    // A throwing implementation (old browsers) must not break the boot.
    expect(
      prefersReducedMotion(() => {
        throw new Error('no matchMedia');
      }),
    ).toBe(false);

    expect(applyMotionPreference(reduce)).toBe(REDUCED_SCALE);
    expect(motionReduced()).toBe(true);
    expect(applyMotionPreference(normal)).toBe(1);
    expect(motionReduced()).toBe(false);
  });

  it('keeps a burst visible even when the budget is small', () => {
    expect(particleCount(10, 1)).toBe(10);
    expect(particleCount(46, 1)).toBe(46);
    expect(particleCount(46, REDUCED_SCALE)).toBeLessThan(46);
    expect(particleCount(46, REDUCED_SCALE)).toBeGreaterThanOrEqual(2);
    expect(particleCount(1, REDUCED_SCALE)).toBeGreaterThanOrEqual(1);
    expect(particleCount(-5, 1)).toBeGreaterThanOrEqual(4);
  });

  it('places sounds on the stereo field by board position', () => {
    expect(panFor(0, 800)).toBe(-0.6);
    expect(panFor(800, 800)).toBe(0.6);
    expect(panFor(400, 800)).toBe(0);
    expect(panFor(-100, 800)).toBe(-0.6);
    expect(panFor(9999, 800)).toBe(0.6);
    // Defensive: a broken width never pans the sound away.
    expect(panFor(10, 0)).toBe(0);
    expect(panFor(Number.NaN, 800)).toBe(0);
  });

  it('tilts a dragged product and detunes repeated sounds', () => {
    expect(swayAngle(0)).toBe(0);
    expect(swayAngle(100)).toBeLessThanOrEqual(7);
    expect(swayAngle(-100)).toBeGreaterThanOrEqual(-7);
    expect(swayAngle(Number.NaN)).toBe(0);

    const values = Array.from({ length: 24 }, (_, index) => detuneCents(index));
    for (const value of values) {
      expect(Math.abs(value)).toBeLessThanOrEqual(9);
      expect(Number.isInteger(value)).toBe(true);
    }
    expect(detuneCents(0)).toBe(detuneCents(19)); // deterministic, wraps
    expect(new Set(values).size).toBeGreaterThan(3); // but not always the same
  });
});

// ------------------------------------------------------------- music theory

describe('the music additions', () => {
  it('walks the arpeggio through the chord of the bar', () => {
    for (let step = 0; step < 12; step += 1) {
      const notes = arpeggioNotes(step);
      expect(notes).toHaveLength(2);
      const chord = chordAt(step);
      for (const note of notes) {
        expect(chord.notes).toContain(note - 12);
      }
    }
    expect(arpeggioNotes(0)).toEqual(arpeggioNotes(4)); // the loop repeats
    expect(arpeggioNotes(2)).not.toEqual(arpeggioNotes(3));
  });

  it('keeps the shaker on the off-beats of a bar', () => {
    const ticks = shakerTicks();
    expect(ticks).toHaveLength(3);
    expect(ticks[0]).toBeGreaterThan(0);
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index]).toBeGreaterThan(ticks[index - 1] as number);
    }
  });

  it('spreads the voices across the field without pulling them out', () => {
    expect(voicePan(0, 1)).toBe(0);
    expect(voicePan(0, 4)).toBe(-0.45);
    expect(voicePan(3, 4)).toBe(0.45);
    expect(voicePan(1, 4)).toBeLessThan(voicePan(2, 4) as number);
    for (let index = 0; index < 4; index += 1) {
      expect(Math.abs(voicePan(index, 4))).toBeLessThanOrEqual(0.45);
    }
  });
});

// ------------------------------------------------------------- effect wiring

describe('effects honour the budget', () => {
  it('skips the screen shake when motion is reduced', () => {
    const scene = fakeScene();
    shake(scene as never, { x: 100 } as never, 8);
    expect(scene.tweenConfigs.length).toBe(1);

    scene.tweenConfigs.length = 0;
    setMotionScale(REDUCED_SCALE);
    shake(scene as never, { x: 100 } as never, 8);
    expect(scene.tweenConfigs.length).toBe(0);
  });

  it('skips the landing squash when motion is reduced', () => {
    const scene = fakeScene();
    const sprite = (scene.add.image as unknown as () => Record<string, unknown>)();
    sprite.width = 64;
    sprite.height = 64;

    landing(scene as never, sprite as never, 64);
    expect(scene.tweenConfigs.length).toBe(1);

    scene.tweenConfigs.length = 0;
    setMotionScale(REDUCED_SCALE);
    landing(scene as never, sprite as never, 64);
    expect(scene.tweenConfigs.length).toBe(0);
  });

  it('draws fewer confetti pieces when motion is reduced', () => {
    const full = fakeScene();
    confetti(full as never, 800, 600, ['#ff0000', '#00ff00']);
    const fullCount = full.created.length;
    expect(fullCount).toBeGreaterThan(10);

    setMotionScale(REDUCED_SCALE);
    const reduced = fakeScene();
    confetti(reduced as never, 800, 600, ['#ff0000', '#00ff00']);
    expect(reduced.created.length).toBeLessThan(fullCount);
    expect(reduced.created.length).toBeGreaterThan(0);
  });

  it('still shows a burst and a glow when motion is reduced', () => {
    setMotionScale(REDUCED_SCALE);
    const scene = fakeScene();
    burst(scene as never, 100, 100, '#ffd76a', 18);
    expect(scene.created.some((entry) => entry.kind === 'image')).toBe(true);
    expect(scene.created.length).toBeGreaterThanOrEqual(2);
    // Sparks are the particles — the count is bounded by the budget.
    expect(scene.created.filter((entry) => entry.kind === 'image').length).toBeLessThan(18);
  });

  it('frames a combo with four edge bands', () => {
    const scene = fakeScene();
    vignette(scene as never, '#ffd76a', 6);
    expect(scene.created.filter((entry) => entry.kind === 'rectangle')).toHaveLength(4);
  });

  it('pops the praise text in and leaves room for the stroke', () => {
    const scene = fakeScene();
    floatText(scene as never, 10, 10, 'Супер!');
    expect(scene.created[0]?.kind).toBe('text');
    expect(scene.tweenConfigs.length).toBe(2); // pop-in, then drift
  });
});

// --------------------------------------------------------------- source guards

describe('the polish stays wired', () => {
  it('keeps the effect textures and the motion budget in the effects module', () => {
    for (const key of ['fx-spark', 'fx-glow', 'fx-star', 'fx-ribbon', 'fx-smoke', 'fx-ice']) {
      expect(effectsSource).toContain(key);
    }
    expect(effectsSource).toContain('motionScale()');
    expect(effectsSource).toContain('particleCount(');
    // The new helpers are exported for the scene.
    for (const name of ['export function debris', 'export function smoke', 'export function trail',
      'export function landing', 'export function shine', 'export function vignette', 'export function rain']) {
      expect(effectsSource).toContain(name);
    }
  });

  it('plays the new effects from the scene', () => {
    for (const call of ['landing(this', 'trail(this', 'shine(this', 'vignette(this', 'rain(this']) {
      expect(gameSceneSource).toContain(call);
    }
    // The breathing of a special product survives a drag: the pulse is tracked
    // and restored instead of being killed together with every other tween.
    expect(gameSceneSource).toContain('private startIdlePulse');
    expect(gameSceneSource).toContain('private restoreIdlePulse');
    expect(gameSceneSource).toContain('this.restoreIdlePulse(drag.uid, sprite)');
    // Regression guards of the icons test must survive the polish.
    expect(gameSceneSource).toContain('this.ensureBoardTextures(board)');
    expect(gameSceneSource).toContain('if (this.textures.exists(wanted)) return wanted;');
    expect(gameSceneSource).toContain('this.itemTexture(cell.type, variant)');
  });

  it('gives the sound engine a room, a compressor and the new voices', () => {
    expect(audioSource).toContain('createConvolver');
    expect(audioSource).toContain('createDynamicsCompressor');
    expect(audioSource).toContain('createStereoPanner');
    for (const method of ['levelStart(', 'golden(', 'iceMelt(', 'uiOpen(', 'uiClose(']) {
      expect(audioSource).toContain(method);
    }
    expect(audioSource).toContain('arpeggioNotes(');
    expect(audioSource).toContain('shakerTicks()');
  });

  it('gives every star its own gradient and shines the third one', () => {
    const host = mount(<StarRow stars={3} />);
    const gradients = [...host.querySelectorAll('linearGradient')].map((node) => node.id);
    expect(gradients).toHaveLength(3);
    expect(new Set(gradients).size).toBe(3); // a shared id would be invalid HTML

    const filled = [...host.querySelectorAll('path')].map((node) => node.getAttribute('fill'));
    for (const id of gradients) {
      expect(filled.join(' ')).toContain(`url(#${id})`);
    }

    const stars = [...host.querySelectorAll('.star')];
    expect(stars).toHaveLength(3);
    expect(stars[2]?.classList.contains('star-best')).toBe(true);
    expect(stars[0]?.classList.contains('star-best')).toBe(false);

    // An empty slot stays muted and owns no gradient at all.
    const empty = mount(<Star filled={false} index={0} />);
    expect(empty.querySelectorAll('linearGradient')).toHaveLength(0);
  });

  it('bounces the coin pill when the amount changes', () => {
    vi.useFakeTimers();
    try {
      const host = mount(<CoinPill coins={10} />);
      const pill = (): Element => {
        const node = host.querySelector('.coin-pill');
        if (!node) throw new Error('the coin pill is not rendered');
        return node;
      };

      expect(pill().className).not.toContain('coin-pill-up');
      expect(pill().textContent).toContain('10');

      act(() => {
        root?.render(<CoinPill coins={25} />);
      });
      expect(pill().className).toContain('coin-pill-up');
      expect(pill().textContent).toContain('25');

      // Losing coins settles down instead of bouncing up.
      act(() => {
        root?.render(<CoinPill coins={5} />);
      });
      expect(pill().className).toContain('coin-pill-down');

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(pill().className).not.toContain('coin-pill-down');
      expect(pill().className).not.toContain('coin-pill-up');
    } finally {
      vi.useRealTimers();
    }
  });
});
