import { create } from 'zustand';
import { COMBO_START, comboLabel } from '../core/combo';
import {
  BOOSTERS,
  EXTRA_MOVES,
  boosterCount,
  hasBooster,
  spendBooster,
  starterBoosters,
  type BoosterId,
  type BoosterInventory,
} from '../core/boosters';
import { createRng } from '../core/rng';
import { BOOSTER_IDS, grantBooster } from '../core/boosters';
import {
  UPGRADE_BY_ID,
  boosterPrice,
  isMaxed,
  nextUpgrade,
  shopTier,
  totalUpgradeLevels,
  upgradeBonus,
  upgradeBoosterGrant,
  upgradeLevel,
  type UpgradeLevels,
} from '../data/upgrades';
import {
  EMPTY_MASTERY,
  awardMastery,
  baseLevelIdFor,
  buildMasterLevel,
  isMasterLevel,
  masterHasNext,
  masterUnlocked,
  type MasterAward,
  type MasteryProgress,
} from '../data/master';
import { goalProductTypes } from '../core/goal';
import type { BlastGroup } from '../core/types';
import {
  EMPTY_STREAK,
  advanceStreak,
  formatCountdown,
  pickDailyTasks,
  streakBonus,
  type DailyMetric,
  type DailyStreak,
  type DailyTaskDef,
} from '../data/dailies';
import { currentDayKey, msUntilTomorrow, resolveDay } from '../data/clock';
import {
  EMPTY_EVENT_STATE,
  ensureEventState,
  eventDeltas,
  eventFinaleReady,
  eventForDay,
  emptyEventState,
  type EventProgressState,
  type EventTick,
} from '../data/events';
import { GIFT_CYCLE_DAYS, giftCalendar } from '../data/gift';
import { bumpWeek, type WeekProgress } from '../data/weeks';
import { findHint, type Hint } from '../core/solver';
import { getLevel, nextLevelId } from '../data/levels';
import type { LevelConfig } from '../data/levels/types';
import { toggleFullscreen as requestFullscreen, type PlatformKind, type SdkStatus } from '../platform/yandex';
import { t, type Lang, type LangSource } from '../platform/i18n';
import {
  currentScores,
  connectLeaderboards,
  emptyLeaderboardStatus,
  initLeaderboards,
  loadBoard,
  publishScores,
  subscribeLeaderboards,
  type BoardId,
  type LeaderboardStatus,
} from '../platform/leaderboards';
import {
  EMPTY_ADS_STATUS,
  connectAds,
  flagCoinReward,
  flagCoinsPerDay,
  interstitialReady,
  noteLevelFinished,
  showInterstitial,
  showRewarded,
  subscribeAds,
  syncBannerForPhase,
  type AdsStatus,
} from '../platform/ads';
import {
  EMPTY_CLOUD_STATUS,
  authorizeCloud,
  flushCloud,
  initCloud,
  noteLocalChange,
  subscribeCloud,
  syncCloudNow,
  type CloudStatus,
} from '../platform/cloud';
import {
  emptyFlagsStatus,
  initFlags,
  flagNumber,
  subscribeFlags,
  type FlagsStatus,
} from '../platform/flags';
import {
  buyProduct as requestPurchase,
  connectPurchases,
  loadCatalog as loadPurchaseCatalog,
  payingFeature,
  productDef,
  emptyPurchasesStatus,
  initPurchases,
  ownedBeforeSession,
  NO_ADS_PRODUCT,
  purchasesStatus,
  subscribePurchases,
  type PurchaseReward,
  type PurchasesStatus,
} from '../platform/purchases';
import { now } from '../data/clock';
import { audio } from '../game/audio';
import {
  FREE_DECOR_ID,
  ownedBonus,
  ownedItemTypes,
  shopItem,
  type ShopItem,
} from '../data/shop';
import {
  createLevelRuntime,
  levelOutcome,
  playMove,
  reviveRuntime,
  spendHint,
  undoMove,
  useExtraMoves,
  useFreeUndo,
  useHammer,
  useShuffle,
  type LevelOutcome,
  type LevelRuntime,
} from '../game/levelRuntime';
import {
  createSaveQueue,
  clearState,
  setWipeMarker,
  EMPTY_AD_REWARD,
  type AdRewardState,
  type PersistedState,
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  loadState,
  SAVE_VERSION,
} from './persistence';

export type Phase = 'menu' | 'playing' | 'paused' | 'won' | 'lost';

export interface Settings {
  sound: boolean;
  music: boolean;
  volume: number;
}

export interface Progress {
  /** Stars earned per level id. */
  levelStars: Record<number, number>;
  coins: number;
  /** Highest unlocked level id. */
  unlockedLevel: number;
  /** Purchased shop items (departments, sets, interior presets). */
  owned: string[];
  /** Interior preset currently used by the shelf renderer. */
  activeDecor: string;
  /** Days in a row with at least one collected daily reward. */
  dailyStreak: DailyStreak;
  /**
   * Latest day the game has seen, `YYYY-MM-DD`. Keeps the daily calendar
   * monotonic: moving the device clock back cannot reopen a day that is
   * already played (see `resolveDay`).
   */
  lastSeenDay: string;
  /** Booster inventory (hammers, shuffles, extra moves, free undos). */
  boosters: BoosterInventory;
  /** Bought development levels per department. */
  upgrades: UpgradeLevels;
  /** Master mode: crowns and best mastery points per campaign level. */
  mastery: MasteryProgress;
  /** Ids of the events whose finale was collected (kept as history). */
  eventWins: string[];
  /** Rewarded videos collected today (guards the ad economy, resets daily). */
  adReward: AdRewardState;
  /** Weekly stars and their record — the «лучший результат недели» board. */
  weeks: WeekProgress;
}



/** Counters and claims of the current day's tasks. */
export interface DailyState {
  /** Day the counters belong to, `YYYY-MM-DD`. */
  date: string;
  counts: Record<DailyMetric, number>;
  /** Ids of the tasks whose reward was already collected. */
  claimed: string[];
}

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

/**
 * Everything the game knows about the platform it runs on. Filled by
 * `platform/boot.ts`; on a plain browser it stays `web` / `unavailable`.
 */
export interface PlatformState {
  kind: PlatformKind;
  status: SdkStatus;
  /** Interface language, detected while booting. */
  lang: Lang;
  langSource: LangSource;
  fullscreen: boolean;
  /** `true` while the game runs on the trusted server time. */
  trustedTime: boolean;
  /** `true` while the platform holds the game (ads, purchase, tab switch). */
  paused: boolean;
  /** Phase to return to after the platform resumes — set while paused. */
  resumePhase: Phase | null;
}

export const DEFAULT_PLATFORM: PlatformState = {
  kind: 'web',
  status: 'idle',
  lang: 'ru',
  langSource: 'default',
  fullscreen: false,
  trustedTime: false,
  paused: false,
  resumePhase: null,
};

export interface GameStore {
  phase: Phase;
  hydrated: boolean;
  runtime: LevelRuntime | null;
  /** Set when a move/undo/restart changed the board — the scene animates it. */
  boardRevision: number;
  lastMove: {
    from: number;
    to: number;
    clearedCount: number;
    golden: boolean;
    /** Cells blown away by a bomb triple (already cleared from the board). */
    blast: BlastGroup | null;
    /** Combo run after this move (0 when the run was broken). */
    combo: number;
    /** Coins the move paid for the combo. */
    comboCoins: number;
  } | null;
  hint: Hint | null;
  outcome: LevelOutcome | null;
  toast: Toast | null;
  progress: Progress;
  settings: Settings;
  daily: DailyState;
  /** Counters and claims of the running event (empty when no event is active). */
  events: EventProgressState;
  /** Platform session: Yandex Games or a plain browser (see `platform/`). */
  platform: PlatformState;
  /** Cloud saves of the Yandex player (see `platform/cloud.ts`). */
  cloud: CloudStatus;
  /** Advertising: availability, banner and the last event (see `platform/ads.ts`). */
  ads: AdsStatus;
  /** Yandex Games leaderboards: three tables and what was sent (stage 10). */
  leaderboard: LeaderboardStatus;
  /** Remote configuration: limits and experiment values (Console «Флаги»). */
  flags: FlagsStatus;
  /** In-app purchases: the catalog of the Console and what is owned. */
  purchases: PurchasesStatus;
  /** The level was already revived with a video — one revive per attempt. */
  reviveUsed: boolean;
  /** The reward of this win was already doubled with a video — once per run. */
  rewardDoubled: boolean;
  /** Booster waiting for the player to point at a product (the hammer). */
  boosterMode: BoosterId | null;
  /** Set when a booster changed the board — the scene plays its effect. */
  lastBooster: { id: BoosterId; index: number; revision: number } | null;

  hydrate: () => Promise<void>;
  claimDaily: (taskId: string) => boolean;
  /** Collects the gift of the day; `false` when it was already collected. */
  claimDailyGift: () => boolean;
  startLevel: (id: number) => void;
  /** Starts the master variant of a campaign level (endgame). */
  startMasterLevel: (levelId: number) => void;
  restartLevel: () => void;
  requestMove: (from: number, to: number) => boolean;
  requestHint: () => boolean;
  requestUndo: () => boolean;
  pause: () => void;
  resume: () => void;
  togglePause: () => void;
  exitToMenu: () => void;
  playNextLevel: () => void;
  replayCurrentLevel: () => void;
  purchase: (itemId: string) => boolean;
  setActiveDecor: (itemId: string) => boolean;
  isOwned: (itemId: string) => boolean;
  dailyTasks: () => DailyTaskDef[];
  /** Collects the reward of a finished event task. */
  claimEventTask: (taskId: string) => boolean;
  /** Collects the finale prize once every event task is done. */
  claimEventFinale: () => boolean;
  armBooster: (id: BoosterId) => boolean;
  cancelBooster: () => void;
  useBooster: (id: BoosterId, index?: number) => boolean;
  /** Develops a department: spends coins, raises its level, pays the bonus. */
  upgradeDepartment: (trackId: string) => boolean;
  /** Buys a single booster with coins. */
  buyBooster: (id: BoosterId) => boolean;
  dismissToast: () => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPlatform: (patch: Partial<PlatformState>) => void;
  /** Rewarded video on the lose screen: +3 moves and the level continues. */
  reviveWithAd: () => void;
  /** Rewarded video in the shop: coins (up to three per day). */
  watchAdForCoins: () => void;
  /** Rewarded video in the shop: a random booster (once a day). */
  watchAdForBooster: () => void;
  /** «Дальше» on the win screen: an interstitial at a logical pause, then the
   * next level (the ad is skipped when the frequency gate says no). */
  nextLevelAfterAd: () => void;
  /** «Сыграть заново»: same, but the level restarts. */
  replayAfterAd: () => void;
  /** Loads one leaderboard table (cached; `force` refreshes it by hand). */
  loadLeaderboard: (id: BoardId, force?: boolean) => void;
  /** Sends the improved scores to the platform (no-op for guests). */
  publishLeaderboards: () => void;
  /** Publishes and then re-reads one table by hand (the «Обновить» button and
   * the moment right after a login, when the player's place can change). */
  refreshLeaderboards: (id: BoardId) => void;
  /** The player's own values of the three tables (for the rating screen). */
  scores: () => Record<BoardId, number>;
  /** Manual «Синхронизировать»: reads the cloud and applies the newer save. */
  syncCloud: () => void;
  /** Opens the Yandex authorization dialog and syncs afterwards. */
  authorizeCloud: () => void;
  /** Buy a product of the Console (opens the platform payment window). */
  buyProduct: (id: string) => void;
  /** Re-reads the catalog of the Console (the shop does it on open). */
  refreshPurchases: () => void;
  /** Rewarded video on the win panel: doubles the coins of this run. */
  doubleRewardWithAd: () => void;
  /** The platform paused the game (ads, a purchase window, a minimized tab). */
  platformPause: () => void;
  /** The platform gave the game back — restore the phase it was paused in. */
  platformResume: () => void;
  toggleFullscreen: () => void;
  resetProgress: () => Promise<void>;
}

/** Rewards for a watched video. The coins are paid three times a day, the
 * booster once — the ad network can serve rewarded video as often as it wants,
 * but the game economy must not be flooded. */
export const AD_COINS_REWARD = 60;
export const AD_COINS_PER_DAY = 3;
export const AD_BOOSTERS_PER_DAY = 1;

/**
 * The same two numbers, but read from the remote configuration: an experiment
 * may pay more or less for a video without a new build. The constants above are
 * what `localFlags` ships with, so the defaults never drift apart.
 */
export function adCoinReward(): number {
  return flagCoinReward();
}

export function adCoinsPerDay(): number {
  return flagCoinsPerDay();
}

let toastCounter = 0;

/** Today's quota of the rewarded-video prizes. */
export function adRewardToday(progress: Progress, day = currentDayKey()): AdRewardState {
  const reward = progress.adReward;
  return reward.day === day ? reward : { ...EMPTY_AD_REWARD, day };
}

function emptyDaily(date = currentDayKey()): DailyState {
  return { date, counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 }, claimed: [] };
}

/** Rolls the counters over at midnight. */
function ensureToday(daily: DailyState, date = currentDayKey()): DailyState {
  return daily.date === date ? daily : emptyDaily(date);
}

/**
 * The day the game plays in: the saved day wins over a device clock that was
 * moved backwards, so events (like dailies and the gift) cannot be reopened.
 */
function currentDay(progress: Progress): string {
  return resolveDay(progress.lastSeenDay, currentDayKey());
}

/** Event counters of the current move, following the metric table in data. */
function bumpEvent(events: EventProgressState, tick: EventTick, day: string): EventProgressState {
  const current = ensureEventState(events, day);
  if (current.id === '') return current;

  const deltas = eventDeltas(tick);
  const counts = { ...current.counts };
  for (const [metric, value] of Object.entries(deltas)) {
    if (!value) continue;
    counts[metric] = (counts[metric] ?? 0) + value;
  }
  return { ...current, counts, day };
}

function bumpDaily(daily: DailyState, delta: Partial<Record<DailyMetric, number>>): DailyState {
  const current = ensureToday(daily);
  const counts = { ...current.counts };
  for (const [metric, value] of Object.entries(delta) as Array<[DailyMetric, number]>) {
    if (!value) continue;
    counts[metric] = (counts[metric] ?? 0) + value;
  }
  return { ...current, counts };
}

/**
 * Coins of a finished run. The multiplier comes from the remote configuration
 * (`coins_multiplier`), so an experiment can change the economy of a build that
 * is already published; `1` keeps the values the balance was tuned with.
 */
function earnedCoins(outcome: LevelOutcome): number {
  const multiplier = Math.max(0, flagNumber('coins_multiplier'));
  return Math.round(outcome.coins * multiplier);
}

function advanceProgress(progress: Progress, runtime: LevelRuntime, outcome: LevelOutcome): Progress {
  const id = runtime.config.id;

  // A master run never counts as campaign progress: it pays mastery instead.
  if (isMasterLevel(id)) {
    return { ...progress, coins: progress.coins + earnedCoins(outcome) };
  }

  const previous = progress.levelStars[id] ?? 0;
  const best = Math.max(previous, outcome.stars);
  const unlocked = nextLevelId(id) ?? id;
  // Stars won for the first time feed the weekly record (a better replay too).
  const weeks =
    outcome.status === 'won'
      ? bumpWeek(
          progress.weeks,
          resolveDay(progress.lastSeenDay, currentDayKey()),
          Math.max(0, best - previous),
        )
      : progress.weeks;

  return {
    ...progress,
    coins: progress.coins + earnedCoins(outcome),
    levelStars: { ...progress.levelStars, [id]: best },
    unlockedLevel: Math.max(progress.unlockedLevel, unlocked),
    weeks,
  };
}

/**
 * Bookkeeping of a finished run: master runs pay crowns and mastery points and
 * get the award attached to the outcome, so the result screen can show it.
 */
function applyOutcome(
  progress: Progress,
  runtime: LevelRuntime,
  outcome: LevelOutcome,
): { progress: Progress; outcome: LevelOutcome; award: MasterAward | null; rankUp: string | null } {
  const updated = advanceProgress(progress, runtime, outcome);
  const baseId = baseLevelIdFor(runtime.config.id);
  if (outcome.status !== 'won' || baseId === null) {
    return { progress: updated, outcome, award: null, rankUp: null };
  }

  const modifiers = runtime.config.master?.modifiers.length ?? 0;
  const { mastery, award } = awardMastery(progress.mastery, baseId, outcome.stars, modifiers);

  return {
    progress: { ...updated, mastery },
    outcome: { ...outcome, mastery: award },
    award,
    rankUp: award.rankUp,
  };
}

/** Runtime options derived from everything the player bought. */
function runtimeOptions(progress: Progress): { bonus: ReturnType<typeof ownedBonus>; extraTypes: string[] } {
  const shop = ownedBonus(progress.owned);
  const developed = upgradeBonus(progress.upgrades);

  // Department purchases and their development levels stack.
  return {
    bonus: {
      bonusMoves: shop.bonusMoves + developed.bonusMoves,
      bonusHints: shop.bonusHints + developed.bonusHints,
      bonusUndos: shop.bonusUndos + developed.bonusUndos,
      coinBonus: shop.coinBonus + developed.coinBonus,
    },
    extraTypes: ownedItemTypes(progress.owned),
  };
}

/** Development helpers that only read state (used by the shop screen). */
export function progressShopTier(progress: Progress): ReturnType<typeof shopTier> {
  return shopTier(totalUpgradeLevels(progress.upgrades));
}

export function progressUpgradeLevel(progress: Progress, trackId: string): number {
  return upgradeLevel(progress.upgrades, trackId);
}

/**
 * Stamp of the save that is on disk (`0` before the first write). The cloud
 * sync compares it with the cloud stamp, so it must be *persistent*: reading
 * the state must not pretend that an old save is fresh.
 */
let localSavedAt = 0;

/** What the store currently holds, in the shape the persistence layer expects. */
export function persistSnapshot(
  state: Pick<GameStore, 'progress' | 'settings' | 'daily' | 'events'>,
): PersistedState {
  return {
    version: SAVE_VERSION,
    savedAt: localSavedAt,
    progress: state.progress,
    settings: state.settings,
    daily: state.daily,
    events: state.events,
  };
}

/**
 * Adopts a save (from disk at boot, or from the cloud mid-session): the day is
 * resolved once, so a device clock moved backwards cannot reopen dailies or
 * drop the event that is running.
 */
function adoptSave(saved: PersistedState, apply: (patch: Partial<GameStore>) => void): void {
  const day = resolveDay(saved.progress.lastSeenDay, currentDayKey());
  const progress =
    day === saved.progress.lastSeenDay ? saved.progress : { ...saved.progress, lastSeenDay: day };
  localSavedAt = saved.savedAt;
  apply({
    progress,
    settings: saved.settings,
    daily: ensureToday(saved.daily, day),
    events: ensureEventState(saved.events, day),
    hydrated: true,
  });
}

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'menu',
  hydrated: false,
  runtime: null,
  boardRevision: 0,
  lastMove: null,
  hint: null,
  outcome: null,
  toast: null,
  progress: { ...DEFAULT_PROGRESS, levelStars: {}, owned: [...DEFAULT_PROGRESS.owned] },
  settings: { ...DEFAULT_SETTINGS },
  daily: emptyDaily(),
  events: { ...EMPTY_EVENT_STATE },
  platform: { ...DEFAULT_PLATFORM },
  cloud: { ...EMPTY_CLOUD_STATUS },
  ads: { ...EMPTY_ADS_STATUS },
  leaderboard: emptyLeaderboardStatus(),
  flags: emptyFlagsStatus(),
  purchases: emptyPurchasesStatus(),
  reviveUsed: false,
  /** The win reward of this run was already doubled with an ad. */
  rewardDoubled: false,
  boosterMode: null,
  lastBooster: null,

  hydrate: async () => {
    const saved = await loadState();
    adoptSave(saved, set);

    // The cloud session starts in the background: it may adopt a newer save
    // from another device, but the game is playable immediately either way and
    // never waits for the network.
    const status = await initCloud({
      read: () => persistSnapshot(get()),
      apply: (state) => adoptSave(state, set),
    });
    set({ cloud: status });

    // Purchases come next: the launch check of unprocessed payments credits
    // them into the save that was just loaded. It never blocks the menu either.
    startPurchases();

    // The ranking needs the platform and the session authorization, so it
    // starts after the cloud: it never blocks the menu either.
    void initLeaderboards();
  },

  claimEventTask: (taskId: string) => {
    const state = get();
    const day = resolveDay(state.progress.lastSeenDay, currentDayKey());
    const event = eventForDay(day);
    const events = ensureEventState(state.events, day);
    if (!event || events.id !== event.id) {
      get().showToast('Сейчас события нет', 'info');
      return false;
    }

    const task = event.tasks.find((entry) => entry.id === taskId);
    if (!task) return false;
    if (events.claimed.includes(task.id)) {
      get().showToast('Награда уже получена', 'info');
      return false;
    }
    if ((events.counts[task.metric] ?? 0) < task.target) {
      get().showToast('Задание ещё не выполнено', 'info');
      return false;
    }

    let boosters = state.progress.boosters;
    for (const id of BOOSTER_IDS) {
      const count = task.boosters?.[id] ?? 0;
      if (count > 0) boosters = grantBooster(boosters, id, count);
    }

    set({
      events: { ...events, claimed: [...events.claimed, task.id] },
      progress: {
        ...state.progress,
        coins: state.progress.coins + task.reward,
        boosters,
      },
    });
    get().showToast(`${event.name}: ${task.title} — +${task.reward} монет`, 'good');
    return true;
  },

  claimEventFinale: () => {
    const state = get();
    const day = resolveDay(state.progress.lastSeenDay, currentDayKey());
    const event = eventForDay(day);
    const events = ensureEventState(state.events, day);
    if (!event || events.id !== event.id) {
      get().showToast('Сейчас события нет', 'info');
      return false;
    }
    if (events.finaleClaimed) {
      get().showToast('Финал уже получен', 'info');
      return false;
    }
    if (!eventFinaleReady(events, event)) {
      get().showToast('Сначала выполните все задания события', 'info');
      return false;
    }

    let boosters = state.progress.boosters;
    for (const id of BOOSTER_IDS) {
      const count = event.finale.boosters?.[id] ?? 0;
      if (count > 0) boosters = grantBooster(boosters, id, count);
    }

    set({
      events: { ...events, finaleClaimed: true },
      progress: {
        ...state.progress,
        coins: state.progress.coins + event.finale.coins,
        boosters,
        eventWins: state.progress.eventWins.includes(event.id)
          ? state.progress.eventWins
          : [...state.progress.eventWins, event.id],
      },
    });
    get().showToast(`${event.finale.title}: ${event.finale.label}`, 'good');
    return true;
  },

  claimDailyGift: () => {
    const state = get();
    const day = resolveDay(state.progress.lastSeenDay, currentDayKey());
    const calendar = giftCalendar(state.progress.dailyStreak, day);

    if (!calendar.canClaim) {
      get().showToast(
        `Подарок уже получен · следующий через ${formatCountdown(msUntilTomorrow())}`,
        'info',
      );
      return false;
    }

    let boosters = state.progress.boosters;
    for (const id of BOOSTER_IDS) {
      const count = calendar.gift.boosters?.[id] ?? 0;
      if (count > 0) boosters = grantBooster(boosters, id, count);
    }

    set({
      progress: {
        ...state.progress,
        coins: state.progress.coins + calendar.gift.coins,
        dailyStreak: calendar.streak,
        lastSeenDay: day,
        boosters,
      },
    });
    get().showToast(`Подарок ${calendar.cycleDay}/${GIFT_CYCLE_DAYS}: ${calendar.gift.label}`, 'good');
    return true;
  },

  claimDaily: (taskId: string) => {
    const state = get();
    const today = resolveDay(state.progress.lastSeenDay, currentDayKey());
    const daily = ensureToday(state.daily, today);
    const task = pickDailyTasks(today).find((entry) => entry.id === taskId);
    if (!task) return false;
    if (daily.claimed.includes(task.id)) {
      get().showToast('Награда уже получена', 'info');
      return false;
    }
    if ((daily.counts[task.metric] ?? 0) < task.target) {
      get().showToast('Задание ещё не выполнено', 'info');
      return false;
    }

    // The streak grows on the first reward of the day and pays a bonus.
    const firstToday = state.progress.dailyStreak.lastDay !== today;
    const streak = advanceStreak(state.progress.dailyStreak, today);
    const bonus = firstToday ? streakBonus(streak.days) : 0;
    const earned = task.reward + bonus;

    set({
      daily: { ...daily, claimed: [...daily.claimed, task.id] },
      progress: {
        ...state.progress,
        coins: state.progress.coins + earned,
        dailyStreak: streak,
        lastSeenDay: today,
      },
    });
    get().showToast(
      firstToday && streak.days > 1
        ? `Награда: +${task.reward} монет · серия ${streak.days} дн. (+${bonus})`
        : `Награда: +${task.reward} монет`,
      'good',
    );
    return true;
  },

  startMasterLevel: (levelId: number) => {
    const state = get();
    if (!masterUnlocked(state.progress.levelStars)) {
      get().showToast('МАСТЕР откроется после уровня 60', 'info');
      return;
    }
    const config = buildMasterLevel(levelId);
    if (!config) {
      get().showToast('Уровень не найден', 'bad');
      return;
    }

    const runtime = createLevelRuntime(config, runtimeOptions(state.progress));
    set({
      runtime,
      phase: 'playing',
      hint: null,
      outcome: null,
      lastMove: null,
      boosterMode: null,
      lastBooster: null,
      reviveUsed: false,
      rewardDoubled: false,
      boardRevision: state.boardRevision + 1,
    });
    if (runtime.warning) get().showToast(runtime.warning, 'info');
    else if (config.tip) get().showToast(config.tip, 'info');
    // The shelves are being dealt: a short rising gesture announces it.
    audio.levelStart();
  },

  startLevel: (id: number) => {
    const config: LevelConfig | undefined = getLevel(id);
    if (!config) {
      get().showToast('Уровень не найден', 'bad');
      return;
    }
    const runtime = createLevelRuntime(config, runtimeOptions(get().progress));
    set({
      runtime,
      phase: 'playing',
      hint: null,
      outcome: null,
      lastMove: null,
      boosterMode: null,
      lastBooster: null,
      reviveUsed: false,
      rewardDoubled: false,
      boardRevision: get().boardRevision + 1,
    });
    if (runtime.warning) get().showToast(runtime.warning, 'info');
    else if (config.tip) get().showToast(config.tip, 'info');
    audio.levelStart();
  },

  restartLevel: () => {
    const current = get().runtime;
    if (!current) return;
    const runtime = createLevelRuntime(current.config, runtimeOptions(get().progress));
    set({
      runtime,
      phase: 'playing',
      hint: null,
      outcome: null,
      lastMove: null,
      // A fresh attempt: the revive comes back with it.
      reviveUsed: false,
      rewardDoubled: false,
      boardRevision: get().boardRevision + 1,
    });
    audio.levelStart();
  },

  requestMove: (from: number, to: number) => {
    const state = get();
    if (state.phase !== 'playing' || !state.runtime) return false;

    const { runtime, result, golden, bomb, iceMelted, combo, comboCoins } = playMove(state.runtime, from, to);
    if (!result.ok) return false;

    // Daily task counters: every move feeds the "collect triples" style goals.
    const daily = bumpDaily(state.daily, {
      matches: (result.match ? 1 : 0) + (result.blast ? 1 : 0),
      golden: golden ? 1 : 0,
      bombs: bomb ? 1 : 0,
    });

    const options = runtimeOptions(state.progress);
    const finished = runtime.status === 'playing' ? null : levelOutcome(runtime, options);

    const won = finished !== null && finished.status === 'won';
    const tracked = won && finished
      ? bumpDaily(daily, { levels: 1, stars: finished.stars, matches: 0, golden: 0, bombs: 0 })
      : daily;
    const settled = finished ? applyOutcome(state.progress, runtime, finished) : null;

    // Event counters follow the metric table in `data/events.ts`.
    const events = bumpEvent(state.events, {
      cleared: result.cleared.map((item) => ({ type: item.type, special: item.special })),
      triples: (result.match ? 1 : 0) + (result.blast ? 1 : 0),
      golden,
      bomb,
      combo,
      won: settled?.outcome.status === 'won',
      stars: settled?.outcome.stars ?? 0,
      hintsUsed: runtime.hintsUsed,
      boostersUsed: runtime.boostersUsed,
    }, currentDay(state.progress));

    set({
      runtime,
      lastMove: {
        from,
        to,
        clearedCount: result.cleared.length,
        golden,
        blast: result.blast,
        combo,
        comboCoins,
      },
      boardRevision: state.boardRevision + 1,
      hint: null,
      outcome: settled?.outcome ?? null,
      phase: runtime.status === 'won' ? 'won' : runtime.status === 'lost' ? 'lost' : 'playing',
      daily: tracked,
      events,
      progress: settled ? settled.progress : state.progress,
    });
    const award = settled?.award ?? null;

    if (golden) get().showToast('Золотая тройка! +1 ход и +2 монеты', 'good');
    else if (bomb) get().showToast('Взрыв! Ещё одна тройка товаров убрана', 'good');
    if (combo >= COMBO_START && comboCoins > 0) {
      get().showToast(`${comboLabel(combo)} — бонус +${comboCoins} монет`, 'good');
    }
    if (iceMelted) get().showToast('Лёд растаял — все товары снова можно двигать', 'info');
    if (award) {
      get().showToast(
        award.gained > 0
          ? `МАСТЕР: ${'👑'.repeat(award.crowns)} · +${award.gained} очков мастерства`
          : `МАСТЕР: ${'👑'.repeat(award.crowns)} · результат не лучше прежнего`,
        'good',
      );
      if (award.rankUp) get().showToast(`Новый ранг мастерства: ${award.rankUp}`, 'good');
    }
    return true;
  },

  requestHint: () => {
    const state = get();
    if (state.phase !== 'playing' || !state.runtime) return false;
    if (state.runtime.hintsLeft <= 0) {
      get().showToast('Подсказки закончились', 'bad');
      return false;
    }

    const goalTypes = goalProductTypes(state.runtime.config.goal);
    // Prefer a hint that helps the goal, but never refuse to hint at all.
    const hint =
      findHint(state.runtime.board, { allowedTypes: goalTypes }) ?? findHint(state.runtime.board, {});

    if (!hint) {
      get().showToast('Ходов больше нет — попробуйте отмену', 'bad');
      return false;
    }

    set({ runtime: spendHint(state.runtime), hint });
    return true;
  },

  requestUndo: () => {
    const state = get();
    if (state.phase !== 'playing' || !state.runtime) return false;
    if (state.runtime.history.length === 0) {
      get().showToast('Отменять пока нечего', 'info');
      return false;
    }
    if (state.runtime.undosLeft <= 0) {
      get().showToast('Отмены закончились', 'bad');
      return false;
    }

    set({
      runtime: undoMove(state.runtime),
      boardRevision: state.boardRevision + 1,
      hint: null,
      lastMove: null,
    });
    return true;
  },

  pause: () => {
    if (get().phase === 'playing') set({ phase: 'paused' });
  },

  resume: () => {
    if (get().phase === 'paused') set({ phase: 'playing' });
  },

  togglePause: () => {
    const phase = get().phase;
    if (phase === 'playing') set({ phase: 'paused' });
    else if (phase === 'paused') set({ phase: 'playing' });
  },

  exitToMenu: () =>
    set({
      phase: 'menu',
      runtime: null,
      hint: null,
      outcome: null,
      lastMove: null,
      boosterMode: null,
      lastBooster: null,
      reviveUsed: false,
      rewardDoubled: false,
    }),

  playNextLevel: () => {
    const current = get().runtime;
    if (!current) return;

    // Master runs walk through the master list, the campaign through LEVELS.
    const baseId = baseLevelIdFor(current.config.id);
    if (baseId !== null) {
      if (!masterHasNext(baseId)) {
        get().showToast('Это последний мастер-уровень — сыграйте другой!', 'info');
        return;
      }
      get().startMasterLevel(baseId + 1);
      return;
    }

    const next = nextLevelId(current.config.id);
    if (!next) {
      get().showToast('Кампания пройдена — впереди режим МАСТЕР!', 'info');
      return;
    }
    get().startLevel(next);
  },

  replayCurrentLevel: () => {
    const current = get().runtime;
    if (!current) {
      get().startLevel(get().progress.unlockedLevel);
      return;
    }
    const baseId = baseLevelIdFor(current.config.id);
    if (baseId !== null) get().startMasterLevel(baseId);
    else get().startLevel(current.config.id);
  },

  purchase: (itemId: string) => {
    const state = get();
    const item: ShopItem | undefined = shopItem(itemId);
    if (!item) return false;

    if (state.progress.owned.includes(itemId)) {
      get().showToast('Уже куплено', 'info');
      return false;
    }
    if (item.unlockLevel !== undefined && item.unlockLevel > state.progress.unlockedLevel) {
      get().showToast(`Откроется на уровне ${item.unlockLevel}`, 'info');
      return false;
    }
    if (state.progress.coins < item.price) {
      get().showToast('Не хватает монет — проходите уровни!', 'bad');
      return false;
    }

    const progress: Progress = {
      ...state.progress,
      coins: state.progress.coins - item.price,
      owned: [...state.progress.owned, itemId],
      activeDecor: item.kind === 'decor' ? itemId : state.progress.activeDecor,
    };

    set({ progress });
    get().showToast(`${item.name} — открыто!`, 'good');
    return true;
  },

  setActiveDecor: (itemId: string) => {
    const state = get();
    if (!state.progress.owned.includes(itemId)) {
      get().showToast('Сначала купите это оформление', 'bad');
      return false;
    }
    set({ progress: { ...state.progress, activeDecor: itemId } });
    get().showToast('Оформление применено', 'good');
    return true;
  },

  isOwned: (itemId: string) => get().progress.owned.includes(itemId),

  upgradeDepartment: (trackId: string) => {
    const state = get();
    const track = UPGRADE_BY_ID[trackId];
    if (!track) return false;

    // You can only develop a department you actually own.
    if (!state.progress.owned.includes(trackId)) {
      get().showToast(`Сначала купите ${track.name}`, 'bad');
      return false;
    }
    if (isMaxed(state.progress.upgrades, trackId)) {
      get().showToast('Этот отдел уже развит до максимума', 'info');
      return false;
    }

    const next = nextUpgrade(state.progress.upgrades, trackId);
    if (!next) return false;
    if (state.progress.coins < next.step.cost) {
      get().showToast(`Нужно ${next.step.cost} монет`, 'bad');
      return false;
    }

    const levels = { ...state.progress.upgrades, [trackId]: next.level };
    const granted = upgradeBoosterGrant(trackId, next.level);
    let boosters = state.progress.boosters;
    for (const [id, count] of Object.entries(granted) as Array<[BoosterId, number]>) {
      if (count > 0) boosters = grantBooster(boosters, id, count);
    }

    set({
      progress: {
        ...state.progress,
        coins: state.progress.coins - next.step.cost,
        upgrades: levels,
        boosters,
      },
    });

    get().showToast(`${track.name}: уровень ${next.level} — ${next.step.label}`, 'good');
    return true;
  },

  buyBooster: (id: BoosterId) => {
    const state = get();
    const price = boosterPrice(id);
    if (state.progress.coins < price) {
      get().showToast(`Нужно ${price} монет`, 'bad');
      return false;
    }

    set({
      progress: {
        ...state.progress,
        coins: state.progress.coins - price,
        boosters: grantBooster(state.progress.boosters, id, 1),
      },
    });
    get().showToast(`«${BOOSTERS[id].title}» +1`, 'good');
    return true;
  },

  dailyTasks: () => pickDailyTasks(ensureToday(get().daily).date),

  armBooster: (id: BoosterId) => {
    const state = get();
    if (state.phase !== 'playing' || !state.runtime) return false;
    if (!hasBooster(state.progress.boosters, id)) {
      get().showToast(`«${BOOSTERS[id].title}» закончился`, 'bad');
      return false;
    }
    if (!BOOSTERS[id].needsTarget) return get().useBooster(id);

    const armed = state.boosterMode === id;
    set({ boosterMode: armed ? null : id });
    if (!armed) get().showToast('Выберите товар, который нужно убрать', 'info');
    return true;
  },

  cancelBooster: () => set({ boosterMode: null }),

  useBooster: (id: BoosterId, index?: number) => {
    const state = get();
    if (state.phase !== 'playing' || !state.runtime) return false;

    const inventory = state.progress.boosters;
    if (boosterCount(inventory, id) <= 0) {
      get().showToast(`«${BOOSTERS[id].title}» закончился`, 'bad');
      return false;
    }

    // Spend first: every path below consumes exactly one booster.
    const runtime = state.runtime;
    const outcome =
      id === 'hammer'
        ? index === undefined
          ? null
          : useHammer(runtime, index)
        : id === 'shuffle'
          ? useShuffle(runtime, createRng((Date.now() ^ (state.boardRevision + 1) * 2654435761) >>> 0))
          : id === 'extraMove'
            ? useExtraMoves(runtime)
            : useFreeUndo(runtime);

    if (!outcome || !outcome.ok) {
      const reason = outcome?.reason;
      get().showToast(
        reason === 'nothing-to-shuffle'
          ? 'На полках нечего перемешивать'
          : reason === 'empty-cell' || reason === 'no-target'
            ? 'Здесь нет товара для молотка'
            : 'Сейчас бустер не сработает',
        'bad',
      );
      return false;
    }

    const spent = spendBooster(inventory, id);
    if (!spent) return false;

    const next = outcome.runtime;
    const events = bumpEvent(state.events, {
      cleared: [],
      triples: 0,
      golden: false,
      bomb: false,
      combo: next.combo.streak,
      won: false,
      stars: 0,
      hintsUsed: next.hintsUsed,
      boostersUsed: 1,
    }, currentDay(state.progress));
    const won = next.status === 'won';
    const finished = won || next.status === 'lost' ? levelOutcome(next, runtimeOptions(state.progress)) : null;
    const daily = won && finished ? bumpDaily(state.daily, { levels: 1, stars: finished.stars }) : state.daily;
    const settled = finished ? applyOutcome(state.progress, next, finished) : null;

    set({
      runtime: next,
      progress: {
        ...(settled ? settled.progress : state.progress),
        boosters: spent,
      },
      boardRevision: state.boardRevision + 1,
      hint: null,
      boosterMode: null,
      daily,
      events,
      outcome: settled?.outcome ?? null,
      phase: won ? 'won' : next.status === 'lost' ? 'lost' : 'playing',
      lastBooster: { id, index: index ?? -1, revision: state.boardRevision + 1 },
    });

    if (id === 'hammer') get().showToast('Молоток: товар убран с полки', 'good');
    if (id === 'shuffle') get().showToast('Товары перемешаны', 'good');
    if (id === 'extraMove') get().showToast(`+${EXTRA_MOVES} хода к запасу уровня`, 'good');
    if (id === 'undo') get().showToast('Бесплатная отмена добавлена', 'good');

    return true;
  },

  dismissToast: () => set({ toast: null }),

  showToast: (text, tone = 'info') => {
    toastCounter += 1;
    set({ toast: { id: toastCounter, text, tone } });
  },

  setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

  setPlatform: (patch) => set({ platform: { ...get().platform, ...patch } }),

  /**
   * `game_api_pause`: the platform shows an ad, a purchase window or takes the
   * focus away. The game pauses exactly like the player pressed «Пауза» and
   * remembers where to come back to.
   */
  platformPause: () => {
    const state = get();
    const wasPlaying = state.phase === 'playing';
    set({
      platform: { ...state.platform, paused: true, resumePhase: wasPlaying ? 'playing' : null },
      phase: wasPlaying ? 'paused' : state.phase,
    });
  },

  /**
   * `game_api_resume`: the platform gives the game back. Only a phase we paused
   * ourselves is restored — a player who was already in the pause menu stays
   * there. Gameplay markup is switched by `platform/boot.ts`, which knows the
   * ads of future stages too.
   */
  platformResume: () => {
    const state = get();
    const { resumePhase } = state.platform;
    const back = resumePhase === 'playing' && state.phase === 'paused' ? 'playing' : state.phase;
    set({
      platform: { ...state.platform, paused: false, resumePhase: null },
      phase: back,
    });
  },

  toggleFullscreen: () => {
    void requestFullscreen().then((fullscreen) => {
      get().setPlatform({ fullscreen });
    });
  },

  reviveWithAd: () => {
    const state = get();
    const runtime = state.runtime;
    if (!runtime || runtime.status !== 'lost') return;
    if (state.reviveUsed) {
      get().showToast('В этом заходе оживление уже использовано', 'info');
      return;
    }

    // The video is voluntary: the reward happens strictly inside `onRewarded`,
    // i.e. after the platform confirmed the view.
    void showRewarded('revive').then((result) => {
      if (result.outcome !== 'rewarded') {
        if (result.outcome === 'not-shown') get().showToast('Реклама сейчас недоступна', 'info');
        else if (result.outcome !== 'closed') get().showToast('Награда не получена', 'bad');
        return;
      }

      const current = get();
      const run = current.runtime;
      if (!run || current.phase !== 'lost') return;

      const revived = reviveRuntime(run);
      if (!revived.ok) return;

      set({
        runtime: revived.runtime,
        phase: 'playing',
        outcome: null,
        reviveUsed: true,
        boardRevision: current.boardRevision + 1,
      });
      audio.star(1);
      get().showToast(`+${revived.movesAdded} хода — уровень продолжается!`, 'good');
    });
  },

  watchAdForCoins: () => {
    const state = get();
    const today = adRewardToday(state.progress);
    if (today.coins >= adCoinsPerDay()) {
      get().showToast('Монеты за рекламу уже получены сегодня', 'info');
      return;
    }

    void showRewarded('shop-coins').then((result) => {
      if (result.outcome !== 'rewarded') {
        if (result.outcome === 'not-shown') get().showToast('Реклама сейчас недоступна', 'info');
        return;
      }

      const current = get();
      const reward = adRewardToday(current.progress);
      const prize = adCoinReward();
      set({
        progress: {
          ...current.progress,
          coins: current.progress.coins + prize,
          adReward: { ...reward, coins: reward.coins + 1 },
        },
      });
      audio.star(1);
      get().showToast(`За просмотр: +${prize} монет`, 'good');
    });
  },

  watchAdForBooster: () => {
    const state = get();
    const today = adRewardToday(state.progress);
    if (today.boosters >= AD_BOOSTERS_PER_DAY) {
      get().showToast('Бустер за рекламу уже получен сегодня', 'info');
      return;
    }

    void showRewarded('shop-booster').then((result) => {
      if (result.outcome !== 'rewarded') {
        if (result.outcome === 'not-shown') get().showToast('Реклама сейчас недоступна', 'info');
        return;
      }

      const current = get();
      const reward = adRewardToday(current.progress);
      // A random booster, so the prize stays interesting for everybody.
      const id = BOOSTER_IDS[Math.floor(Math.random() * BOOSTER_IDS.length)] as BoosterId;
      set({
        progress: {
          ...current.progress,
          boosters: grantBooster(current.progress.boosters, id, 1),
          adReward: { ...reward, boosters: reward.boosters + 1 },
        },
      });
      audio.star(1);
      get().showToast(`За просмотр: «${BOOSTERS[id].title}» +1`, 'good');
    });
  },

  doubleRewardWithAd: () => {
    const state = get();
    const outcome = state.outcome;
    if (state.phase !== 'won' || !outcome) return;
    if (state.rewardDoubled) {
      get().showToast(t('ads.doubleDone'), 'info');
      return;
    }

    const today = adRewardToday(state.progress);
    // The doubling shares the daily quota of ad coins: the ad economy stays
    // capped no matter how many levels are won.
    if (today.coins >= adCoinsPerDay()) {
      get().showToast(t('ads.doubleLimit'), 'info');
      return;
    }

    const bonus = Math.max(1, Math.round(outcome.coins));
    void showRewarded('level-double').then((result) => {
      if (result.outcome !== 'rewarded') {
        if (result.outcome === 'not-shown') get().showToast(t('ads.unavailable'), 'info');
        return;
      }

      const current = get();
      if (current.rewardDoubled || current.phase !== 'won') return;
      const reward = adRewardToday(current.progress);
      set({
        progress: {
          ...current.progress,
          coins: current.progress.coins + bonus,
          adReward: { ...reward, coins: reward.coins + 1 },
        },
        // The panel shows the bigger number right away.
        outcome: current.outcome ? { ...current.outcome, coins: current.outcome.coins + bonus } : current.outcome,
        rewardDoubled: true,
      });
      audio.golden();
      get().showToast(t('ads.doubleGet', { n: bonus }), 'good');
    });
  },

  buyProduct: (id) => {
    void requestPurchase(id).then((value) => {
      if (value.reason === 'cancelled') get().showToast(t('purchase.cancelled'), 'info');
      if (value.phase === 'error') get().showToast(t('purchase.failed'), 'bad');
      if (value.reason === 'no-platform' || value.phase === 'disabled') {
        get().showToast(t('shop.premiumOffline'), 'info');
      }
      // The reward itself is credited by `applyPurchaseReward` (the host of the
      // purchases module) — a purchase only pays out once.
    });
  },

  refreshPurchases: () => {
    void loadPurchases();
  },

  nextLevelAfterAd: () => {
    const run = (): void => {
      get().playNextLevel();
      syncBannerForPhase(get().phase);
    };
    // No ad (a web build, or the frequency gate said no): go straight on, no
    // promise hop in between. With an ad the call sits inside the click
    // handler, so the ad starts right after the action — the docs allow at
    // most two seconds of delay (item 4.4).
    if (!interstitialReady().allowed) {
      run();
      return;
    }
    void showInterstitial('level-next').finally(run);
  },

  replayAfterAd: () => {
    const run = (): void => {
      get().replayCurrentLevel();
      syncBannerForPhase(get().phase);
    };
    if (!interstitialReady().allowed) {
      run();
      return;
    }
    void showInterstitial('level-replay').finally(run);
  },

  loadLeaderboard: (id, force = false) => {
    void loadBoard(id, { force });
  },

  publishLeaderboards: () => {
    void publishScores();
  },

  refreshLeaderboards: (id) => {
    void publishScores().then(() => loadBoard(id, { force: true }));
  },

  scores: () => currentScores(),

  syncCloud: () => {
    void syncCloudNow().then((status) => set({ cloud: status }));
  },

  authorizeCloud: () => {
    void authorizeCloud().then((status) => set({ cloud: status }));
  },

  resetProgress: async () => {
    const { progress } = get();
    await clearState();
    // A deliberate wipe must reach the cloud, otherwise the next launch would
    // pull the old save back (see `platform/cloud.ts`).
    await setWipeMarker();
    set({
      progress: {
        ...DEFAULT_PROGRESS,
        levelStars: {},
        owned: [...DEFAULT_PROGRESS.owned],
        activeDecor: FREE_DECOR_ID,
        dailyStreak: EMPTY_STREAK,
        lastSeenDay: '',
        boosters: starterBoosters(),
        upgrades: {},
        mastery: { ...EMPTY_MASTERY, crowns: {}, best: {} },
        eventWins: [],
        adReward: { ...EMPTY_AD_REWARD, day: currentDayKey() },
        // The weekly record stays: the platform keeps published scores anyway.
        weeks: { ...progress.weeks },
      },
      settings: { ...DEFAULT_SETTINGS },
      daily: emptyDaily(),
      events: emptyEventState(),
      phase: 'menu',
      runtime: null,
      outcome: null,
    });
    saveQueue.flush();
    void flushCloud();
  },
}));

/**
 * Autosave: any change of progress or settings is written to IndexedDB after a
 * short debounce. Saves are skipped until the first hydrate finished, so a fresh
 * page load can never overwrite an existing save with defaults.
 */
const saveQueue = createSaveQueue();
if (typeof window !== 'undefined') {
  useGameStore.subscribe((state, previous) => {
    if (!state.hydrated) return;
    if (
      state.progress === previous.progress &&
      state.settings === previous.settings &&
      state.daily === previous.daily &&
      state.events === previous.events
    ) {
      return;
    }
    // The stamp is taken now, so the cloud sees the same moment as the disk.
    localSavedAt = now();
    saveQueue.push(persistSnapshot(state));
    // And the same change is mirrored to the cloud (debounced inside).
    noteLocalChange({ read: () => persistSnapshot(useGameStore.getState()) });
  });

  // The cloud module owns the network; the store only renders its status.
  subscribeCloud((status) => useGameStore.setState({ cloud: status }));
  // Same for the ad layer: the UI reads availability, the banner and the last ad.
  subscribeAds((status) => useGameStore.setState({ ads: status }));
  // And for the ranking: the module owns the network, the store renders it.
  subscribeLeaderboards((value) => useGameStore.setState({ leaderboard: value }));

  // Same for the remote configuration: the module owns the request, the store
  // renders the values (and the ad layer reads them lazily).
  subscribeFlags((value) => useGameStore.setState({ flags: value }));
  subscribePurchases((value) => useGameStore.setState({ purchases: value }));

  // The purchases module asks the store to credit a paid product (coins, the
  // boosters of a pack, the «no ads» flag) — injected once, never imported.
  connectPurchases({ apply: applyPurchaseReward, owned: () => purchasesStatus().owned });

  // The ad layer asks the store which screen is on (and whether the player
  // bought the ad-free product) — injected, not imported.
  connectAds({
    phase: () => useGameStore.getState().phase,
    adsOff: () => ownedBeforeSession(NO_ADS_PRODUCT),
  });

  // The ranking takes its data from the save and its authorization from the
  // cloud session — injected once, so the module never imports the store.
  connectLeaderboards({
    read: () => persistSnapshot(useGameStore.getState()),
    authorized: () => useGameStore.getState().cloud.authorized,
    playerId: () => useGameStore.getState().cloud.playerId,
  });

  useGameStore.subscribe((state, previous) => {
    if (state.phase === 'won' && previous.phase !== 'won') {
      // A won level is a logical pause: it unlocks the next interstitial.
      noteLevelFinished();
      // And the score may have improved — only better values are sent.
      void publishScores();
    }
    // The sticky banner is hidden while a level is played (item 4.4).
    if (state.phase !== previous.phase) syncBannerForPhase(state.phase);
  });
}

/**
 * Last-moment saves: hiding the tab or handing the game to the platform must
 * not lose the last action (requirement 1.9).
 */
/**
 * Credits a paid product into the save and tells the player about it. Runs from
 * the purchases module — both for a fresh purchase and for the ones the
 * mandatory launch check found unprocessed. Returning `false` would leave the
 * purchase unprocessed, so the reward is credited before `consumePurchase()`.
 */
export function applyPurchaseReward(id: string, reward: PurchaseReward): boolean {
  const state = useGameStore.getState();
  let boosters = state.progress.boosters;
  for (const [key, count] of Object.entries(reward.boosters)) {
    if (!count) continue;
    boosters = grantBooster(boosters, key as BoosterId, count);
  }

  const coins = Math.round(reward.coins);
  if (coins > 0 || boosters !== state.progress.boosters) {
    useGameStore.setState({ progress: { ...state.progress, coins: state.progress.coins + coins, boosters } });
    // The same change goes to the cloud (debounced inside the module).
    noteLocalChange({ read: () => persistSnapshot(useGameStore.getState()) });
  }

  if (id === NO_ADS_PRODUCT) {
    // A non-consumable comes back from `getPurchases()` on every launch: the
    // banner is re-checked, but the player is thanked only for a fresh buy.
    syncBannerForPhase(useGameStore.getState().phase);
    if (ownedBeforeSession(id)) return true;
    audio.golden();
    useGameStore.getState().showToast(t('purchase.noAdsDone'), 'good');
  } else {
    const product = productDef(id);
    audio.golden();
    useGameStore.getState().showToast(t('purchase.done', { name: product ? t(product.titleKey) : id }), 'good');
  }
  return true;
}

/** Reads the catalog of the Console. Never throws: no platform, no catalog. */
async function loadPurchases(): Promise<void> {
  const value = await loadPurchaseCatalog();
  useGameStore.setState({ purchases: value });
}

/** The flags request of the session, with the client features of this player. */
async function loadFlags(): Promise<void> {
  const state = useGameStore.getState();
  const stars = Object.values(state.progress.levelStars).reduce((sum, value) => sum + value, 0);
  // `initFlags` turns these into the `clientFeatures` of the request itself.
  const value = await initFlags({
    features: { levels: state.progress.unlockedLevel, stars, paying: payingFeature() },
  });
  useGameStore.setState({ flags: value });
}

/**
 * The mandatory check of unprocessed purchases (requirement 1.13.1) plus the
 * catalog and the remote configuration. Starts in the background: the menu must
 * not wait for the network.
 */
function startPurchases(): void {
  void initPurchases().then((value) => {
    useGameStore.setState({ purchases: value });
    void loadPurchases().then(() => loadFlags());
  });
}

function flushSaves(): void {
  saveQueue.flush();
  void flushCloud();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushSaves();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushSaves);
}

export const selectBoard = (state: GameStore) => state.runtime?.board ?? null;
export const selectProgress = (state: GameStore) => state.progress;
