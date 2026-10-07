/**
 * Regression guard of the screen backgrounds.
 *
 * The interface is layered on top of the always-mounted Phaser canvas
 * (`.game-canvas`, `inset: 0`), so every full-screen section must paint its own
 * background — otherwise the paused shelf scene shows through the section
 * instead of the game's purple. That is exactly what happened to the rating and
 * the gift screens: `.gift-screen` had no rule at all and `.board-screen` had no
 * `background`, while `.screen` alone only positions the layer.
 *
 * Stylesheets are invisible to the DOM tests (Vitest stubs CSS imports with
 * empty modules), so the check reads `src/styles.css` as a text through a tiny
 * Node helper — the same way the packaging script is tested.
 */
import { describe, expect, it } from 'vitest';
import {
  SCREEN_CLASSES,
  STYLE_SHEET,
  paintsBackground,
  ruleBlocks,
  screenBackgroundReport,
  screensWithoutBackground,
  stripComments,
} from '../../scripts/screen-styles.mjs';

const report = screenBackgroundReport();

describe('screen backgrounds', () => {
  it('gives every full-screen section its own background', () => {
    expect(report.classes.length).toBe(SCREEN_CLASSES.length);
    expect(report.missing).toEqual([]);
  });

  it('lists every section the UI actually renders', () => {
    // The list is the contract of this check: a new section must be added here
    // (and to `src/styles.css`) — otherwise it silently shows the canvas.
    for (const className of ['menu-screen', 'map-screen', 'shop-screen', 'daily-screen', 'gift-screen', 'master-screen', 'event-screen', 'board-screen']) {
      expect(SCREEN_CLASSES).toContain(className);
    }
    expect(STYLE_SHEET).toBe('src/styles.css');
    // And the file the check reads is the real one, not an empty stub.
    expect(report.css.length).toBeGreaterThan(20_000);
  });

  it('catches a section that lost its background', () => {
    // The exact shape of the bug: the rating and the gift screens dropped out
    // of the shared rule.
    const without = report.css.replace(/\.daily-screen,\n\.gift-screen,\n\.board-screen \{/, '.daily-screen {');
    expect(screensWithoutBackground(without)).toEqual(['gift-screen', 'board-screen']);
  });

  it('understands selectors, comments and shorthand backgrounds', () => {
    const css = `
      /* a comment must not glue itself to the next selector */
      .one, .two { background: var(--plum); }
      .three { background-image: url(x.png); }
      .four { color: var(--cream); }
      .five:hover { background: red; }
    `;
    // Four rules: the first one groups `.one` and `.two`.
    const blocks = ruleBlocks(css);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.selectors).toEqual(['.one', '.two']);
    expect(paintsBackground(blocks, 'one')).toBe(true);
    expect(paintsBackground(blocks, 'two')).toBe(true);
    expect(paintsBackground(blocks, 'three')).toBe(true);
    expect(paintsBackground(blocks, 'five')).toBe(true); // `:hover` counts too
    expect(paintsBackground(blocks, 'four')).toBe(false);
    expect(screensWithoutBackground(css, ['one', 'two', 'three', 'four', 'five'])).toEqual(['four']);
    expect(stripComments('/* x { } */ .a { color: red }')).not.toContain('x { }');
  });
});
