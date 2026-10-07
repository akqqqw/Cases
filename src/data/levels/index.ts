import { buildCampaign } from './campaign';
import { level1 } from './level1';
import type { LevelConfig } from './types';

/**
 * Level registry: the hand tuned first level plus the 59 generated campaign
 * levels. The map, the shop and the game itself only read this list.
 */
export const LEVELS: LevelConfig[] = [level1, ...buildCampaign()];

export const FIRST_LEVEL_ID = LEVELS[0]?.id ?? 1;

export function getLevel(id: number): LevelConfig | undefined {
  return LEVELS.find((level) => level.id === id);
}

export function nextLevelId(id: number): number | null {
  const index = LEVELS.findIndex((level) => level.id === id);
  if (index < 0 || index + 1 >= LEVELS.length) return null;
  return LEVELS[index + 1]?.id ?? null;
}

export function isLastLevel(id: number): boolean {
  return nextLevelId(id) === null;
}

export type { LevelConfig };
