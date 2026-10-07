#!/usr/bin/env node
/**
 * Guard of the screen backgrounds.
 *
 * The whole interface is layered over the Phaser canvas (`.game-canvas`,
 * `inset: 0`), so a full-screen section **must** paint its own background —
 * otherwise the player sees the paused shelf scene of the canvas through the
 * screen instead of the game's purple. `.screen` only positions the layer.
 *
 * The check is a source-level one on purpose: real stylesheets are invisible to
 * the DOM tests (Vitest stubs CSS imports with empty modules), but this class of
 * bug — a new section whose rule was forgotten — is exactly what a text check
 * catches for free.
 *
 * Usage: `node scripts/screen-styles.mjs` (exit code 1 when something is missing).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sections of the game that cover the canvas. Keep in sync with `src/ui`. */
export const SCREEN_CLASSES = [
  'menu-screen',
  'map-screen',
  'shop-screen',
  'daily-screen',
  'gift-screen',
  'master-screen',
  'event-screen',
  'board-screen',
];

export const STYLE_SHEET = 'src/styles.css';

/** Drops `/* … *​/` comments: a comment sits between rules and would glue itself
 * to the first selector of the following group. */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `selector { body }` pair of the sheet, in source order. */
export function ruleBlocks(css) {
  const source = stripComments(css);
  const blocks = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const selectors = (match[1] ?? '')
      .split(',')
      .map((selector) => selector.trim())
      .filter((selector) => selector.length > 0);
    blocks.push({ selectors, body: match[2] ?? '' });
    match = pattern.exec(source);
  }
  return blocks;
}

/** `true` when any rule of this class declares a `background`. */
export function paintsBackground(blocks, className) {
  const target = `.${className}`;
  return blocks.some(
    (block) =>
      block.selectors.some(
        (selector) => selector === target || selector.startsWith(`${target}:`) || selector.startsWith(`${target}[`),
      ) && /(^|;|\s)background(-image)?\s*:/.test(block.body),
  );
}

/** Sections that would show the canvas through themselves. */
export function screensWithoutBackground(css, classes = SCREEN_CLASSES) {
  const blocks = ruleBlocks(css);
  return classes.filter((className) => !paintsBackground(blocks, className));
}

/** Reads the real stylesheet of the project. */
export function screenBackgroundReport() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const css = readFileSync(path.join(root, STYLE_SHEET), 'utf8');
  const missing = screensWithoutBackground(css);
  return { css, missing, classes: [...SCREEN_CLASSES] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { missing, classes } = screenBackgroundReport();
  console.log(`Экранов проверено: ${classes.length}`);
  if (missing.length > 0) {
    console.error(`Без собственного фона: ${missing.join(', ')} — под ними видно Phaser-сцену.`);
    process.exitCode = 1;
  } else {
    console.log('У всех экранов есть свой фон.');
  }
}
