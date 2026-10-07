/**
 * Types of `scripts/screen-styles.mjs` for the tests (the script itself is
 * plain ESM and runs straight from `node`).
 */

export const SCREEN_CLASSES: string[];
export const STYLE_SHEET: string;

export interface RuleBlock {
  selectors: string[];
  body: string;
}

export function stripComments(css: string): string;
export function ruleBlocks(css: string): RuleBlock[];
export function paintsBackground(blocks: RuleBlock[], className: string): boolean;
export function screensWithoutBackground(css: string, classes?: string[]): string[];
export function screenBackgroundReport(): { css: string; missing: string[]; classes: string[] };
