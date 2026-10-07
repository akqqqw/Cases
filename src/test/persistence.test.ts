import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SAVE_VERSION,
  clearCloudMirror,
  clearState,
  clearWipeMarker,
  createSaveQueue,
  emptyDaily,
  loadCloudMirror,
  loadState,
  loadWipeMarker,
  migrate,
  migrateMastery,
  progressRank,
  saveCloudMirror,
  saveState,
  setStorageAdapter,
  setWipeMarker,
  type PersistedState,
} from '../store/persistence';
import { DEFAULT_PROGRESS, DEFAULT_SETTINGS } from '../store/persistence';
import { FREE_DECOR_ID } from '../data/shop';
import { FIRST_LEVEL_ID } from '../data/levels';
import { dailyKey, todayKey } from '../data/dailies';
import { migrateBoosters } from '../store/persistence';
import { STARTER_BOOSTERS } from '../core/boosters';

/** Minimal localStorage stub: the sandbox has no browser, IndexedDB is absent. */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const stub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = stub;
  return store;
}

beforeEach(() => {
  installLocalStorage();
  setStorageAdapter(null);
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.useRealTimers();
});

describe('save migration', () => {
  it('falls back to defaults for missing or broken data', () => {
    for (const bad of [null, undefined, 42, 'nonsense', {}, []]) {
      const state = migrate(bad);
      expect(state.version).toBe(SAVE_VERSION);
      expect(state.progress.coins).toBe(0);
      expect(state.progress.unlockedLevel).toBe(FIRST_LEVEL_ID);
      expect(state.progress.levelStars).toEqual({});
      expect(state.progress.owned).toContain(FREE_DECOR_ID);
      expect(state.settings.sound).toBe(true);
    }
  });

  it('keeps valid progress and sanitises the rest', () => {
    const state = migrate({
      version: 1,
      progress: {
        coins: 1234.7,
        unlockedLevel: 27,
        levelStars: { 1: 3, 2: 2, 3: 0, 4: 9, bad: 2, 5: 'x' },
        owned: ['dept-sweets', 'dept-sweets', 42, 'decor-mint'],
        activeDecor: 'decor-mint',
      },
      settings: { sound: false, music: true, volume: 5 },
    });

    expect(state.progress.coins).toBe(1234);
    expect(state.progress.unlockedLevel).toBe(27);
    expect(state.progress.levelStars).toEqual({ 1: 3, 2: 2, 4: 3 }); // 0/x dropped, 9 clamped
    // duplicates and non-strings are dropped, the free starter interior is kept
    expect(state.progress.owned).toEqual(['dept-sweets', 'decor-mint', FREE_DECOR_ID]);
    expect(state.progress.activeDecor).toBe('decor-mint');
    expect(state.settings.sound).toBe(false);
    expect(state.settings.volume).toBe(1);
  });

  it('remembers the last day the player has seen', () => {
    const now = new Date();
    const tomorrow = dailyKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));

    const kept = migrate({ progress: { lastSeenDay: tomorrow } });
    expect(kept.progress.lastSeenDay).toBe(tomorrow);

    // a broken key simply means "no day recorded yet"
    const broken = migrate({ progress: { lastSeenDay: 'вчера' } });
    expect(broken.progress.lastSeenDay).toBe('');
  });

  it('never leaves the player without an interior or with a missing level', () => {
    const noDecor = migrate({ progress: { owned: ['dept-sweets'], activeDecor: 'decor-night' } });
    expect(noDecor.progress.owned).toContain(FREE_DECOR_ID);
    expect(noDecor.progress.activeDecor).toBe(FREE_DECOR_ID);

    const zeroLevel = migrate({ progress: { unlockedLevel: 0, coins: -50 } });
    expect(zeroLevel.progress.unlockedLevel).toBe(FIRST_LEVEL_ID);
    expect(zeroLevel.progress.coins).toBe(0);
  });
});

describe('booster migration', () => {
  it('hands the starter set to saves made before boosters existed', () => {
    expect(migrateBoosters(undefined)).toEqual(STARTER_BOOSTERS);
    expect(migrateBoosters(null)).toEqual(STARTER_BOOSTERS);
  });

  it('sanitises broken counts', () => {
    expect(migrateBoosters({ hammer: 3.7, shuffle: -2, extraMove: Number.NaN, undo: 1000 })).toEqual({
      hammer: 3,
      shuffle: 0,
      extraMove: 0,
      undo: 99,
    });
  });

  it('keeps a real inventory as it is', () => {
    expect(migrateBoosters({ hammer: 0, shuffle: 1, extraMove: 5, undo: 2 })).toEqual({
      hammer: 0,
      shuffle: 1,
      extraMove: 5,
      undo: 2,
    });
  });
});

describe('mastery migration', () => {
  it('keeps crowns of real campaign levels only', () => {
    const migrated = migrateMastery({
      crowns: { 2: 2, 30: 9, 60: 1, 1: 3, 61: 3, 999: 1 },
      best: { 2: 41, 30: 0, 60: 22, 999: 99 },
    });

    expect(migrated.crowns).toEqual({ 2: 2, 30: 3, 60: 1 });
    expect(migrated.best).toEqual({ 2: 41, 60: 22 });
  });

  it('ignores broken mastery data', () => {
    for (const bad of [null, undefined, 'nope', 42, []]) {
      expect(migrateMastery(bad)).toEqual({ crowns: {}, best: {} });
    }
    expect(migrateMastery({ crowns: { 2: 'три' }, best: { 2: Number.NaN } })).toEqual({ crowns: {}, best: {} });
  });

  it('keeps mastery through a save round trip', async () => {
    const state: PersistedState = {
      version: SAVE_VERSION,
      savedAt: 1_700_000_000_000,
      progress: {
        ...DEFAULT_PROGRESS,
        mastery: { crowns: { 2: 3, 30: 1 }, best: { 2: 48, 30: 20 } },
      },
      settings: { ...DEFAULT_SETTINGS },
      daily: emptyDaily(),
      events: { id: '', day: '', counts: {}, claimed: [], finaleClaimed: false },
    };

    await saveState(state);
    const loaded = await loadState();
    expect(loaded.progress.mastery).toEqual({ crowns: { 2: 3, 30: 1 }, best: { 2: 48, 30: 20 } });
  });
});

describe('save/load round trip', () => {
  const state: PersistedState = {
    version: SAVE_VERSION,
    savedAt: 1_700_000_000_000,
    progress: {
      coins: 777,
      unlockedLevel: 12,
      levelStars: { 1: 3, 2: 1 },
      owned: [FREE_DECOR_ID, 'dept-toys'],
      activeDecor: FREE_DECOR_ID,
      dailyStreak: { days: 3, lastDay: todayKey() },
      lastSeenDay: '',
      boosters: { hammer: 1, shuffle: 0, extraMove: 2, undo: 3 },
      upgrades: { 'dept-toys': 2 },
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: todayKey(), coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
    },
    settings: { sound: false, music: true, volume: 0.35 },
    daily: {
      date: todayKey(),
      counts: { matches: 12, levels: 1, golden: 0, bombs: 0, stars: 0 },
      claimed: [],
    },
    events: { id: '', day: '', counts: {}, claimed: [], finaleClaimed: false },
  };

  it('writes and reads the state again', async () => {
    await saveState(state);
    const loaded = await loadState();
    expect(loaded.progress).toEqual(state.progress);
    expect(loaded.settings).toEqual(state.settings);
    expect(loaded.daily).toEqual(state.daily);
    expect(loaded.progress.dailyStreak).toEqual(state.progress.dailyStreak);
    expect(loaded.progress.boosters).toEqual(state.progress.boosters);
  });

  it('forgets the counters of a previous day', async () => {
    await saveState({ ...state, daily: { ...state.daily, date: '2001-01-01', counts: { matches: 99, levels: 4, golden: 1, bombs: 2, stars: 9 } } });
    const loaded = await loadState();
    expect(loaded.daily.date).toBe(todayKey());
    expect(loaded.daily.counts.matches).toBe(0);
    expect(loaded.daily.counts.levels).toBe(0);
  });

  it('round trips the save stamp and treats a legacy save as unstamped', async () => {
    await saveState({ ...state, savedAt: 1_700_000_000_000 });
    const loaded = await loadState();
    expect(loaded.savedAt).toBe(1_700_000_000_000);

    // A save written before the cloud layer existed has no stamp at all.
    expect(migrate({ progress: state.progress, settings: state.settings }).savedAt).toBe(0);
    expect(migrate({ savedAt: 'вчера' }).savedAt).toBe(0);
  });

  it('keeps a marker of a deliberate progress reset', async () => {
    expect(await loadWipeMarker()).toBeNull();
    await setWipeMarker(1_700_000_000_000);
    expect(await loadWipeMarker()).toBe(1_700_000_000_000);
    await clearWipeMarker();
    expect(await loadWipeMarker()).toBeNull();
  });

  it('stores and drops the cloud mirror', async () => {
    expect(await loadCloudMirror()).toBeNull();
    await saveCloudMirror({ v: 1, savedAt: 5, state: { progress: { coins: 12 } } });
    expect(await loadCloudMirror()).toMatchObject({ v: 1, savedAt: 5 });
    await clearCloudMirror();
    expect(await loadCloudMirror()).toBeNull();
  });

  it('flushes a queued save on demand', async () => {
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem');
    const queue = createSaveQueue(5_000);
    queue.push({ ...state, savedAt: 42 });
    expect(setItem).not.toHaveBeenCalled();
    queue.flush();
    // `saveState` is async, but the write is already scheduled.
    await Promise.resolve();
    await Promise.resolve();
    const written = JSON.parse(globalThis.localStorage.getItem('shelf-sort:state') ?? '{}') as PersistedState;
    expect(written.savedAt).toBe(42);
  });

  it('ranks a real save above a blank one', () => {
    expect(progressRank(state.progress)).toBeGreaterThan(progressRank(migrate({}).progress));
  });

  it('clears the stored save', async () => {
    await saveState(state);
    await clearState();
    const loaded = await loadState();
    expect(loaded.progress.coins).toBe(0);
  });

  it('survives corrupted storage', async () => {
    globalThis.localStorage.setItem('shelf-sort:state', '{not json');
    const loaded = await loadState();
    expect(loaded.progress.coins).toBe(0);
    expect(loaded.progress.unlockedLevel).toBe(FIRST_LEVEL_ID);
  });

  it('debounces bursts of saves into one write', async () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem');
    const queue = createSaveQueue(400);

    queue.push(state);
    queue.push({ ...state, progress: { ...state.progress, coins: 100 } });
    queue.push({ ...state, progress: { ...state.progress, coins: 200 } });
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(450);
    await vi.runAllTimersAsync();

    expect(setItem).toHaveBeenCalledTimes(1);
    const written = JSON.parse(globalThis.localStorage.getItem('shelf-sort:state') ?? '{}') as PersistedState;
    expect(written.progress.coins).toBe(200);
  });
});
