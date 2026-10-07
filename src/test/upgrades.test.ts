import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOOSTER_PRICES,
  MAX_UPGRADE_LEVEL,
  SHOP_TIERS,
  UPGRADE_TRACKS,
  boosterPrice,
  isMaxed,
  nextTier,
  nextUpgrade,
  shopTier,
  tierProgress,
  totalUpgradeCost,
  totalUpgradeLevels,
  trackCost,
  upgradeBonus,
  upgradeBoosterGrant,
  upgradeLevel,
} from '../data/upgrades';
import { BOOSTER_IDS } from '../core/boosters';
import { SHOP_ITEMS, totalShopPrice } from '../data/shop';
import { LEVELS } from '../data/levels';
import { coinsForLevel } from '../data/levels/campaign';
import { migrateUpgrades } from '../store/persistence';
import { progressShopTier, progressUpgradeLevel, useGameStore } from '../store/gameStore';
import { createLevelRuntime } from '../game/levelRuntime';

const departments = SHOP_ITEMS.filter((item) => item.kind === 'department');

describe('development tracks', () => {
  it('has one track per department, with the same ids and names', () => {
    expect(UPGRADE_TRACKS).toHaveLength(departments.length);
    for (const track of UPGRADE_TRACKS) {
      const department = departments.find((item) => item.id === track.id);
      expect(department, `department ${track.id} exists`).toBeTruthy();
      expect(track.name).toBe(department!.name);
      expect(track.icon).toBe(department!.icon);
    }
    expect(new Set(UPGRADE_TRACKS.map((track) => track.id)).size).toBe(UPGRADE_TRACKS.length);
  });

  it('has the same number of levels everywhere', () => {
    for (const track of UPGRADE_TRACKS) {
      expect(track.steps).toHaveLength(MAX_UPGRADE_LEVEL);
      expect(track.focus.length).toBeGreaterThan(0);

      let previous = 0;
      for (const entry of track.steps) {
        expect(entry.cost).toBeGreaterThan(previous); // prices grow with the level
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.bonus || entry.boosters, `${track.id} level pays something`).toBeTruthy();
        previous = entry.cost;
      }
    }
  });

  it('pays the requested kinds of bonus: moves, hints, undos and coin share', () => {
    const full = Object.fromEntries(UPGRADE_TRACKS.map((track) => [track.id, MAX_UPGRADE_LEVEL]));
    const bonus = upgradeBonus(full);

    expect(bonus.bonusMoves).toBeGreaterThan(0); // + стартовые ходы
    expect(bonus.bonusHints).toBeGreaterThan(0); // + подсказки
    expect(bonus.bonusUndos).toBeGreaterThan(0); // + отмены
    expect(bonus.coinBonus).toBeGreaterThan(0); // + % монет
    // the endgame power curve stays sane
    expect(bonus.bonusMoves).toBeLessThanOrEqual(6);
    expect(bonus.bonusHints).toBeLessThanOrEqual(6);
    expect(bonus.bonusUndos).toBeLessThanOrEqual(6);
    expect(bonus.coinBonus).toBeLessThanOrEqual(1);
  });

  it('hands over a booster on the last level of every track', () => {
    for (const track of UPGRADE_TRACKS) {
      const granted = upgradeBoosterGrant(track.id, MAX_UPGRADE_LEVEL);
      const total = BOOSTER_IDS.reduce((sum, id) => sum + granted[id], 0);
      expect(total, `${track.id} gives a booster at max level`).toBeGreaterThan(0);
      // and nothing before it
      expect(BOOSTER_IDS.reduce((sum, id) => sum + upgradeBoosterGrant(track.id, MAX_UPGRADE_LEVEL - 1)[id], 0)).toBe(0);
    }
  });

  it('counts only bought levels', () => {
    const levels = { 'dept-sweets': 3, 'dept-books': 99, 'dept-unknown': 5 };

    expect(upgradeLevel(levels, 'dept-sweets')).toBe(3);
    expect(upgradeLevel(levels, 'dept-books')).toBe(MAX_UPGRADE_LEVEL); // clamped
    expect(upgradeLevel(levels, 'dept-unknown')).toBe(0);
    expect(upgradeLevel({}, 'dept-sweets')).toBe(0);

    expect(totalUpgradeLevels(levels)).toBe(3 + MAX_UPGRADE_LEVEL);
    expect(isMaxed(levels, 'dept-books')).toBe(true);
    expect(isMaxed(levels, 'dept-sweets')).toBe(false);

    const bonus = upgradeBonus(levels);
    expect(bonus.bonusHints).toBe(2); // sweet levels 1 and 3
  });

  it('offers the next level until the track ends', () => {
    expect(nextUpgrade({}, 'dept-sweets')?.level).toBe(1);
    expect(nextUpgrade({ 'dept-sweets': 1 }, 'dept-sweets')?.level).toBe(2);
    expect(nextUpgrade({ 'dept-sweets': MAX_UPGRADE_LEVEL }, 'dept-sweets')).toBeNull();
    expect(nextUpgrade({}, 'nope')).toBeNull();
  });

  it('prices the whole development sensibly against the campaign economy', () => {
    const earned = LEVELS.reduce((sum, level) => sum + (level.coins ?? coinsForLevel(level.id)), 0);
    // a good run (three stars, clean play, spare moves) adds ~50 coins per level
    const goodRun = LEVELS.reduce((sum, level) => sum + (level.coins ?? coinsForLevel(level.id)) + 50, 0);

    // finishing the campaign pays for the whole catalogue
    expect(earned).toBeGreaterThan(totalShopPrice() * 1.3);
    // and a good run covers the shop plus almost all of the development
    expect(goodRun).toBeGreaterThan((totalShopPrice() + totalUpgradeCost()) * 0.85);
    // full development stays a long term goal (daily tasks fill the rest)
    expect(totalUpgradeCost()).toBeGreaterThan(totalShopPrice());

    for (const track of UPGRADE_TRACKS) {
      expect(trackCost(track.id)).toBe(track.steps.reduce((sum, entry) => sum + entry.cost, 0));
    }
  });
});

describe('the shop grows with its departments', () => {
  it('walks through the tiers as levels are bought', () => {
    expect(shopTier(0).name).toBe('Лавка');
    expect(shopTier(3).name).toBe('Лавка');
    expect(shopTier(4).name).toBe('Магазин');
    expect(shopTier(10).name).toBe('Универмаг');
    expect(shopTier(17).name).toBe('Пассаж');
    expect(shopTier(24).name).toBe('Галерея');
    expect(shopTier(999).name).toBe('Галерея');
  });

  it('knows the next tier and how far it is', () => {
    const next = nextTier(0);
    expect(next?.name).toBe('Магазин');
    expect(nextTier(MAX_UPGRADE_LEVEL * UPGRADE_TRACKS.length)).toBeNull();

    expect(tierProgress(0)).toBe(0);
    expect(tierProgress(2)).toBeCloseTo(0.5, 5);
    // reaching a tier restarts the bar towards the following one
    expect(tierProgress(4)).toBe(0);
    expect(tierProgress(7)).toBeCloseTo(0.5, 5);
    expect(tierProgress(999)).toBe(1);
  });

  it('keeps the tier table ordered and complete', () => {
    expect(SHOP_TIERS).toHaveLength(5);
    SHOP_TIERS.forEach((tier, index) => {
      expect(tier.index).toBe(index + 1);
      if (index > 0) expect(tier.from).toBe(SHOP_TIERS[index - 1]!.to);
      expect(tier.note.length).toBeGreaterThan(0);
    });
  });
});

describe('booster prices', () => {
  it('prices every booster and keeps them below the cheapest department', () => {
    const cheapest = Math.min(...departments.map((department) => department.price));
    for (const id of BOOSTER_IDS) {
      expect(boosterPrice(id)).toBe(BOOSTER_PRICES[id]);
      expect(boosterPrice(id)).toBeGreaterThan(0);
      expect(boosterPrice(id)).toBeLessThan(cheapest);
    }
  });
});

describe('development migration', () => {
  it('drops unknown departments and clamps levels', () => {
    expect(migrateUpgrades(undefined)).toEqual({});
    expect(migrateUpgrades('nonsense')).toEqual({});
    expect(
      migrateUpgrades({ 'dept-sweets': 2, 'dept-books': 99, 'dept-ghost': 4, 'dept-toys': -1 }),
    ).toEqual({ 'dept-sweets': 2, 'dept-books': MAX_UPGRADE_LEVEL });
  });
});

describe('development through the store', () => {
  beforeEach(() => {
    useGameStore.setState({
      phase: 'menu',
      runtime: null,
      outcome: null,
      toast: null,
      hydrated: true,
      progress: {
        coins: 1000,
        levelStars: {},
        unlockedLevel: 40,
        owned: ['decor-cozy', 'dept-sweets', 'dept-toys'],
        activeDecor: 'decor-cozy',
        dailyStreak: { days: 0, lastDay: '' },
      lastSeenDay: '',
        boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 },
        upgrades: {},
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: '', coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
      },
    });
  });

  it('spends coins and raises the level', () => {
    const before = useGameStore.getState().progress.coins;
    const price = nextUpgrade({}, 'dept-sweets')!.step.cost;

    expect(useGameStore.getState().upgradeDepartment('dept-sweets')).toBe(true);
    const state = useGameStore.getState();
    expect(state.progress.upgrades['dept-sweets']).toBe(1);
    expect(state.progress.coins).toBe(before - price);
    expect(state.toast?.text).toContain('+1 подсказка');
  });

  it('develops the department bonus into the next level', () => {
    // the «Сладкое» department itself gives +1 подсказка, level 1 gives one more
    useGameStore.getState().upgradeDepartment('dept-sweets');
    useGameStore.getState().startLevel(1);
    const runtime = useGameStore.getState().runtime!;
    expect(runtime.hintsLeft).toBe((runtime.config.hints ?? 3) + 2);
    useGameStore.getState().exitToMenu();

    // the «Игрушки» department is already owned (+2 хода): its level 1 adds one more
    const beforeMoves = runtime.moveLimit;
    useGameStore.getState().upgradeDepartment('dept-toys');
    useGameStore.getState().startLevel(1);
    const withMoves = useGameStore.getState().runtime!;
    expect(withMoves.moveLimit).toBe(beforeMoves + 1);
  });

  it('refuses to develop what was not bought, or without coins', () => {
    expect(useGameStore.getState().upgradeDepartment('dept-books')).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(1000);
    expect(useGameStore.getState().toast?.text).toContain('Сначала купите');

    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 10 } });
    expect(useGameStore.getState().upgradeDepartment('dept-sweets')).toBe(false);
    expect(useGameStore.getState().toast?.text).toContain('монет');
  });

  it('stops at the maximum level and hands the booster over once', () => {
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 100_000 } });

    for (let i = 0; i < MAX_UPGRADE_LEVEL; i += 1) {
      expect(useGameStore.getState().upgradeDepartment('dept-sweets')).toBe(true);
    }

    expect(isMaxed(useGameStore.getState().progress.upgrades, 'dept-sweets')).toBe(true);
    expect(useGameStore.getState().progress.boosters.shuffle).toBe(1);
    expect(useGameStore.getState().upgradeDepartment('dept-sweets')).toBe(false);
    expect(useGameStore.getState().toast?.text).toContain('максимум');
    expect(useGameStore.getState().progress.boosters.shuffle).toBe(1);
  });

  it('buys single boosters with coins', () => {
    expect(useGameStore.getState().buyBooster('hammer')).toBe(true);
    expect(useGameStore.getState().progress.boosters.hammer).toBe(1);
    expect(useGameStore.getState().progress.coins).toBe(1000 - boosterPrice('hammer'));

    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 0 } });
    expect(useGameStore.getState().buyBooster('hammer')).toBe(false);
  });

  it('stacks development bonuses on top of the shop bonuses', () => {
    useGameStore.getState().upgradeDepartment('dept-toys');
    useGameStore.getState().startLevel(1);
    const runtime = useGameStore.getState().runtime!;

    // department (+2 хода from the catalogue) + development level (+1 ход)
    const plain = createLevelRuntime(LEVELS[0]!);
    expect(runtime.moveLimit).toBe(plain.moveLimit + 3);
  });

  it('exposes helpers for the shop screen', () => {
    useGameStore.getState().upgradeDepartment('dept-sweets');
    const progress = useGameStore.getState().progress;

    expect(progressUpgradeLevel(progress, 'dept-sweets')).toBe(1);
    expect(progressShopTier(progress).index).toBe(1);
  });
});
