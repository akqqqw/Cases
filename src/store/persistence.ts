import { FREE_DECOR_ID } from '../data/shop';
import { FIRST_LEVEL_ID } from '../data/levels';
import { EMPTY_STREAK, type DailyStreak } from '../data/dailies';
import { EMPTY_WEEK, type WeekProgress } from '../data/weeks';
import { currentDayKey, latestDay, resolveDay } from '../data/clock';
import { BOOSTER_IDS, emptyBoosters, starterBoosters, type BoosterId, type BoosterInventory } from '../core/boosters';
import { UPGRADE_TRACKS, upgradeLevel, type UpgradeLevels } from '../data/upgrades';
import { EMPTY_MASTERY, MASTER_LEVEL_IDS, type MasteryProgress } from '../data/master';
import {
  EMPTY_EVENT_STATE,
  emptyEventState,
  eventForDay,
  eventTaskViews,
  type EventProgressState,
} from '../data/events';
import type { DailyState, Progress, Settings } from './gameStore';

/**
 * Progress persistence. IndexedDB is the primary store (as required by the
 * design), with a localStorage fallback for browsers / modes where IndexedDB is
 * unavailable (private windows, blocked storage). Nothing here ever throws:
 * a failed save must never break the game.
 */
export interface PersistedState {
  version: number;
  /**
   * When the save was written (ms). The cloud sync compares this stamp with the
   * one inside the cloud copy, so both devices must agree on the clock — hence
   * `now()` from `data/clock.ts` (the trusted server time when it is available).
   * `0` means "written before the cloud layer existed" (a legacy local save).
   */
  savedAt: number;
  progress: Progress;
  settings: Settings;
  daily: DailyState;
  /** Counters of the running event (empty when no event is active). */
  events: EventProgressState;
}

/** Daily quota of the rewards that come from watching a rewarded video. */
export interface AdRewardState {
  /** Day the counters belong to, `YYYY-MM-DD`. */
  day: string;
  coins: number;
  boosters: number;
}

export const EMPTY_AD_REWARD: AdRewardState = { day: '', coins: 0, boosters: 0 };

export const SAVE_VERSION = 1;
const DB_NAME = 'shelf-sort';
const DB_VERSION = 1;
const STORE = 'game';
const KEY = 'state';
/** Mirror of the last cloud save, kept next to the local one. */
const KEY_CLOUD = 'cloud';
/** Marker of a deliberate "сбросить прогресс" (see `setWipeMarker`). */
const KEY_WIPE = 'wipe';
const LS_KEY = 'shelf-sort:state';
const LS_KEY_CLOUD = 'shelf-sort:cloud';
const LS_KEY_WIPE = 'shelf-sort:wipe';

export const DEFAULT_PROGRESS: Progress = {
  levelStars: {},
  coins: 0,
  unlockedLevel: FIRST_LEVEL_ID,
  owned: [FREE_DECOR_ID],
  activeDecor: FREE_DECOR_ID,
  dailyStreak: { ...EMPTY_STREAK },
  lastSeenDay: '',
  boosters: starterBoosters(),
  upgrades: {},
  mastery: { crowns: {}, best: {} },
  eventWins: [],
  adReward: { ...EMPTY_AD_REWARD },
  weeks: { ...EMPTY_WEEK },
};

export const DEFAULT_SETTINGS: Settings = { sound: true, music: true, volume: 0.8 };

export function emptyDaily(date = currentDayKey()): DailyState {
  return { date, counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 }, claimed: [] };
}

function defaultState(): PersistedState {
  return {
    version: SAVE_VERSION,
    savedAt: 0,
    progress: { ...DEFAULT_PROGRESS, levelStars: {}, owned: [...DEFAULT_PROGRESS.owned] },
    settings: { ...DEFAULT_SETTINGS },
    daily: emptyDaily(),
    events: { ...EMPTY_EVENT_STATE },
  };
}

/** Validates and upgrades whatever was found in storage. */
export function migrate(raw: unknown): PersistedState {
  const fallback = defaultState();
  if (!raw || typeof raw !== 'object') return fallback;

  const source = raw as Partial<PersistedState>;
  const progress = (source.progress ?? {}) as Partial<Progress>;
  const settings = (source.settings ?? {}) as Partial<Settings>;

  const levelStars: Record<number, number> = {};
  if (progress.levelStars && typeof progress.levelStars === 'object') {
    for (const [key, value] of Object.entries(progress.levelStars)) {
      const id = Number(key);
      const stars = Number(value);
      // Anything above three stars is clamped, anything below one is dropped.
      if (Number.isFinite(id) && id > 0 && Number.isFinite(stars) && stars >= 1) {
        levelStars[id] = Math.min(3, Math.max(1, Math.round(stars)));
      }
    }
  }

  const owned = Array.isArray(progress.owned)
    ? [...new Set(progress.owned.filter((id): id is string => typeof id === 'string'))]
    : [];
  if (!owned.includes(FREE_DECOR_ID)) owned.push(FREE_DECOR_ID);

  const unlocked = Number(progress.unlockedLevel);

  const savedAt = Number(source.savedAt);

  return {
    version: SAVE_VERSION,
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? Math.floor(savedAt) : 0,
    progress: {
      levelStars,
      coins: Math.max(0, Math.floor(Number(progress.coins) || 0)),
      unlockedLevel: Number.isFinite(unlocked) && unlocked >= 1 ? Math.floor(unlocked) : FIRST_LEVEL_ID,
      owned,
      activeDecor: typeof progress.activeDecor === 'string' && owned.includes(progress.activeDecor)
        ? progress.activeDecor
        : FREE_DECOR_ID,
      dailyStreak: migrateStreak(progress.dailyStreak),
      lastSeenDay: migrateLastSeenDay(progress.lastSeenDay),
      boosters: migrateBoosters(progress.boosters),
      upgrades: migrateUpgrades(progress.upgrades),
      mastery: migrateMastery(progress.mastery),
      eventWins: Array.isArray(progress.eventWins)
        ? [...new Set(progress.eventWins.filter((id): id is string => typeof id === 'string'))]
        : [],
      adReward: migrateAdReward(progress.adReward),
      weeks: migrateWeek(progress.weeks),
    },
    settings: {
      sound: settings.sound !== false,
      music: settings.music !== false,
      volume: Number.isFinite(settings.volume) ? Math.min(1, Math.max(0, Number(settings.volume))) : 0.8,
    },
    daily: migrateDaily(source.daily),
    events: migrateEvents(source.events),
  };
}

/**
 * Event counters: only the running event survives, everything else is stale
 * (an event that ended must not leak its progress into the next one).
 */
export function migrateEvents(raw: unknown, day = currentDayKey()): EventProgressState {
  const event = eventForDay(day);
  // a save of another (or of no) event gets a clean slate for the running one
  const fresh = event ? emptyEventState(event.id, day) : { ...EMPTY_EVENT_STATE };
  if (!raw || typeof raw !== 'object') return fresh;

  const source = raw as Partial<EventProgressState>;
  if (!event || source.id !== event.id) return fresh;

  const counts: Record<string, number> = {};
  if (source.counts && typeof source.counts === 'object') {
    for (const task of event.tasks) {
      const value = Number((source.counts as Record<string, unknown>)[task.metric]);
      if (Number.isFinite(value) && value > 0) counts[task.metric] = Math.floor(value);
    }
  }

  const known = new Set(event.tasks.map((task) => task.id));
  const claimed = Array.isArray(source.claimed)
    ? [...new Set(source.claimed.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : [];

  const state: EventProgressState = {
    id: event.id,
    day,
    counts,
    claimed,
    finaleClaimed: source.finaleClaimed === true && eventTaskViews({ id: event.id, day, counts, claimed, finaleClaimed: false }, event).every((view) => view.done),
  };

  return state;
}

/**
 * Department levels: unknown ids are dropped and levels are clamped to the
 * length of their track, so a hand-edited save can never unlock a level the
 * catalogue does not contain.
 */
export function migrateUpgrades(raw: unknown): UpgradeLevels {
  if (!raw || typeof raw !== 'object') return {};

  const source = raw as Record<string, unknown>;
  const result: UpgradeLevels = {};
  for (const track of UPGRADE_TRACKS) {
    const value = upgradeLevel(source as UpgradeLevels, track.id);
    if (value > 0) result[track.id] = value;
  }
  return result;
}

/**
 * Mastery: crowns are clamped to 1..3 and only kept for real campaign levels,
 * best scores only exist where a crown was won.
 */
export function migrateMastery(raw: unknown): MasteryProgress {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_MASTERY, crowns: {}, best: {} };

  const source = raw as Partial<Record<'crowns' | 'best', unknown>>;
  const storedCrowns = (source.crowns ?? {}) as Record<string, unknown>;
  const storedBest = (source.best ?? {}) as Record<string, unknown>;
  const crowns: Record<number, number> = {};
  const best: Record<number, number> = {};

  for (const id of MASTER_LEVEL_IDS) {
    const crownsWon = Number(storedCrowns[id]);
    if (!Number.isFinite(crownsWon) || crownsWon <= 0) continue;
    crowns[id] = Math.min(3, Math.floor(crownsWon));

    const score = Number(storedBest[id]);
    if (Number.isFinite(score) && score > 0) best[id] = Math.floor(score);
  }

  return { crowns, best };
}

/**
 * Booster counts are clamped to sane whole numbers. Saves from before boosters
 * existed get the starter set, so the feature is usable right away — an existing
 * player is not punished for having played earlier.
 */
export function migrateBoosters(raw: unknown): BoosterInventory {
  if (!raw || typeof raw !== 'object') return starterBoosters();

  const source = raw as Partial<Record<BoosterId, unknown>>;
  const result = emptyBoosters();
  for (const id of BOOSTER_IDS) {
    const value = Number(source[id]);
    result[id] = Number.isFinite(value) && value > 0 ? Math.min(99, Math.floor(value)) : 0;
  }
  return result;
}

/**
 * Rewarded-video counters: only the current day is kept, the numbers are
 * clamped to sane values so a hand-edited save cannot harvest free coins.
 */
export function migrateAdReward(raw: unknown, day = currentDayKey()): AdRewardState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_AD_REWARD, day };
  const source = raw as Partial<AdRewardState>;
  if (source.day !== day) return { ...EMPTY_AD_REWARD, day };

  const coins = Number(source.coins);
  const boosters = Number(source.boosters);
  return {
    day,
    coins: Number.isFinite(coins) && coins > 0 ? Math.min(99, Math.floor(coins)) : 0,
    boosters: Number.isFinite(boosters) && boosters > 0 ? Math.min(99, Math.floor(boosters)) : 0,
  };
}

/** The streak survives as long as its shape is sane. */
/**
 * Week record of the weekly leaderboard: the key must be a real ISO week and
 * the numbers sane; `best` is never below the running week.
 */
export function migrateWeek(raw: unknown): WeekProgress {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WEEK };
  const source = raw as Partial<WeekProgress>;
  const key = typeof source.key === 'string' && /^\d{4}-W\d{2}$/.test(source.key) ? source.key : '';
  const stars = clampCount(source.stars);
  const best = Math.max(clampCount(source.best), key.length > 0 ? stars : 0);
  return { key, stars, best };
}

function clampCount(value: unknown): number {
  const number = Math.floor(Number(value) || 0);
  return Number.isFinite(number) && number > 0 ? Math.min(999_999, number) : 0;
}

export function migrateStreak(raw: unknown): DailyStreak {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STREAK };
  const source = raw as Partial<DailyStreak>;
  const days = Number(source.days);
  const lastDay = typeof source.lastDay === 'string' ? source.lastDay : '';

  if (!Number.isFinite(days) || days <= 0 || !isDayKey(lastDay)) {
    return { ...EMPTY_STREAK };
  }
  if (lastDay > currentDayKey()) return { ...EMPTY_STREAK };
  return { days: Math.floor(days), lastDay };
}

/**
 * The last visited day. It is kept even when it lies ahead of the device clock
 * (that is what makes the calendar monotonic), but a day that is absurdly far in
 * the future is dropped as a broken clock so the player is not locked out.
 */
export function migrateLastSeenDay(raw: unknown): string {
  if (typeof raw !== 'string' || !isDayKey(raw)) return '';
  return resolveDay(latestDay(raw, ''), currentDayKey());
}

function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Daily counters are only kept when they belong to today. */
function migrateDaily(raw: unknown): DailyState {
  const today = currentDayKey();
  if (!raw || typeof raw !== 'object') return emptyDaily(today);

  const source = raw as Partial<DailyState>;
  if (source.date !== today) return emptyDaily(today);

  const counts = emptyDaily(today).counts;
  const stored = (source.counts ?? {}) as Record<string, unknown>;
  for (const metric of Object.keys(counts) as Array<keyof typeof counts>) {
    const value = Number(stored[metric]);
    counts[metric] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  const claimed = Array.isArray(source.claimed)
    ? [...new Set(source.claimed.filter((id): id is string => typeof id === 'string'))]
    : [];

  return { date: today, counts, claimed };
}

// ------------------------------------------------------- progress comparison

/**
 * How far a save has come. Used by the cloud sync to compare two saves from
 * different devices: the *rank* decides which one is "further", the timestamp
 * only breaks ties (a device with a broken clock must not erase progress).
 *
 * Only irreversible things count: stars, unlocked level, bought departments and
 * decor, mastery crowns and best master scores, cleared events, the day streak.
 * Coins and boosters are deliberately left out: they are spent during play, so
 * spending would look like "going backwards" and the device would pull an old
 * cloud save over a newer local one.
 */
export function progressRank(progress: Progress): number {
  const stars = Object.values(progress.levelStars).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const owned = progress.owned.length;
  const upgrades = Object.values(progress.upgrades).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const crowns = Object.values(progress.mastery.crowns).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const best = Object.values(progress.mastery.best).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const events = progress.eventWins.length;
  const streak = Math.min(365, Math.max(0, Math.floor(progress.dailyStreak.days) || 0));

  return (
    stars * 1000 +
    Math.max(0, Math.floor(progress.unlockedLevel) || 0) * 100 +
    owned * 200 +
    upgrades * 150 +
    crowns * 300 +
    best * 10 +
    events * 250 +
    streak * 20
  );
}

/** `true` when a save holds nothing a player would be sorry to lose. */
export function isBlankProgress(progress: Progress): boolean {
  return progressRank(progress) <= progressRank(DEFAULT_PROGRESS);
}

// ------------------------------------------------------------------ IndexedDB

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return dbPromise;
}

function idbGetValue(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPutValue(db: IDBDatabase, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function idbGet(db: IDBDatabase): Promise<unknown> {
  return idbGetValue(db, KEY);
}

function idbPut(db: IDBDatabase, value: PersistedState): Promise<boolean> {
  return idbPutValue(db, KEY, value);
}

// ------------------------------------------------------------------ public API

export async function loadState(): Promise<PersistedState> {
  const db = await openDb();
  if (db) {
    const stored = await idbGet(db);
    if (stored) return migrate(stored);
  }

  try {
    const raw = fallbackStorage()?.getItem(LS_KEY) ?? null;
    if (raw) return migrate(JSON.parse(raw));
  } catch {
    /* ignore broken / blocked storage */
  }

  return defaultState();
}

export async function saveState(state: PersistedState): Promise<void> {
  const db = await openDb();
  if (db && (await idbPut(db, state))) return;

  try {
    fallbackStorage()?.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    /* ignore: progress simply stays in memory */
  }
}

export interface SaveQueue {
  /** Queues a save (the write happens after the debounce). */
  push: (state: PersistedState) => void;
  /** Writes the pending save right now (used on pause / page hide / reset). */
  flush: () => void;
}

/** Debounced saver: a burst of moves results in one write. */
export function createSaveQueue(delayMs = 600): SaveQueue {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PersistedState | null = null;

  const write = (): void => {
    timer = null;
    const value = pending;
    pending = null;
    if (value) void saveState(value);
  };

  return {
    push: (state: PersistedState) => {
      pending = state;
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, delayMs);
    },
    flush: () => {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}

/**
 * Storage used when IndexedDB is unavailable. Yandex Games resets
 * `localStorage` on new iOS versions, so the SDK is asked for `safeStorage`
 * (`ysdk.getStorage()`, same interface) and that is plugged in here.
 */
let storageAdapter: Storage | null = null;

export function setStorageAdapter(adapter: Storage | null): void {
  storageAdapter = adapter;
}

function fallbackStorage(): Storage | null {
  if (storageAdapter) return storageAdapter;
  return typeof localStorage === 'undefined' ? null : localStorage;
}

/**
 * The same storage the local fallback uses (`safeStorage` on Yandex when the
 * platform provides it). Handed out for small non-save keys, e.g. the ad
 * frequency stamp — that one must survive a page reload but must not travel
 * between devices.
 */
export function localStorageAdapter(): Storage | null {
  return fallbackStorage();
}

/** Drops the stored save (used by "сбросить прогресс"). */
export async function clearState(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  try {
    fallbackStorage()?.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------- wipe mark

/**
 * "The player asked to wipe the progress." The local save is blank on purpose,
 * so the cloud sync must overwrite the cloud copy instead of pulling it back —
 * without this marker a reset would be undone on the next launch by the rule
 * "a blank local save takes the cloud save". The mark is dropped as soon as a
 * push to the cloud succeeds.
 */
export async function setWipeMarker(ms: number = Date.now()): Promise<void> {
  const db = await openDb();
  if (db && (await idbPutValue(db, KEY_WIPE, ms))) return;
  try {
    fallbackStorage()?.setItem(LS_KEY_WIPE, String(ms));
  } catch {
    /* ignore */
  }
}

export async function loadWipeMarker(): Promise<number | null> {
  const db = await openDb();
  if (db) {
    const stored = await idbGetValue(db, KEY_WIPE);
    const value = Number(stored);
    if (Number.isFinite(value) && value > 0) return value;
  }
  try {
    const raw = fallbackStorage()?.getItem(LS_KEY_WIPE) ?? null;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    /* ignore */
  }
  return null;
}

export async function clearWipeMarker(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY_WIPE);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  try {
    fallbackStorage()?.removeItem(LS_KEY_WIPE);
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------- cloud mirror

/**
 * A copy of the last cloud save, kept in the same place as the local one. It
 * makes offline starts and account switches deterministic without an extra
 * round trip; `platform/cloud.ts` owns its shape (`CloudEnvelope`).
 */
export async function loadCloudMirror(): Promise<unknown> {
  const db = await openDb();
  if (db) {
    const stored = await idbGetValue(db, KEY_CLOUD);
    if (stored) return stored;
  }
  try {
    const raw = fallbackStorage()?.getItem(LS_KEY_CLOUD) ?? null;
    if (raw) return JSON.parse(raw) as unknown;
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveCloudMirror(value: unknown): Promise<void> {
  const db = await openDb();
  if (db) {
    const ok = await idbPutValue(db, KEY_CLOUD, value);
    if (ok) return;
  }
  try {
    fallbackStorage()?.setItem(LS_KEY_CLOUD, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export async function clearCloudMirror(): Promise<void> {
  const db = await openDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(KEY_CLOUD);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
  try {
    fallbackStorage()?.removeItem(LS_KEY_CLOUD);
  } catch {
    /* ignore */
  }
}
