import { getLevel } from './levels';
import { CAMPAIGN_SIZE, lockedIndices } from './levels/campaign';
import type { LevelConfig } from './levels/types';

/**
 * Master mode: the endgame. The sixty campaign levels are played again with
 * modifiers — fewer moves, no hints, more ice, more blocked cells, more special
 * triples. Nothing new is authored: a master level is a *pure function of the
 * campaign level it is built from*, so the mode scales without writing a single
 * new board.
 *
 * Winning pays mastery points and crowns; points are only ever raised by a new
 * personal best, so the mode cannot be farmed by replaying an easy level.
 */
export type MasterModifierId = 'slow' | 'no-hints' | 'ice' | 'locked' | 'specials';

export interface MasterModifier {
  id: MasterModifierId;
  title: string;
  icon: string;
  /** One line explanation for the level card. */
  note: string;
  /** `false` when the generator of this level cannot take the modifier. */
  canApply: (config: LevelConfig) => boolean;
  /** Returns the harder version of the level (never mutates the input). */
  apply: (config: LevelConfig) => LevelConfig;
}

/** Master level ids live above the campaign, so one registry stays untouched. */
export const MASTER_ID_BASE = 1000;
/** Master boards are a different scramble of the same level. */
export const MASTER_SEED_OFFSET = 7919;
/** Move slack of a master level: `autoMoveLimit` still keeps the solver's par. */
export const MASTER_SLACK = 0.1;
export const MASTER_ICE_EXTRA = 2;
export const MASTER_LOCKED_EXTRA = 2;
export const MASTER_SPECIAL_EXTRA = 1;

type SpecialGroup = { type: string; count: number };

const emptySpecial = (): SpecialGroup[] => [];

/**
 * The generator refuses a board that has no free triple slot left (products
 * could not be moved at all). The master modifiers therefore measure the same
 * thing the generator does and never add more than fits — a level that is tight
 * simply gets fewer extra blocks or specials instead of failing to generate.
 */
function slotCount(config: LevelConfig): number {
  return config.rows * Math.floor(config.cols / 3);
}

function lockedList(config: LevelConfig): number[] {
  if (config.generator.kind !== 'scramble') return [];
  const value = config.generator.locked;
  if (Array.isArray(value)) return value;
  return lockedIndices(config.rows, config.cols, Math.max(0, Math.floor(value ?? 0)));
}

function blockedSlots(config: LevelConfig, locked: number[]): Set<number> {
  const perRow = Math.floor(config.cols / 3);
  return new Set(locked.map((index) => Math.floor(index / config.cols) * perRow + Math.floor((index % config.cols) / 3)));
}

function usedTriples(config: LevelConfig): number {
  if (config.generator.kind !== 'scramble') return 0;
  const generator = config.generator;
  const triplesOf = (list: SpecialGroup[] | undefined): number =>
    (list ?? []).reduce((sum, group) => sum + group.count / 3, 0);
  return triplesOf(generator.groups) + triplesOf(generator.golden) + triplesOf(generator.bombs);
}

/** Free triple slots the generator requires to stay at least one. */
function freeSlots(config: LevelConfig, locked: number[] = lockedList(config)): number {
  return slotCount(config) - blockedSlots(config, locked).size - usedTriples(config);
}

function nextLockedList(config: LevelConfig, extra: number): number[] | null {
  if (config.generator.kind !== 'scramble') return null;
  const current = lockedList(config);
  const next = lockedIndices(config.rows, config.cols, current.length + extra);
  if (next.length <= current.length) return null;
  return freeSlots(config, next) >= 1 ? next : null;
}

function scrambleCount(config: LevelConfig, key: 'frozen' | 'locked'): number {
  if (config.generator.kind !== 'scramble') return 0;
  const value = config.generator[key];
  if (typeof value === 'number') return Math.max(0, Math.floor(value));
  return Array.isArray(value) ? value.length : 0;
}

function withScrambleCount(config: LevelConfig, key: 'frozen' | 'locked', count: number): LevelConfig {
  if (config.generator.kind !== 'scramble') return config;
  return { ...config, generator: { ...config.generator, [key]: count } };
}

function canAddSpecial(config: LevelConfig): boolean {
  if (config.generator.kind !== 'scramble') return false;
  if (config.generator.groups.length === 0) return false;
  return freeSlots(config) >= 2;
}

/** Adds `extra` special triples of a kind, reusing the leading products. */
function addSpecialTriples(config: LevelConfig, kind: 'golden' | 'bombs', extra: number): LevelConfig {
  if (config.generator.kind !== 'scramble') return config;

  const groups = [...config.generator.groups].sort((a, b) => b.count - a.count);
  const leading = groups[0]?.type;
  if (!leading) return config;
  const type = kind === 'golden' ? leading : (groups[1]?.type ?? leading);

  const current = config.generator[kind] ?? emptySpecial();
  const existing = current.find((group) => group.type === type);
  const next = existing
    ? current.map((group) => (group.type === type ? { ...group, count: group.count + extra * 3 } : group))
    : [...current, { type, count: extra * 3 }];

  return { ...config, generator: { ...config.generator, [kind]: next } };
}

export const MASTER_MODIFIERS: MasterModifier[] = [
  {
    id: 'slow',
    title: 'Мало ходов',
    icon: '⏳',
    note: `Запас ходов сжат: ${Math.round(MASTER_SLACK * 100)} % сверх решения`,
    canApply: () => true,
    apply: (config) => ({ ...config, moveLimit: 'auto', moveSlack: MASTER_SLACK }),
  },
  {
    id: 'no-hints',
    title: 'Без подсказок',
    icon: '🚫',
    note: 'Подсказки недоступны — даже купленные в магазине',
    canApply: () => true,
    apply: (config) => ({ ...config, hints: 0, noHints: true }),
  },
  {
    id: 'ice',
    title: 'Больше льда',
    icon: '🧊',
    note: `На полках ещё ${MASTER_ICE_EXTRA} замороженных товара`,
    canApply: (config) =>
      config.generator.kind === 'scramble' &&
      scrambleCount(config, 'frozen') + MASTER_ICE_EXTRA <= usedTriples(config) * 3,
    apply: (config) =>
      withScrambleCount(config, 'frozen', scrambleCount(config, 'frozen') + MASTER_ICE_EXTRA),
  },
  {
    id: 'locked',
    title: 'Больше блоков',
    icon: '🔒',
    note: `Ещё до ${MASTER_LOCKED_EXTRA} ячеек прибиты гвоздями`,
    canApply: (config) => nextLockedList(config, 1) !== null,
    apply: (config) => {
      let result = config;
      for (let step = 1; step <= MASTER_LOCKED_EXTRA; step += 1) {
        const next = nextLockedList(result, 1);
        if (!next) break;
        if (result.generator.kind !== 'scramble') break;
        result = { ...result, generator: { ...result.generator, locked: next } };
      }
      return result;
    },
  },
  {
    id: 'specials',
    title: 'Больше особых троек',
    icon: '✨',
    note: 'На полках лишние золотые и бомбовые тройки',
    canApply: canAddSpecial,
    apply: (config) => {
      let result = config;
      for (let step = 0; step < MASTER_SPECIAL_EXTRA; step += 1) {
        if (!canAddSpecial(result)) break;
        result = addSpecialTriples(result, step % 2 === 0 ? 'golden' : 'bombs', 1);
      }
      return result;
    },
  },
];

export const MASTER_MODIFIER_BY_ID: Record<MasterModifierId, MasterModifier> = Object.fromEntries(
  MASTER_MODIFIERS.map((modifier) => [modifier.id, modifier]),
) as Record<MasterModifierId, MasterModifier>;

export function masterModifier(id: string): MasterModifier | undefined {
  return MASTER_MODIFIER_BY_ID[id as MasterModifierId];
}

/** Levels that can be replayed in master mode: the whole campaign bar the tutorial. */
export const MASTER_LEVEL_IDS: number[] = Array.from(
  { length: Math.max(0, CAMPAIGN_SIZE - 1) },
  (_, index) => index + 2,
);

const ROTATION: MasterModifierId[] = ['ice', 'locked', 'specials', 'ice', 'specials', 'locked'];

/**
 * Modifiers of a master level: always "fewer moves" and "no hints", plus one or
 * two rotating extras. The set only depends on the level id, so a level always
 * looks the same and can be learned.
 */
export function masterModifiersFor(levelId: number): MasterModifier[] {
  const id = Number.isFinite(levelId) ? Math.floor(levelId) : 1;
  const extras = id >= 24 ? 2 : 1;
  const ids: MasterModifierId[] = ['slow', 'no-hints'];
  const rotation = ROTATION[Math.abs(id) % ROTATION.length] as MasterModifierId;
  const start = ROTATION.indexOf(rotation);

  for (let i = 0; i < extras; i += 1) {
    const next = ROTATION[(start + i) % ROTATION.length] as MasterModifierId;
    if (!ids.includes(next)) ids.push(next);
  }

  return ids.map((modifierId) => MASTER_MODIFIER_BY_ID[modifierId]);
}

export function masterIdFor(levelId: number): number {
  return MASTER_ID_BASE + Math.floor(levelId);
}

export function isMasterLevel(id: number): boolean {
  return Number.isFinite(id) && id >= MASTER_ID_BASE;
}

/** Campaign level behind a master id, or `null` when the id is not a master one. */
export function baseLevelIdFor(masterId: number): number | null {
  if (!isMasterLevel(masterId)) return null;
  const base = Math.floor(masterId) - MASTER_ID_BASE;
  return MASTER_LEVEL_IDS.includes(base) ? base : null;
}

export function masterHasNext(levelId: number): boolean {
  return MASTER_LEVEL_IDS.includes(Math.floor(levelId) + 1);
}

/** The campaign level, rebuilt as a master challenge. */
export function buildMasterLevel(levelId: number): LevelConfig | null {
  const id = Math.floor(levelId);
  if (!MASTER_LEVEL_IDS.includes(id)) return null;
  const base = getLevel(id);
  if (!base) return null;

  const modifiers = masterModifiersFor(id).filter((modifier) => modifier.canApply(base));
  const config = modifiers.reduce((current, modifier) => modifier.apply(current), base);
  const generator =
    config.generator.kind === 'scramble'
      ? { ...config.generator, seed: config.generator.seed + MASTER_SEED_OFFSET }
      : config.generator;

  return {
    ...config,
    id: masterIdFor(id),
    name: `МАСТЕР · ${base.name}`,
    moveLimit: 'auto',
    generator,
    master: { baseId: id, modifiers: modifiers.map((modifier) => modifier.id) },
    tip: `МАСТЕР ${id}: ${modifiers.map((modifier) => modifier.title).join(' · ')}`,
  };
}

/** Master mode opens once the last campaign level is cleared. */
export function masterUnlocked(levelStars: Record<number, number>): boolean {
  return (levelStars[CAMPAIGN_SIZE] ?? 0) >= 1;
}

// ------------------------------------------------------------------ rewards

export function crownsForStars(stars: number): number {
  if (!Number.isFinite(stars)) return 1;
  return Math.max(1, Math.min(3, Math.floor(stars)));
}

export const MASTER_POINTS_BASE = 10;
export const MASTER_POINTS_PER_STAR = 6;
export const MASTER_POINTS_PER_MODIFIER = 5;

/** Points a single master run is worth, before the personal best is applied. */
export function masteryPointsFor(stars: number, modifierCount: number): number {
  const safeStars = Number.isFinite(stars) ? Math.max(0, Math.min(3, Math.floor(stars))) : 0;
  const safeModifiers = Number.isFinite(modifierCount) ? Math.max(0, Math.floor(modifierCount)) : 0;
  return MASTER_POINTS_BASE + safeStars * MASTER_POINTS_PER_STAR + safeModifiers * MASTER_POINTS_PER_MODIFIER;
}

export interface MasteryProgress {
  /** Best crowns (1..3) won on each campaign level. */
  crowns: Record<number, number>;
  /** Best mastery points won on each level — the score never goes down. */
  best: Record<number, number>;
}

export const EMPTY_MASTERY: MasteryProgress = { crowns: {}, best: {} };

export function totalCrowns(mastery: MasteryProgress): number {
  return Object.values(mastery.crowns).reduce((sum, value) => sum + Math.max(0, value), 0);
}

export function masteryTotal(mastery: MasteryProgress): number {
  return Object.values(mastery.best).reduce((sum, value) => sum + Math.max(0, value), 0);
}

export interface MasterRank {
  id: string;
  name: string;
  /** Mastery points needed to reach the rank. */
  from: number;
}

export const MASTER_RANKS: MasterRank[] = [
  { id: 'trainee', name: 'Стажёр', from: 0 },
  { id: 'seller', name: 'Продавец', from: 120 },
  { id: 'senior', name: 'Старший продавец', from: 300 },
  { id: 'manager', name: 'Управляющий', from: 600 },
  { id: 'master', name: 'Мастер полок', from: 1000 },
];

export function masterRank(points: number): MasterRank {
  const value = Number.isFinite(points) ? Math.max(0, points) : 0;
  let current = MASTER_RANKS[0] as MasterRank;
  for (const rank of MASTER_RANKS) if (value >= rank.from) current = rank;
  return current;
}

export function nextMasterRank(points: number): MasterRank | null {
  const current = masterRank(points);
  const index = MASTER_RANKS.findIndex((rank) => rank.id === current.id);
  return MASTER_RANKS[index + 1] ?? null;
}

/** Progress towards the next rank, 0..1 (1 for the top rank). */
export function masterRankProgress(points: number): number {
  const current = masterRank(points);
  const next = nextMasterRank(points);
  if (!next) return 1;
  const span = next.from - current.from;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (points - current.from) / span));
}

export interface MasterAward {
  levelId: number;
  /** Crowns won by this run (1..3). */
  crowns: number;
  /** Crowns the player already had on this level. */
  previousCrowns: number;
  /** Points this run is worth. */
  points: number;
  /** Points actually added (0 when the old result was already better). */
  gained: number;
  /** Best points on this level after the run. */
  best: number;
  /** Total mastery points after the run. */
  total: number;
  /** Rank name after the run. */
  rank: string;
  /** Rank name when the run promoted the player, otherwise `null`. */
  rankUp: string | null;
}

/** Applies a won master run: crowns only grow, points only grow. */
export function awardMastery(
  mastery: MasteryProgress,
  levelId: number,
  stars: number,
  modifierCount: number,
): { mastery: MasteryProgress; award: MasterAward } {
  const id = Math.floor(levelId);
  const crowns = crownsForStars(stars);
  const points = masteryPointsFor(stars, modifierCount);
  const previousCrowns = Math.max(0, Math.floor(mastery.crowns[id] ?? 0));
  const previousBest = Math.max(0, Math.floor(mastery.best[id] ?? 0));
  const best = Math.max(previousBest, points);

  const next: MasteryProgress = {
    crowns: { ...mastery.crowns, [id]: Math.max(previousCrowns, crowns) },
    best: { ...mastery.best, [id]: best },
  };

  const before = masteryTotal(mastery);
  const total = masteryTotal(next);
  const rankBefore = masterRank(before);
  const rankAfter = masterRank(total);

  return {
    mastery: next,
    award: {
      levelId: id,
      crowns,
      previousCrowns,
      points,
      gained: total - before,
      best,
      total,
      rank: rankAfter.name,
      rankUp: rankAfter.id === rankBefore.id ? null : rankAfter.name,
    },
  };
}
