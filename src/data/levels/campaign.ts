import { themeForLevel } from '../themes';
import type { LevelConfig } from './types';

/**
 * The campaign: 60 levels built from a difficulty curve, grouped by theme
 * (8 levels per world). Everything here is data — the engine, the map and the
 * shop only read these configs.
 *
 * Curve, per level id:
 *
 * | levels | shelves | triples | products | free cells | new mechanics         |
 * |--------|---------|---------|----------|------------|-----------------------|
 * | 2–13   | 4–5 × 6 | 3–4     | 3        | 60 %       | golden triples (12+)  |
 * | 14–25  | 5 × 6   | 5–6     | 3–4      | 50 %       | blocked cells (26+)   |
 * | 26–39  | 6 × 6   | 6–8     | 4–5      | 42 % → 33 %| goal levels (30+)     |
 * | 40–54  | 7 × 6   | 9–10    | 5–6      | 36 % → 29 %| bombs (36+), iced products (44+) |
 * | 55–60  | 8 × 6   | 11–12   | 6–7      | 31 % → 25 %| everything at once    |
 */
export const CAMPAIGN_SIZE = 60;

/** Levels from this id on use the assortment unlocked in the shop. */
export const SHOP_POOL_FROM_LEVEL = 15;

export function campaignSize(): number {
  return CAMPAIGN_SIZE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** How many product triples the level holds. */
export function triplesForLevel(id: number): number {
  return clamp(Math.round(3 + (id - 2) * 0.16), 3, 12);
}

/** How many different products the level uses. */
export function productTypesForLevel(id: number, poolSize: number): number {
  return clamp(Math.round(2.6 + (id - 2) * 0.075), 3, Math.min(poolSize, 8));
}

/**
 * Shelves per level. The board grows a bit slower than the product count, so
 * free space keeps shrinking (60 % → 25 %) — the "fewer free cells" ramp.
 */
export function rowsForTriples(triples: number): number {
  if (triples <= 3) return 4;
  if (triples <= 5) return 5;
  if (triples <= 8) return 6;
  if (triples <= 10) return 7;
  return 8;
}

/** Blocked ("nailed down") cells grow slowly and sit at the shelf ends. */
export function lockedCountForLevel(id: number): number {
  if (id < 26) return 0;
  if (id < 40) return 1;
  if (id < 52) return 2;
  if (id < 58) return 3;
  return 4;
}

/** Golden triples appear every 4th level, doubling in the last stretch. */
export function goldenTriplesForLevel(id: number): number {
  if (id < 12) return 0;
  if (id % 8 === 0 && id >= 44) return 2;
  return id % 4 === 0 ? 1 : 0;
}

/** Bomb triples: they blow away one more product triple for free. */
export function bombTriplesForLevel(id: number): number {
  if (id < 36) return 0;
  if (id >= 54 && id % 9 === 0) return 2;
  return id % 6 === 0 ? 1 : 0;
}

/** Iced products: nailed to the shelf until their triple is matched in place. */
export function frozenCountForLevel(id: number): number {
  if (id < 44) return 0;
  if (id < 52) return 1;
  if (id < 58) return 2;
  return 3;
}

/** How many collected triples melt the ice (only for levels that have any). */
export const ICE_MELT_AFTER = 3;

export function moveSlackForLevel(id: number): number {
  return Math.max(0.35, 1.3 - id * 0.015);
}

/**
 * Coins per finished level. Tuned against the shop price: finishing all 60
 * levels even with a single star covers the whole catalogue with room to spare
 * (checked by a test).
 */
export function coinsForLevel(id: number): number {
  return 25 + id * 3;
}

/** Cells nailed down at the ends of the lower shelves. */
export function lockedIndices(rows: number, cols: number, count: number): number[] {
  const indices: number[] = [];
  for (let row = rows - 1; row >= 0 && indices.length < count; row -= 2) {
    indices.push(row * cols + cols - 1);
  }
  for (let row = 0; row < rows && indices.length < count; row += 2) {
    indices.push(row * cols + cols - 2);
  }
  return indices.slice(0, count).sort((a, b) => a - b);
}

/** Splits `triples` between product types, rotating the heavy type by level. */
export function distributeTriples(
  triples: number,
  types: string[],
  id: number,
): Array<{ type: string; count: number }> {
  if (types.length === 0) return [];
  const base = Math.floor(triples / types.length);
  const extra = triples % types.length;
  const rotation = id % types.length;

  const result: Array<{ type: string; count: number }> = [];
  for (let i = 0; i < types.length; i += 1) {
    const shares = base + (i < extra ? 1 : 0);
    if (shares <= 0) continue;
    const type = types[(i + rotation) % types.length] as string;
    result.push({ type, count: shares * 3 });
  }
  return result;
}

/** Builds the configuration of a campaign level. */
export function buildCampaignLevel(id: number): LevelConfig {
  const theme = themeForLevel(id);
  const pool = theme.items;
  const typeCount = productTypesForLevel(id, pool.length);

  // Products of this theme only; the shop assortment is added at runtime.
  const types: string[] = [];
  for (let i = 0; i < typeCount; i += 1) types.push(pool[(id + i) % pool.length] as string);

  const wantedTriples = triplesForLevel(id);
  const rows = rowsForTriples(wantedTriples);
  const cols = 6;
  const locked = lockedIndices(rows, cols, lockedCountForLevel(id));

  // A blocked cell can kill one triple slot of its shelf.
  const slotsPerRow = Math.floor(cols / 3);
  const blockedSlots = new Set(locked.map((index) => Math.floor(index / cols) * slotsPerRow + Math.floor((index % cols) / 3)));
  const usableSlots = rows * slotsPerRow - blockedSlots.size;
  const triples = Math.min(wantedTriples, usableSlots - 1);

  const goldenTriples = Math.min(goldenTriplesForLevel(id), Math.max(0, triples - 2));
  const bombTriples = Math.min(bombTriplesForLevel(id), Math.max(0, triples - goldenTriples - 2));
  const groups = distributeTriples(triples - goldenTriples - bombTriples, types, id);

  // Golden triples carry the most common product, bombs the second one.
  const byCount = [...groups].sort((a, b) => b.count - a.count);
  const leading = byCount[0]?.type ?? (types[0] as string);
  const secondary = byCount[1]?.type ?? leading;
  const golden = goldenTriples > 0 ? [{ type: leading, count: goldenTriples * 3 }] : [];
  const bombs = bombTriples > 0 ? [{ type: secondary, count: bombTriples * 3 }] : [];
  const frozen = frozenCountForLevel(id);

  // Every 5th level from 30 asks for specific products instead of a full clear.
  const collectGoal = id >= 30 && id % 5 === 0;
  const goal = collectGoal
    ? { kind: 'clearTypes' as const, types: [...groups].sort((a, b) => b.count - a.count).slice(0, Math.max(1, groups.length - 1)).map((group) => group.type) }
    : { kind: 'clearAll' as const };

  return {
    id,
    name: theme.names[id % theme.names.length] as string,
    rows,
    cols,
    generator: {
      kind: 'scramble',
      seed: 1000 + id * 37,
      groups,
      ...(golden.length > 0 ? { golden } : {}),
      ...(bombs.length > 0 ? { bombs } : {}),
      ...(locked.length > 0 ? { locked } : {}),
      ...(frozen > 0 ? { frozen } : {}),
      scrambleMoves: triples * 2,
    },
    goal,
    moveLimit: 'auto',
    moveSlack: moveSlackForLevel(id),
    hints: 3,
    undos: 3,
    ...(frozen > 0 ? { iceMeltAfter: ICE_MELT_AFTER } : {}),
    coins: coinsForLevel(id),
    theme: theme.id,
    tip:
      (frozen > 0 ? 'Замороженный товар нельзя двигать — собери тройку на полке. Лёд растает сам' : undefined) ??
      (bombs.length > 0 ? 'Бомба: тройка с ней убирает ещё три товара' : undefined) ??
      (collectGoal ? 'Собери только отмеченные товары' : undefined) ??
      (id <= 6 ? 'Тройки подряд собирают комбо — за серию платят монетами' : undefined),
  };
}

/** All campaign levels in order. */
export function buildCampaign(): LevelConfig[] {
  const levels: LevelConfig[] = [];
  for (let id = 2; id <= CAMPAIGN_SIZE; id += 1) levels.push(buildCampaignLevel(id));
  return levels;
}
