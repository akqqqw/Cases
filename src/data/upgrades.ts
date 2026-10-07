import { EMPTY_BONUS, type ShopBonus } from './shop';
import { emptyBoosters, type BoosterId, type BoosterInventory } from '../core/boosters';

/**
 * Shop development: every department can be levelled up with coins. Each level
 * pays a permanent bonus (moves, hints, undos, coin percentage) and every fifth
 * level hands over a booster. Spending coins here is what turns the shop from a
 * one-off purchase into a long-term goal.
 *
 * The whole system is data: a new department or a new level is one entry in the
 * tables below, the game reads them through `upgradeBonus` / `nextUpgrade`.
 */
export interface UpgradeStep {
  /** Coins needed for this level. */
  cost: number;
  bonus?: ShopBonus;
  /** Boosters granted once when the level is bought. */
  boosters?: Partial<BoosterInventory>;
  /** Human readable reward, shown on the shop card. */
  label: string;
}

export interface UpgradeTrack {
  /** Id of the department this track belongs to (`ShopItem.id`). */
  id: string;
  name: string;
  icon: string;
  /** Short description of what the track improves. */
  focus: string;
  steps: UpgradeStep[];
}

const step = (cost: number, label: string, bonus?: ShopBonus, boosters?: Partial<BoosterInventory>): UpgradeStep => ({
  cost,
  label,
  ...(bonus ? { bonus } : {}),
  ...(boosters ? { boosters } : {}),
});

export const UPGRADE_TRACKS: UpgradeTrack[] = [
  {
    id: 'dept-sweets',
    name: 'Отдел «Сладкое»',
    icon: 'cake',
    focus: 'Подсказки и монеты',
    steps: [
      step(70, '+1 подсказка', { bonusHints: 1 }),
      step(110, '+5 % монет', { coinBonus: 0.05 }),
      step(150, '+1 подсказка', { bonusHints: 1 }),
      step(210, '+5 % монет', { coinBonus: 0.05 }),
      step(290, '+1 перемешивание', undefined, { shuffle: 1 }),
    ],
  },
  {
    id: 'dept-books',
    name: 'Отдел «Книги»',
    icon: 'book',
    focus: 'Отмены и монеты',
    steps: [
      step(80, '+1 отмена', { bonusUndos: 1 }),
      step(125, '+5 % монет', { coinBonus: 0.05 }),
      step(175, '+1 отмена', { bonusUndos: 1 }),
      step(240, '+5 % монет', { coinBonus: 0.05 }),
      step(330, '+1 бесплатная отмена', undefined, { undo: 1 }),
    ],
  },
  {
    id: 'dept-toys',
    name: 'Отдел «Игрушки»',
    icon: 'robot',
    focus: 'Стартовые ходы',
    steps: [
      step(90, '+1 ход', { bonusMoves: 1 }),
      step(140, '+1 ход', { bonusMoves: 1 }),
      step(200, '+5 % монет', { coinBonus: 0.05 }),
      step(270, '+5 % монет', { coinBonus: 0.05 }),
      step(370, '+3 хода', undefined, { extraMove: 1 }),
    ],
  },
  {
    id: 'dept-tech',
    name: 'Отдел «Техника»',
    icon: 'phone',
    focus: 'Монеты и ходы',
    steps: [
      step(105, '+5 % монет', { coinBonus: 0.05 }),
      step(155, '+1 ход', { bonusMoves: 1 }),
      step(220, '+5 % монет', { coinBonus: 0.05 }),
      step(300, '+5 % монет', { coinBonus: 0.05 }),
      step(410, '+1 молоток', undefined, { hammer: 1 }),
    ],
  },
  {
    id: 'dept-flowers',
    name: 'Отдел «Цветы»',
    icon: 'flower',
    focus: 'Подсказки и отмены',
    steps: [
      step(115, '+1 подсказка', { bonusHints: 1 }),
      step(175, '+1 отмена', { bonusUndos: 1 }),
      step(245, '+5 % монет', { coinBonus: 0.05 }),
      step(340, '+10 % монет', { coinBonus: 0.1 }),
      step(460, '+1 бесплатная отмена', undefined, { undo: 1 }),
    ],
  },
  {
    id: 'dept-beauty',
    name: 'Отдел «Красота»',
    icon: 'perfume',
    focus: 'Монеты и ходы',
    steps: [
      step(125, '+5 % монет', { coinBonus: 0.05 }),
      step(190, '+5 % монет', { coinBonus: 0.05 }),
      step(275, '+10 % монет', { coinBonus: 0.1 }),
      step(380, '+10 % монет', { coinBonus: 0.1 }),
      step(500, '+3 хода', undefined, { extraMove: 1 }),
    ],
  },
];

export const UPGRADE_BY_ID: Record<string, UpgradeTrack> = Object.fromEntries(
  UPGRADE_TRACKS.map((track) => [track.id, track]),
);

export const MAX_UPGRADE_LEVEL = Math.max(...UPGRADE_TRACKS.map((track) => track.steps.length));

/** Levels bought per department id. */
export type UpgradeLevels = Record<string, number>;

export function trackFor(id: string): UpgradeTrack | undefined {
  return UPGRADE_BY_ID[id];
}

export function upgradeLevel(levels: UpgradeLevels, trackId: string): number {
  const value = Number(levels[trackId]);
  const max = trackFor(trackId)?.steps.length ?? 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(max, Math.floor(value));
}

export function isMaxed(levels: UpgradeLevels, trackId: string): boolean {
  const track = trackFor(trackId);
  if (!track) return false;
  return upgradeLevel(levels, trackId) >= track.steps.length;
}

export interface NextUpgrade {
  level: number;
  step: UpgradeStep;
}

/** The next level of a track, or `null` when it is fully upgraded. */
export function nextUpgrade(levels: UpgradeLevels, trackId: string): NextUpgrade | null {
  const track = trackFor(trackId);
  if (!track) return null;
  const current = upgradeLevel(levels, trackId);
  const next = track.steps[current];
  return next ? { level: current + 1, step: next } : null;
}

/** Sum of every bonus bought so far, ready to be applied to a level. */
export function upgradeBonus(levels: UpgradeLevels): Required<ShopBonus> {
  const total = { ...EMPTY_BONUS };

  for (const track of UPGRADE_TRACKS) {
    const bought = upgradeLevel(levels, track.id);
    for (let index = 0; index < bought; index += 1) {
      const bonus = track.steps[index]?.bonus;
      if (!bonus) continue;
      total.bonusMoves += bonus.bonusMoves ?? 0;
      total.bonusHints += bonus.bonusHints ?? 0;
      total.bonusUndos += bonus.bonusUndos ?? 0;
      total.coinBonus += bonus.coinBonus ?? 0;
    }
  }

  return total;
}

/** Boosters that a purchase of this exact level hands over. */
export function upgradeBoosterGrant(trackId: string, level: number): BoosterInventory {
  const granted = emptyBoosters();
  const reward = trackFor(trackId)?.steps[level - 1]?.boosters;
  if (!reward) return granted;

  for (const [id, count] of Object.entries(reward) as Array<[BoosterId, number]>) {
    granted[id] = Math.max(0, Math.floor(count));
  }
  return granted;
}

export function totalUpgradeLevels(levels: UpgradeLevels): number {
  return UPGRADE_TRACKS.reduce((sum, track) => sum + upgradeLevel(levels, track.id), 0);
}

/** Cost of one complete track (all levels of one department). */
export function trackCost(trackId: string): number {
  return (trackFor(trackId)?.steps ?? []).reduce((sum, entry) => sum + entry.cost, 0);
}

/** Coins needed to develop every department to the maximum. */
export function totalUpgradeCost(): number {
  return UPGRADE_TRACKS.reduce((sum, track) => sum + trackCost(track.id), 0);
}

export interface ShopTier {
  index: number;
  id: string;
  name: string;
  /** Total department levels needed to reach this tier. */
  from: number;
  /** Total levels of the next tier (`null` for the last one). */
  to: number | null;
  /** Short flavour line for the shop banner. */
  note: string;
}

/** The shop itself grows: the more departments are developed, the fancier it looks. */
export const SHOP_TIERS: ShopTier[] = [
  { index: 1, id: 'stall', name: 'Лавка', from: 0, to: 4, note: 'Уютный уголок с полками' },
  { index: 2, id: 'store', name: 'Магазин', from: 4, to: 10, note: 'Витрины и вывеска' },
  { index: 3, id: 'mall', name: 'Универмаг', from: 10, to: 17, note: 'Просторный зал с отделами' },
  { index: 4, id: 'arcade', name: 'Пассаж', from: 17, to: 24, note: 'Стеклянные галереи и свет' },
  { index: 5, id: 'gallery', name: 'Галерея', from: 24, to: null, note: 'Флагманский магазин города' },
];

export function shopTier(totalLevels: number): ShopTier {
  const level = Math.max(0, Math.floor(totalLevels));
  let current = SHOP_TIERS[0] as ShopTier;
  for (const tier of SHOP_TIERS) {
    if (level >= tier.from) current = tier;
  }
  return current;
}

export function nextTier(totalLevels: number): ShopTier | null {
  const current = shopTier(totalLevels);
  const index = SHOP_TIERS.findIndex((tier) => tier.id === current.id);
  return SHOP_TIERS[index + 1] ?? null;
}

/** Progress towards the next tier, 0..1 (1 for the final tier). */
export function tierProgress(totalLevels: number): number {
  const current = shopTier(totalLevels);
  const next = nextTier(totalLevels);
  if (!next || next.to === null) return 1;
  const span = (current.to ?? next.from) - current.from;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (totalLevels - current.from) / span));
}

/** Booster ids that can be bought one by one in the shop, with their price. */
export const BOOSTER_PRICES: Record<BoosterId, number> = {
  hammer: 70,
  shuffle: 60,
  extraMove: 90,
  undo: 50,
};

export function boosterPrice(id: BoosterId): number {
  return BOOSTER_PRICES[id];
}
