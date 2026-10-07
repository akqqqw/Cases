// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planSolution } from '../core/solver';
import { EMPTY_WEEK, bumpWeek, weekKeyFor, weekStars } from '../data/weeks';
import {
  BOARD_IDS,
  ENTRIES_LIMIT,
  SENT_KEY,
  SCORE_MIN_INTERVAL_MS,
  boardScores,
  connectLeaderboards,
  emptyLeaderboardStatus,
  initLeaderboards,
  leaderboardStatus,
  loadBoard,
  publishScores,
  resetLeaderboards,
  subscribeLeaderboards,
} from '../platform/leaderboards';
import { createMockSdk, type MockSdk } from '../platform/mock';
import { initPlatform, resetPlatform } from '../platform/yandex';
import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  SAVE_VERSION,
  migrateWeek,
  type PersistedState,
} from '../store/persistence';
import { DEFAULT_PLATFORM, useGameStore } from '../store/gameStore';

// ------------------------------------------------------------------ helpers

function save(patch: Partial<PersistedState['progress']> = {}): PersistedState {
  return {
    version: SAVE_VERSION,
    savedAt: 1_700_000_000_000,
    progress: { ...DEFAULT_PROGRESS, levelStars: {}, owned: [...DEFAULT_PROGRESS.owned], ...patch },
    settings: { ...DEFAULT_SETTINGS },
    daily: { date: '2026-10-06', counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 }, claimed: [] },
    events: { id: '', day: '', counts: {}, claimed: [], finaleClaimed: false },
  };
}

/** The host the store usually provides — the tests inject their own. */
function hostOf(state: () => PersistedState, authorized = true, playerId: string | null = 'mock-player-1') {
  return {
    read: () => state(),
    authorized: () => authorized,
    playerId: () => playerId,
  };
}

async function withMock(options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> {
  const mock = createMockSdk(options);
  mock.install(window);
  await initPlatform({ windowRef: window });
  return mock;
}

async function clean(): Promise<void> {
  resetLeaderboards();
  resetPlatform();
  (window as unknown as { YaGames?: unknown }).YaGames = undefined;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  useGameStore.setState({ platform: { ...DEFAULT_PLATFORM } });
}

// ------------------------------------------------------------ pure helpers

describe('the week counter', () => {
  it('numbers weeks like ISO-8601 (Monday first, Thursday owns the year)', () => {
    expect(weekKeyFor('2026-10-06')).toBe('2026-W41');
    expect(weekKeyFor('2026-10-11')).toBe('2026-W41'); // Sunday closes the week
    expect(weekKeyFor('2026-10-12')).toBe('2026-W42'); // Monday opens the next one
    expect(weekKeyFor('2026-01-05')).toBe('2026-W02');
    expect(weekKeyFor('2025-12-29')).toBe('2026-W01'); // the week belongs to 2026
    expect(weekKeyFor('2024-12-30')).toBe('2025-W01');
    expect(weekKeyFor('nonsense')).toBe('');
    expect(weekKeyFor('2026-13-45')).toBe('');
  });

  it('counts stars of the running week and keeps the record', () => {
    let week = bumpWeek(EMPTY_WEEK, '2026-10-06', 3);
    expect(week).toEqual({ key: '2026-W41', stars: 3, best: 3 });

    week = bumpWeek(week, '2026-10-07', 2);
    expect(week).toEqual({ key: '2026-W41', stars: 5, best: 5 });
    expect(weekStars(week, '2026-10-07')).toBe(5);
    expect(weekStars(week, '2026-10-13')).toBe(0);

    // A new week starts from zero but the record stays.
    week = bumpWeek(week, '2026-10-13', 1);
    expect(week).toEqual({ key: '2026-W42', stars: 1, best: 5 });

    // Playing without improving still moves the counter into the new week.
    const next = bumpWeek(week, '2026-10-20', 0);
    expect(next).toEqual({ key: '2026-W43', stars: 0, best: 5 });

    // A broken day never touches the record.
    expect(bumpWeek(week, '', 4)).toEqual(week);
    // Nothing can go below zero.
    expect(bumpWeek({ key: '2026-W41', stars: -5, best: 2 }, '2026-10-06', -3)).toEqual({
      key: '2026-W41',
      stars: 0,
      best: 2,
    });
  });
});

describe('board scores', () => {
  it('sums mastery points, counts three-star levels and reads the week record', () => {
    const scores = boardScores({
      levelStars: { 1: 3, 2: 2, 3: 3, 4: 1 },
      mastery: { best: { 1: 40, 2: 12, 3: 0 } },
      weeks: { key: '2026-W41', stars: 4, best: 27 },
    });

    expect(scores).toEqual({ mastery: 52, stars3: 2, week: 27 });
  });

  it('stays at zero for a fresh save and never sends a negative score', () => {
    const blank = boardScores({ levelStars: {}, mastery: { best: {} }, weeks: { ...EMPTY_WEEK } });
    expect(blank).toEqual({ mastery: 0, stars3: 0, week: 0 });

    const broken = boardScores({
      levelStars: { 1: 3 },
      mastery: { best: { 1: -100 } },
      weeks: { key: '', stars: -3, best: -8 },
    });
    expect(broken).toEqual({ mastery: 0, stars3: 1, week: 0 });
  });
});

describe('week migration', () => {
  it('accepts a real record and repairs a broken one', () => {
    expect(migrateWeek({ key: '2026-W41', stars: 5, best: 12 })).toEqual({ key: '2026-W41', stars: 5, best: 12 });
    // `best` can never be below the running week.
    expect(migrateWeek({ key: '2026-W41', stars: 9, best: 2 })).toEqual({ key: '2026-W41', stars: 9, best: 9 });
    expect(migrateWeek(undefined)).toEqual(EMPTY_WEEK);
    expect(migrateWeek({ key: 'week 41', stars: 'x', best: -4 })).toEqual(EMPTY_WEEK);
    expect(migrateWeek({ key: '2026-W41', stars: 1e12, best: 1e12 }).stars).toBeLessThanOrEqual(999_999);
  });
});

// ---------------------------------------------------------- without platform

describe('leaderboards without a platform', () => {
  beforeEach(clean);
  afterEach(clean);

  it('reports itself as disabled and never touches the network', async () => {
    const status = await initLeaderboards();
    expect(status.phase).toBe('disabled');
    expect(status.reason).toBe('no-platform');
    expect(status.available).toBe(false);

    // The screen still opens and simply says why the table is empty.
    const view = await loadBoard('mastery');
    expect(view.entries).toEqual([]);
    expect(view.phase).toBe('unavailable');
  });

  it('publishes nothing for a guest session', async () => {
    const status = await publishScores();
    expect(status.reason).toBeNull();
    expect(status.sent).toEqual({ mastery: 0, stars3: 0, week: 0 });
  });
});

// ------------------------------------------------------------- with platform

describe('leaderboards on the platform', () => {
  let mock: MockSdk;
  let state: PersistedState;

  beforeEach(async () => {
    await clean();
    state = save({
      levelStars: { 1: 3, 2: 3, 3: 2 },
      mastery: { crowns: {}, best: { 1: 40, 2: 15 } },
      weeks: { key: '2026-W41', stars: 5, best: 12 },
    });
  });

  afterEach(async () => {
    await clean();
    vi.useRealTimers();
  });

  async function boot(options: Parameters<typeof createMockSdk>[0] = {}, authorized = true): Promise<void> {
    mock = await withMock({ player: { authorized }, ...options });
    connectLeaderboards(hostOf(() => state, authorized));
    await initLeaderboards();
    await publishScores(); // init fires the publish in the background; wait for it
  }

  it('sends only the boards that improved', async () => {
    await boot();
    await publishScores();

    expect(mock.calls.lbSetScore).toBe(3);
    expect(mock.lb.sent.shelf_mastery).toEqual([55]);
    expect(mock.lb.sent.shelf_stars3).toEqual([2]);
    expect(mock.lb.sent.shelf_week).toEqual([12]);

    // Nothing changed — no request at all.
    const before = mock.calls.lbSetScore;
    await publishScores();
    expect(mock.calls.lbSetScore).toBe(before);

    // One better level: exactly one board moves.
    state = save({
      levelStars: { 1: 3, 2: 3, 3: 3 },
      mastery: { crowns: {}, best: { 1: 40, 2: 15 } },
      weeks: { key: '2026-W41', stars: 5, best: 12 },
    });
    await publishScores();
    expect(mock.calls.lbSetScore).toBe(before + 1);
    expect(mock.lb.sent.shelf_stars3).toEqual([2, 3]);
  });

  it(
    'keeps the one-request-per-second limit of setScore',
    async () => {
      // A fresh browser: nothing was ever sent, all three boards improved.
      mock = await withMock({ player: { authorized: true } });
      connectLeaderboards(hostOf(() => state, true));

      const started = Date.now();
      await initLeaderboards();
      const status = await publishScores();
      const elapsed = Date.now() - started;

      expect(status.phase).toBe('ready');
      expect(mock.calls.lbSetScore).toBe(3);
      expect(elapsed).toBeGreaterThanOrEqual(SCORE_MIN_INTERVAL_MS * 2);
    },
    20_000,
  );

  it('does not ask for a score while the player is a guest', async () => {
    await boot({}, false);
    expect(mock.calls.lbSetScore).toBe(0);
    expect(leaderboardStatus().authorized).toBe(false);
    expect(leaderboardStatus().reason).toBe('unauthorized');
  });

  it('respects the availability check of the platform', async () => {
    await boot({ leaderboards: { canSetScore: false } });
    expect(mock.calls.lbAvailableChecks).toBeGreaterThan(0);
    expect(mock.calls.lbSetScore).toBe(0);
    expect(leaderboardStatus().phase).toBe('unavailable');
  });

  it('explains a missing table instead of failing', async () => {
    await boot({ leaderboards: { missing: true } });
    expect(leaderboardStatus().phase).toBe('no-board');
    expect(leaderboardStatus().reason).toBe('no-board');

    const view = await loadBoard('mastery');
    expect(view.phase).toBe('no-board');
  });

  it('survives a broken network and keeps the scores for later', async () => {
    await boot({ leaderboards: { fail: true } });
    expect(leaderboardStatus().phase).toBe('error');
    expect(mock.calls.lbSetScore).toBeGreaterThan(0);

    // The platform came back: a new session sends the values again.
    const working = await withMock({ player: { authorized: true } });
    await initLeaderboards();
    await publishScores();
    expect(working.lb.sent.shelf_mastery).toEqual([55]);
    expect(leaderboardStatus().phase).toBe('ready');
  });

  it('loads a table with names, avatars and the player rank', async () => {
    await boot({ leaderboards: { seeded: { shelf_mastery: [['Аня', 300], ['Борис', 120]] } } });
    const view = await loadBoard('mastery');

    expect(view.phase).toBe('ready');
    expect(view.entries.map((entry) => entry.name)).toEqual(['Аня', 'Борис', 'Игрок']);
    expect(view.entries.map((entry) => entry.score)).toEqual([300, 120, 55]);
    expect(view.entries[2]?.self).toBe(true);
    expect(view.entries[0]?.avatar).toContain('example.com');
    expect(view.entries[0]?.rank).toBe(1);
    expect(view.userRank).toBe(3);
  });

  it('caches a loaded table and refreshes it only on demand', async () => {
    await boot({ leaderboards: { seeded: { shelf_stars3: [['Аня', 9]] } } });
    const first = await loadBoard('stars3');
    const second = await loadBoard('stars3');
    expect(second).toBe(first);
    const calls = mock.calls.lbEntries;

    await loadBoard('stars3', { force: true });
    expect(mock.calls.lbEntries).toBe(calls + 1);
  });

  it('still shows the top to a guest, just without a place', async () => {
    await boot({ leaderboards: { seeded: { shelf_week: [['Аня', 40]] } } }, false);
    const view = await loadBoard('week');
    expect(view.entries.map((entry) => entry.name)).toEqual(['Аня']);
    expect(view.userRank).toBe(0);
  });

  it('notifies subscribers and remembers the published scores across reloads', async () => {
    const seen: string[] = [];
    const off = subscribeLeaderboards((value) => seen.push(value.phase));
    await boot();
    expect(seen).toContain('ready');
    expect(leaderboardStatus().reason).toBe('sent');
    off();

    expect(window.localStorage.getItem(SENT_KEY)).toContain('"mastery":55');

    // A reload keeps the marks: the same scores are not sent a second time.
    const before = mock.calls.lbSetScore;
    resetLeaderboards();
    await initLeaderboards();
    await publishScores();
    expect(mock.calls.lbSetScore).toBe(before);

    // ...unless the marks are gone (another browser): then they go again.
    window.localStorage.removeItem(SENT_KEY);
    resetLeaderboards();
    await initLeaderboards();
    await publishScores();
    expect(mock.calls.lbSetScore).toBeGreaterThan(before);
  });

  it('keeps a reserve of the getEntries budget (20 requests per 5 minutes)', async () => {
    await boot({ leaderboards: { seeded: { shelf_week: [['Аня', 40]] } } });
    await loadBoard('week');
    const calls = mock.calls.lbEntries;

    // A player who hammers «Обновить»: every forced read is a request, but the
    // module stops calling the SDK once the window is full and keeps the rows.
    for (let index = 0; index < ENTRIES_LIMIT + 3; index += 1) {
      await loadBoard('week', { force: true });
    }

    // The first read already used one slot of the window.
    expect(mock.calls.lbEntries).toBe(calls + ENTRIES_LIMIT - 1);
    expect(leaderboardStatus().boards.week.phase).toBe('too-often');
    // The rows of the last successful read stay on screen.
    expect(leaderboardStatus().boards.week.entries.length).toBeGreaterThan(0);
  });

  it('hands the platform the technical names from the Console', async () => {
    await boot();
    expect(mock.lb.board('shelf_mastery')[0]?.score).toBe(55);
    expect(mock.lb.board('shelf_stars3')[0]?.score).toBe(2);
    expect(BOARD_IDS).toEqual(['mastery', 'stars3', 'week']);
    expect(emptyLeaderboardStatus().boards.mastery.phase).toBe('idle');
  });
});

// --------------------------------------------------------------- integration

describe('the game publishes the ranking', () => {
  afterEach(async () => {
    await clean();
  });

  it('feeds a won level into the weekly record and the platform', async () => {
    const mock = await withMock({ player: { authorized: true } });
    // The store host reads the real state: a signed-in player with a session.
    useGameStore.setState({
      cloud: { ...useGameStore.getState().cloud, available: true, authorized: true, playerId: 'mock-player-1' },
      progress: { ...DEFAULT_PROGRESS, levelStars: {}, owned: [...DEFAULT_PROGRESS.owned] },
      phase: 'menu',
      runtime: null,
    });
    connectLeaderboards(hostOf(() => save({}), false)); // the tests' host is replaced below
    resetLeaderboards();
    await initPlatform({ windowRef: window });

    // Swap the test host for the real store host (as the game does at load).
    connectLeaderboards({
      read: () => {
        const state = useGameStore.getState();
        return save(state.progress);
      },
      authorized: () => useGameStore.getState().cloud.authorized,
      playerId: () => useGameStore.getState().cloud.playerId,
    });
    await initLeaderboards();

    const store = useGameStore.getState();
    store.startLevel(1);
    const runtime = useGameStore.getState().runtime;
    expect(runtime).toBeTruthy();
    for (const move of planSolution(runtime!.board).moves) {
      useGameStore.getState().requestMove(move.from, move.to);
    }

    const after = useGameStore.getState();
    expect(after.phase).toBe('won');
    expect(after.progress.weeks.stars).toBeGreaterThan(0);
    expect(after.progress.weeks.best).toBe(after.progress.weeks.stars);
    expect(after.progress.weeks.key).toBe(weekKeyFor(after.daily.date));

    await publishScores();
    const scores = boardScores(after.progress);
    expect(scores.stars3).toBe(1);
    expect(mock.lb.sent.shelf_stars3).toEqual([1]);
    expect(mock.lb.sent.shelf_week).toEqual([after.progress.weeks.best]);
    expect(mock.calls.lbSetScore).toBeGreaterThanOrEqual(2);
  });
});
