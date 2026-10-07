import type { LevelGenerator } from '../../core/generate';
import type { LevelGoal, StarThresholds } from '../../core/goal';

/**
 * A level is pure data: board geometry, product configuration and the rules of
 * the level. New levels can be added without touching a single line of the
 * engine (see `src/data/levels/index.ts`).
 */
export interface LevelConfig {
  id: number;
  name: string;
  /** Number of shelves. */
  rows: number;
  /** Cells per shelf. A multiple of 3 keeps scramble levels clearable. */
  cols: number;
  generator: LevelGenerator;
  goal: LevelGoal;
  /**
   * Move budget. `'auto'` derives it from the verified solution length (`par`),
   * which the generator computes — so a level can never be impossible.
   */
  moveLimit?: number | 'auto';
  /** Extra moves added on top of `par` when the limit is automatic (fraction). */
  moveSlack?: number;
  /** Star thresholds in "moves left" units; derived from the limit by default. */
  stars?: StarThresholds;
  /**
   * Iced products melt (all at once) after this many collected triples. Keeps
   * levels with ice forgiving.
   */
  iceMeltAfter?: number;
  /** Free hints / undos per attempt. */
  hints?: number;
  undos?: number;
  /** Level ignores bought hint bonuses entirely (master modifier «без подсказок»). */
  noHints?: boolean;
  /** Set on master variants: the campaign level behind them and their modifiers. */
  master?: { baseId: number; modifiers: string[] };
  /** Coins for finishing the level (stars pay extra). */
  coins?: number;
  /** Short hint shown on the level map. */
  tip?: string;
  /** Visual theme key (used by later stages for shop decoration). */
  theme?: string;
}

/** Number of products that must be on the board. */
export function levelItemCount(config: LevelConfig): number {
  if (config.generator.kind !== 'scramble') {
    return config.generator.rows.reduce(
      (sum, row) => sum + row.split(/\s+/).filter((token) => token !== '..' && token !== '##').length,
      0,
    );
  }
  return config.generator.groups.reduce((sum, group) => sum + group.count, 0);
}

export function levelProductTypes(config: LevelConfig): string[] {
  if (config.generator.kind !== 'scramble') {
    const palette = config.generator.palette;
    const used = new Set<string>();
    for (const row of config.generator.rows) {
      for (const token of row.split(/\s+/)) if (palette[token]) used.add(palette[token]);
    }
    return [...used];
  }
  return config.generator.groups.map((group) => group.type);
}
