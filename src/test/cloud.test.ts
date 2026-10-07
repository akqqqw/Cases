// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLOUD_KEY,
  MAX_CLOUD_BYTES,
  SYNC_TIE_MS,
  buildEnvelope,
  cloudBytes,
  cloudStatus,
  contentSignature,
  decideSync,
  initCloud,
  parseEnvelope,
  resetCloud,
  statsFor,
  subscribeCloud,
  syncCloudNow,
  authorizeCloud,
  noteLocalChange,
  flushCloud,
  type CloudEnvelope,
} from '../platform/cloud';
import { createMockSdk, type MockSdk } from '../platform/mock';
import { initPlatform, resetPlatform } from '../platform/yandex';
import {
  DEFAULT_PROGRESS,
  SAVE_VERSION,
  clearCloudMirror,
  clearState,
  clearWipeMarker,
  isBlankProgress,
  progressRank,
  setStorageAdapter,
  setWipeMarker,
  type PersistedState,
} from '../store/persistence';
import { DEFAULT_SETTINGS } from '../store/persistence';
import { clearTrustedTime } from '../data/clock';
import { DEFAULT_PLATFORM, useGameStore } from '../store/gameStore';

function save(patch: Partial<PersistedState['progress']> = {}, savedAt = 1_700_000_000_000): PersistedState {
  return {
    version: SAVE_VERSION,
    savedAt,
    progress: { ...DEFAULT_PROGRESS, levelStars: {}, owned: [...DEFAULT_PROGRESS.owned], ...patch },
    settings: { ...DEFAULT_SETTINGS },
    daily: { date: '2026-01-01', counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 }, claimed: [] },
    events: { id: '', day: '', counts: {}, claimed: [], finaleClaimed: false },
  };
}

const rich = (savedAt: number): PersistedState =>
  save({ levelStars: { 1: 3, 2: 2 }, unlockedLevel: 3, coins: 900, eventWins: ['sweet-week'] }, savedAt);

async function withMock(options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> {
  const mock = createMockSdk(options);
  mock.install(window);
  await initPlatform({ windowRef: window });
  return mock;
}

async function clean(): Promise<void> {
  resetCloud();
  resetPlatform();
  setStorageAdapter(null);
  clearTrustedTime();
  await clearCloudMirror();
  await clearWipeMarker();
  (window as unknown as { YaGames?: unknown }).YaGames = undefined;
  useGameStore.setState({
    platform: { ...DEFAULT_PLATFORM },
    cloud: {
      available: false,
      phase: 'idle',
      authorized: false,
      guest: true,
      playerId: null,
      playerName: null,
      lastSyncAt: null,
      dirty: false,
      reason: null,
      cloudSavedAt: null,
    },
  });
}

afterEach(clean);

describe('save ranking', () => {
  it('counts irreversible progress and ignores spendable things', () => {
    const base = save();
    expect(progressRank(base.progress)).toBe(progressRank(DEFAULT_PROGRESS));

    const withStars = save({ levelStars: { 1: 3, 2: 1 } });
    expect(progressRank(withStars.progress)).toBeGreaterThan(progressRank(base.progress));

    // Spending coins must not look like going backwards, otherwise a device
    // with a rich local save would be replaced by an old cloud save.
    const spent = save({ coins: 0 });
    expect(progressRank(spent.progress)).toBe(progressRank(base.progress));
    const richCoins = save({ coins: 5_000 });
    expect(progressRank(richCoins.progress)).toBe(progressRank(base.progress));

    expect(progressRank(save({ upgrades: { space: 3 } }).progress)).toBeGreaterThan(progressRank(base.progress));
    expect(progressRank(save({ mastery: { crowns: { 2: 3 }, best: { 2: 40 } } }).progress)).toBeGreaterThan(
      progressRank(base.progress),
    );
  });

  it('tells a blank save from a played one', () => {
    expect(isBlankProgress(DEFAULT_PROGRESS)).toBe(true);
    expect(isBlankProgress(save({ levelStars: { 1: 3 } }).progress)).toBe(false);
  });

  it('measures the size of a save against the SDK limit', () => {
    expect(cloudBytes(rich(1))).toBeLessThan(MAX_CLOUD_BYTES);
  });

  it('signs the content without its stamp', () => {
    expect(contentSignature(rich(1_000))).toBe(contentSignature(rich(9_999)));
    expect(contentSignature(rich(1_000))).not.toBe(contentSignature(save({ coins: 1 })));
  });
});

describe('cloud envelope', () => {
  it('round trips through the parser', () => {
    const envelope = buildEnvelope(rich(1_700_000_000_000), 'player-1');
    const parsed = parseEnvelope(JSON.parse(JSON.stringify(envelope)) as unknown);
    expect(parsed).not.toBeNull();
    expect(parsed?.playerId).toBe('player-1');
    expect(parsed?.savedAt).toBe(1_700_000_000_000);
    expect(parsed?.state.progress.levelStars).toEqual({ 1: 3, 2: 2 });
  });

  it('refuses garbage and saves of a future version', () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope('nope')).toBeNull();
    expect(parseEnvelope({ v: SAVE_VERSION + 5, state: rich(1) })).toBeNull();
    expect(parseEnvelope({ v: SAVE_VERSION })).toBeNull();
    // An unknown version from the past is migrated like a local save.
    const old = parseEnvelope({ v: 0, state: { progress: { coins: 120 } } });
    expect(old?.state.progress.coins).toBe(120);
  });

  it('stamps a save that has no stamp of its own', () => {
    clearTrustedTime();
    const envelope = buildEnvelope(save({}, 0), null);
    expect(envelope.savedAt).toBeGreaterThan(0);
    expect(envelope.state.savedAt).toBe(envelope.savedAt);
  });

  it('mirrors the numbers the leaderboards will read', () => {
    const stats = statsFor(save({ levelStars: { 1: 3, 2: 2 }, unlockedLevel: 4, coins: 55, mastery: { crowns: { 2: 3 }, best: { 2: 40 } } }));
    expect(stats.stars).toBe(5);
    expect(stats.level).toBe(4);
    expect(stats.coins).toBe(55);
    expect(stats.crowns).toBe(3);
    expect(stats.mastery).toBeGreaterThan(0);
  });
});

describe('sync decision', () => {
  const envelope = (state: PersistedState): CloudEnvelope => buildEnvelope(state, 'p1');

  it('creates the cloud copy when there is none', () => {
    expect(decideSync({ savedAt: 5, rank: 10 }, null)).toEqual({ action: 'push', reason: 'no-cloud' });
  });

  it('never lets an empty cloud save overwrite real progress', () => {
    const blank = envelope(save({}, 9_000_000_000_000));
    expect(decideSync({ savedAt: 1, rank: progressRank(rich(1).progress) }, blank)).toEqual({
      action: 'push',
      reason: 'blank-cloud',
    });
  });

  it('lets a fresh device pull the cloud save', () => {
    const cloud = envelope(rich(1_000));
    expect(decideSync({ savedAt: 1, rank: 0 }, cloud)).toEqual({ action: 'pull', reason: 'blank-local' });
  });

  it('resolves a legacy local save (no stamp) by progress, not by clock', () => {
    const cloud = envelope(rich(1_000));
    const cloudRank = progressRank(rich(1).progress);
    expect(decideSync({ savedAt: 0, rank: cloudRank + 5 }, cloud)).toEqual({
      action: 'push',
      reason: 'legacy-local',
    });
    expect(decideSync({ savedAt: 0, rank: cloudRank - 5 }, cloud)).toEqual({
      action: 'pull',
      reason: 'legacy-local',
    });
  });

  it('prefers the newer save and treats a few seconds as a tie', () => {
    const cloud = envelope(rich(1_000_000));
    // Both saves are "played" saves here: the timestamp rules must not depend
    // on one of them being blank.
    const cloudRank = progressRank(rich(1).progress);
    expect(decideSync({ savedAt: 1_000_000 + SYNC_TIE_MS + 1, rank: cloudRank }, cloud)).toEqual({
      action: 'push',
      reason: 'local-newer',
    });
    expect(decideSync({ savedAt: 1_000_000 - SYNC_TIE_MS - 1, rank: cloudRank }, cloud)).toEqual({
      action: 'pull',
      reason: 'cloud-newer',
    });

    // Inside the tie window the further save wins, whatever the clock says.
    expect(decideSync({ savedAt: 1_000_000, rank: cloudRank + 1 }, cloud)).toEqual({
      action: 'push',
      reason: 'local-kept',
    });
    expect(decideSync({ savedAt: 1_000_000, rank: cloudRank - 1 }, cloud)).toEqual({
      action: 'pull',
      reason: 'cloud-further',
    });
  });
});

describe('cloud session', () => {
  it('reports "disabled" without the platform', async () => {
    const status = await initCloud({ read: () => rich(1_000) });
    expect(status.available).toBe(false);
    expect(status.phase).toBe('disabled');
    expect(await flushCloud()).toMatchObject({ phase: 'disabled' });
    expect(await syncCloudNow()).toMatchObject({ phase: 'disabled' });
  });

  it('pushes the local save on the first sync', async () => {
    const mock = await withMock({ player: { id: 'p1' } });
    const status = await initCloud({ read: () => rich(1_700_000_000_000) });

    expect(status.available).toBe(true);
    expect(status.authorized).toBe(true);
    expect(status.playerId).toBe('p1');
    expect(status.phase).toBe('pushed');
    expect(status.dirty).toBe(false);

    const stored = mock.cloud[CLOUD_KEY] as CloudEnvelope;
    expect(stored.playerId).toBe('p1');
    expect(stored.state.progress.levelStars).toEqual({ 1: 3, 2: 2 });
    expect(mock.calls.setData).toBe(1);
    // The numeric mirror went to `setStats` as well.
    expect(mock.calls.setStats).toBe(1);
    expect(mock.cloud.stars).toBe(5);
  });

  it('pulls a newer cloud save into the game', async () => {
    const cloud = buildEnvelope(rich(2_000), 'p1');
    await withMock({ player: { id: 'p1', data: { [CLOUD_KEY]: cloud } } });

    let applied: PersistedState | null = null;
    const status = await initCloud({
      read: () => save({}, 1_000), // a fresh device
      apply: (state) => {
        applied = state;
      },
    });

    expect(status.phase).toBe('pulled');
    expect(status.reason).toBe('blank-local');
    expect(applied).not.toBeNull();
    expect(applied!.progress.levelStars).toEqual({ 1: 3, 2: 2 });
    expect(applied!.savedAt).toBe(2_000);
  });

  it('never overwrites a newer local save with an older cloud one', async () => {
    const cloud = buildEnvelope(save({ levelStars: { 1: 1 } }, 1_000), 'p1');
    const mock = await withMock({ player: { id: 'p1', data: { [CLOUD_KEY]: cloud } } });

    let applied = 0;
    const status = await initCloud({
      read: () => rich(9_000),
      apply: () => {
        applied += 1;
      },
    });

    expect(status.phase).toBe('pushed');
    expect(status.reason).toBe('local-newer');
    expect(applied).toBe(0);
    const stored = mock.cloud[CLOUD_KEY] as CloudEnvelope;
    expect(stored.state.progress.levelStars).toEqual({ 1: 3, 2: 2 });
  });

  it('takes the cloud save of another account instead of merging two players', async () => {
    const cloud = buildEnvelope(rich(1_000), 'other-player');
    await withMock({ player: { id: 'p1', data: { [CLOUD_KEY]: cloud } } });

    const status = await initCloud({ read: () => save({}, 500) });
    expect(status.phase).toBe('pulled');
    expect(status.reason).toBe('another-account');
  });

  it('keeps playing offline and retries later', async () => {
    const mock = await withMock({ player: { id: 'p1', failGet: true } });
    const status = await initCloud({ read: () => rich(1_000) });

    expect(status.available).toBe(true);
    expect(status.phase).toBe('offline');
    expect(status.dirty).toBe(true);

    // The network is back: the manual sync pushes the local save.
    mock.setOnline(true);
    const after = await syncCloudNow({ read: () => rich(1_000) });
    expect(after.phase).toBe('pushed');
    expect(mock.calls.setData).toBe(1);
  });

  it('survives an error from setData', async () => {
    await withMock({ player: { id: 'p1', failSet: true } });
    const status = await initCloud({ read: () => rich(1_000) });
    expect(status.phase).toBe('offline');
    expect(status.dirty).toBe(true);
  });

  it('records a deliberate reset and overwrites the cloud with it', async () => {
    const cloud = buildEnvelope(rich(5_000), 'p1');
    const mock = await withMock({ player: { id: 'p1', data: { [CLOUD_KEY]: cloud } } });

    // The player pressed "сбросить прогресс": the local save is empty and the
    // wipe marker is set, so the old cloud save must not come back.
    await setWipeMarker();
    const blank = save({}, 9_000);

    let applied = 0;
    const status = await initCloud({
      read: () => blank,
      apply: () => {
        applied += 1;
      },
    });

    expect(applied).toBe(0);
    expect(status.phase).toBe('pushed');
    expect(status.reason).toBe('local-wiped');
    expect((mock.cloud[CLOUD_KEY] as CloudEnvelope).state.progress.levelStars).toEqual({});
  });

  it('mirrors changes with a debounce and skips identical saves', async () => {
    vi.useFakeTimers();
    try {
      const mock = await withMock({ player: { id: 'p1' } });
      await initCloud({ read: () => save({}, 1_000) });
      expect(mock.calls.setData).toBe(1);

      // Nothing changed: no second write.
      noteLocalChange({ read: () => save({}, 1_000) });
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      expect(mock.calls.setData).toBe(1);

      // Real changes are pushed once, after the debounce.
      noteLocalChange({ read: () => save({ coins: 250 }, 2_000) });
      expect(cloudStatus().dirty).toBe(true);
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
      expect(mock.calls.setData).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the authorization dialog and syncs the profile', async () => {
    const mock = await withMock({ player: { authorized: false, id: 'guest-1' } });
    const before = await initCloud({ read: () => rich(1_000) });
    expect(before.guest).toBe(true);
    expect(before.authorized).toBe(false);

    const after = await authorizeCloud({ read: () => rich(1_000) });
    expect(mock.calls.authDialogs).toBe(1);
    expect(after.authorized).toBe(true);
    expect(after.guest).toBe(false);
    expect(after.playerName).toBe('Игрок');
  });

  it('uses the platform storage for the local fallback (iOS safe storage)', async () => {
    const mock = await withMock({ player: { id: 'p1' }, storage: true });
    expect(mock.calls.getPlayer).toBe(0);

    await initCloud({ read: () => rich(1_000) });

    // `saveState` now writes through the adapter when IndexedDB is missing.
    const { saveState } = await import('../store/persistence');
    await saveState(rich(1_000));
    const { loadState } = await import('../store/persistence');
    const loaded = await loadState();
    // Either IndexedDB (jsdom has none by default) or the adapter answered.
    expect(loaded.progress.levelStars).toEqual({ 1: 3, 2: 2 });
  });

  it('carries progress, shop and settings from one device to another', async () => {
    const mock = await withMock({ player: { id: 'p1', name: 'Игрок' } });

    // Device A: has played, pushes its save.
    const first = await initCloud({ read: () => ({ ...rich(1_700_000_000_000), settings: { sound: false, music: true, volume: 0.4 } }) });
    expect(first.phase).toBe('pushed');

    // Device B: a fresh install of the same account, nothing local.
    resetCloud();
    resetPlatform();
    mock.install(window);
    await initPlatform({ windowRef: window });

    let applied: PersistedState | null = null;
    const second = await initCloud({
      read: () => save({}, 1),
      apply: (state) => {
        applied = state;
      },
    });

    expect(second.phase).toBe('pulled');
    expect(applied).not.toBeNull();
    expect(applied!.progress.levelStars).toEqual({ 1: 3, 2: 2 });
    expect(applied!.progress.unlockedLevel).toBe(3);
    expect(applied!.progress.coins).toBe(900);
    expect(applied!.progress.eventWins).toEqual(['sweet-week']);
    expect(applied!.settings.sound).toBe(false);
    expect(applied!.settings.volume).toBe(0.4);
  });

  it('pulls a newer cloud save into the game store on hydrate', async () => {
    const cloud = buildEnvelope(rich(2_000), 'p1');
    await withMock({ player: { id: 'p1', data: { [CLOUD_KEY]: cloud } } });
    await clearState();

    await useGameStore.getState().hydrate();

    const state = useGameStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.progress.levelStars).toEqual({ 1: 3, 2: 2 });
    expect(state.cloud.phase).toBe('pulled');
    expect(state.cloud.playerId).toBe('p1');
    expect(state.progress.unlockedLevel).toBe(3);
  });

  it('marks the save dirty when the player makes progress', async () => {
    await withMock({ player: { id: 'p1' } });
    await clearState();
    await useGameStore.getState().hydrate();
    expect(useGameStore.getState().cloud.dirty).toBe(false);

    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        coins: useGameStore.getState().progress.coins + 120,
        levelStars: { ...useGameStore.getState().progress.levelStars, 1: 3 },
      },
    });

    expect(useGameStore.getState().cloud.dirty).toBe(true);
  });

  it('publishes the status to subscribers', async () => {
    await withMock({ player: { id: 'p1' } });
    const seen: string[] = [];
    const off = subscribeCloud((value) => seen.push(value.phase));
    await initCloud({ read: () => rich(1_000) });
    off();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe('pushed');
  });
});
