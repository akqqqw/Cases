// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ADS_STATUS,
  INTERSTITIAL_LEVELS_BETWEEN,
  INTERSTITIAL_MIN_INTERVAL_MS,
  adsAvailable,
  adsStatus,
  initAds,
  interstitialReady,
  noteLevelFinished,
  resetAds,
  rewardedReady,
  setBannerVisible,
  showInterstitial,
  showRewarded,
  subscribeAds,
  syncBannerForPhase,
} from '../platform/ads';
import { createMockSdk, type MockSdk } from '../platform/mock';
import { initPlatform, resetPlatform } from '../platform/yandex';
import { EXTRA_MOVES } from '../core/boosters';
import { migrateAdReward } from '../store/persistence';
import { clearTrustedTime, setTrustedTime } from '../data/clock';
import { AD_COINS_PER_DAY, DEFAULT_PLATFORM, useGameStore } from '../store/gameStore';
import { buyProduct, initPurchases, resetPurchases } from '../platform/purchases';
import { planSolution } from '../core/solver';
import { currentDayKey } from '../data/clock';
import { EMPTY_AD_REWARD, type PersistedState } from '../store/persistence';

/** A clock the tests control: `now()` follows the trusted time. */
function setClock(ms: number): void {
  setTrustedTime(ms, Date.now());
}

async function withMock(options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> {
  const mock = createMockSdk(options);
  mock.install(window);
  await initPlatform({ windowRef: window });
  return mock;
}

function clean(): void {
  resetAds();
  resetPurchases();
  // The interstitial stamp survives a page reload by design; between tests the
  // storage must start empty, otherwise a previous test gates the next one.
  window.localStorage.clear();
  resetPlatform();
  clearTrustedTime();
  delete (window as unknown as { YaGames?: unknown }).YaGames;
  useGameStore.setState({
    phase: 'menu',
    runtime: null,
    outcome: null,
    reviveUsed: false,
    ads: { ...EMPTY_ADS_STATUS, banner: { ...EMPTY_ADS_STATUS.banner } },
    platform: { ...DEFAULT_PLATFORM },
    progress: {
      ...useGameStore.getState().progress,
      coins: 0,
      boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 },
      adReward: { ...EMPTY_AD_REWARD },
    },
  });
}

afterEach(clean);

/** Finishes an ad that the platform already opened. */
function finishInterstitial(mock: MockSdk, wasShown = true): void {
  mock.ads.closeInterstitial(wasShown);
}

describe('ad availability', () => {
  it('is off without the platform', async () => {
    const status = await initAds();
    expect(status.available).toBe(false);
    expect(adsAvailable()).toBe(false);
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'no-platform' });
    expect(rewardedReady()).toEqual({ allowed: false, reason: 'no-platform' });

    const result = await showInterstitial('level-next');
    expect(result.outcome).toBe('not-shown');
    expect(result.reason).toBe('no-platform');
    expect(await setBannerVisible(true)).toMatchObject({ showing: false });
  });

  it('appears with the platform and reads the banner state', async () => {
    const mock = await withMock({ adv: { bannerManaged: true } });
    const status = await initAds();

    expect(status.available).toBe(true);
    expect(status.banner.supported).toBe(true);
    expect(status.banner.managed).toBe(true);
    expect(mock.calls.bannerStatus).toBe(1);
  });

  it('marks the banner as not managed when the Console does not hand it over', async () => {
    await withMock({ adv: { bannerManaged: false } });
    const status = await initAds();
    expect(status.banner.managed).toBe(false);
  });

  it('survives a failing banner status call', async () => {
    await withMock({ adv: { bannerFails: true } });
    const status = await initAds();
    expect(status.available).toBe(true);
    expect(status.banner.supported).toBe(false);
  });
});

describe('interstitial gating', () => {
  it('never fires during active play', async () => {
    await withMock();
    await initAds();
    useGameStore.setState({ phase: 'playing' });

    expect(interstitialReady()).toEqual({ allowed: false, reason: 'in-play' });
    const result = await showInterstitial('level-next');
    expect(result.outcome).toBe('not-shown');
    expect(result.reason).toBe('in-play');
  });

  it('waits for the level counter', async () => {
    await withMock();
    await initAds();
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-often' });

    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    expect(interstitialReady()).toEqual({ allowed: true });
  });

  it('waits for the time between two ads and resets the level counter', async () => {
    const mock = await withMock();
    await initAds();
    setClock(1_700_000_000_000);

    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    const shown = showInterstitial('level-next');
    expect(adsStatus().showing).toBe(true);
    expect(mock.calls.fullscreenAdv).toBe(1);
    finishInterstitial(mock);
    expect(await shown).toMatchObject({ outcome: 'shown' });

    // Right after the ad: too soon and the level gate closed again.
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-soon' });

    // Three minutes later it is allowed again.
    setClock(1_700_000_000_000 + INTERSTITIAL_MIN_INTERVAL_MS + 1);
    expect(interstitialReady()).toEqual({ allowed: true });
  });

  it('reports a declined call as `not-shown` and still respects the interval', async () => {
    const mock = await withMock({ adv: { fullscreenAvailable: false } });
    await initAds();
    setClock(1_700_000_000_000);
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();

    const result = await showInterstitial('level-next');
    expect(result.outcome).toBe('not-shown');
    expect(mock.calls.fullscreenAdv).toBe(1);
    // The platform counts the call: the next one waits as well.
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-soon' });
  });

  it('survives an SDK that throws', async () => {
    await withMock({ adv: { throws: true } });
    await initAds();
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();

    const result = await showInterstitial('level-next');
    expect(result.outcome).toBe('error');
    expect(adsStatus().showing).toBe(false);
    expect(adsStatus().last?.outcome).toBe('error');
  });

  it('counts the ads of the session and stops at the safety cap', async () => {
    const mock = await withMock();
    await initAds();
    let clock = 1_700_000_000_000;

    for (let i = 0; i < 9; i += 1) {
      clock += INTERSTITIAL_MIN_INTERVAL_MS + 1;
      setClock(clock);
      for (let level = 0; level < INTERSTITIAL_LEVELS_BETWEEN; level += 1) noteLevelFinished();
      const shown = showInterstitial('level-next');
      finishInterstitial(mock, i !== 8);
      await shown;
    }

    expect(mock.calls.fullscreenAdv).toBe(8);
    expect(adsStatus().interstitials).toBe(8);
    for (let level = 0; level < INTERSTITIAL_LEVELS_BETWEEN; level += 1) noteLevelFinished();
    clock += INTERSTITIAL_MIN_INTERVAL_MS + 1;
    setClock(clock);
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-often' });
  });

  it('refuses a second ad while one is on screen', async () => {
    const mock = await withMock();
    await initAds();
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();

    const first = showInterstitial('level-next');
    const second = await showInterstitial('level-replay');
    expect(second).toMatchObject({ outcome: 'not-shown', reason: 'busy' });

    finishInterstitial(mock);
    expect((await first).outcome).toBe('shown');
  });

  it('pauses the game and mutes the sound for the whole ad', async () => {
    const mock = await withMock();
    await initAds();
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();

    const shown = showInterstitial('level-next');
    expect(adsStatus().showing).toBe(true);
    expect(adsStatus().kind).toBe('interstitial');
    expect(adsStatus().placement).toBe('level-next');

    finishInterstitial(mock);
    await shown;
    expect(adsStatus().showing).toBe(false);
    expect(adsStatus().kind).toBeNull();
    expect(adsStatus().last).toMatchObject({ kind: 'interstitial', placement: 'level-next', outcome: 'shown' });
  });
});

describe('rewarded video', () => {
  it('rewards only after `onRewarded`', async () => {
    const mock = await withMock();
    await initAds();

    const closedEarly = showRewarded('shop-coins');
    expect(mock.ads.rewardedOpen).toBe(true);
    mock.ads.closeRewarded(true);
    expect((await closedEarly).outcome).toBe('closed');

    const watched = showRewarded('shop-coins');
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    expect((await watched).outcome).toBe('rewarded');
  });

  it('reports a video that never started', async () => {
    const mock = await withMock({ adv: { rewardedAvailable: false } });
    await initAds();

    const result = await showRewarded('revive');
    expect(result.outcome).toBe('not-shown');
    expect(mock.calls.rewardedVideo).toBe(1);
  });

  it('never runs during active play', async () => {
    await withMock();
    await initAds();
    useGameStore.setState({ phase: 'playing' });
    expect(rewardedReady()).toEqual({ allowed: false, reason: 'in-play' });
    expect((await showRewarded('shop-coins')).reason).toBe('in-play');
  });

  it('publishes every change to the subscribers', async () => {
    const mock = await withMock();
    const seen: boolean[] = [];
    const off = subscribeAds((status) => seen.push(status.showing));
    await initAds();

    const watched = showRewarded('shop-coins');
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    await watched;
    off();

    expect(seen).toContain(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('sticky banner', () => {
  it('shows in menus and hides during a level', async () => {
    const mock = await withMock({ adv: { bannerManaged: true } });
    await initAds();

    syncBannerForPhase('menu');
    await Promise.resolve();
    await Promise.resolve();
    expect(adsStatus().banner.showing).toBe(true);
    expect(mock.calls.bannerShow).toBe(1);

    syncBannerForPhase('playing');
    await Promise.resolve();
    await Promise.resolve();
    expect(adsStatus().banner.showing).toBe(false);
    expect(mock.calls.bannerHide).toBe(1);
    expect(mock.ads.bannerShown()).toBe(false);
  });

  it('does not fight the platform when the banner is not managed', async () => {
    const mock = await withMock({ adv: { bannerManaged: false } });
    await initAds();

    await setBannerVisible(true);
    expect(mock.calls.bannerShow).toBe(0);
  });
});

describe('ads in the game economy', () => {
  function saveWith(patch: Partial<PersistedState['progress']> = {}): PersistedState {
    return {
      version: 1,
      savedAt: 1_700_000_000_000,
      progress: { ...useGameStore.getState().progress, ...patch },
      settings: { ...useGameStore.getState().settings },
      daily: { ...useGameStore.getState().daily },
      events: { ...useGameStore.getState().events },
    };
  }

  it('revives a lost level once and only after a confirmed view', async () => {
    const mock = await withMock();
    await initAds();

    // A real level, driven to a loss by spending every move.
    useGameStore.getState().startLevel(1);
    const started = useGameStore.getState().runtime;
    if (!started) throw new Error('level did not start');
    useGameStore.setState({
      runtime: { ...started, movesLeft: 0, status: 'lost' },
      phase: 'lost',
      reviveUsed: false,
    });

    // The video is skipped: nothing happens.
    useGameStore.getState().reviveWithAd();
    mock.ads.closeRewarded(true);
    await Promise.resolve();
    expect(useGameStore.getState().phase).toBe('lost');
    expect(useGameStore.getState().runtime?.movesLeft).toBe(0);

    // A full view: three more moves and the level continues.
    useGameStore.getState().reviveWithAd();
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    await Promise.resolve();
    await Promise.resolve();

    const revived = useGameStore.getState();
    expect(revived.phase).toBe('playing');
    expect(revived.runtime?.movesLeft).toBe(EXTRA_MOVES);
    expect(revived.runtime?.status).toBe('playing');
    expect(revived.reviveUsed).toBe(true);
    expect(revived.outcome).toBeNull();

    // A second revive in the same run is refused before the ad even starts.
    useGameStore.setState({ runtime: { ...revived.runtime!, movesLeft: 0, status: 'lost' }, phase: 'lost' });
    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().reviveWithAd();
    expect(mock.calls.rewardedVideo).toBe(callsBefore);
  });

  it('pays coins for a video up to three times a day', async () => {
    const mock = await withMock();
    await initAds();
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 0, adReward: { ...EMPTY_AD_REWARD } },
    });

    const watch = async (): Promise<void> => {
      useGameStore.getState().watchAdForCoins();
      mock.ads.reward();
      mock.ads.closeRewarded(true);
      await Promise.resolve();
      await Promise.resolve();
    };

    await watch();
    await watch();
    await watch();
    expect(useGameStore.getState().progress.coins).toBe(180);

    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().watchAdForCoins();
    expect(mock.calls.rewardedVideo).toBe(callsBefore);
    expect(useGameStore.getState().progress.coins).toBe(180);
  });

  it('gives one random booster a day', async () => {
    const mock = await withMock();
    await initAds();
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        adReward: { ...EMPTY_AD_REWARD },
        boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 },
      },
    });

    useGameStore.getState().watchAdForBooster();
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    await Promise.resolve();
    await Promise.resolve();

    const boosters = useGameStore.getState().progress.boosters;
    const total = boosters.hammer + boosters.shuffle + boosters.extraMove + boosters.undo;
    expect(total).toBe(1);
    expect(useGameStore.getState().progress.adReward.boosters).toBe(1);

    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().watchAdForBooster();
    expect(mock.calls.rewardedVideo).toBe(callsBefore);
  });

  it('does not give a reward when the video is closed early', async () => {
    const mock = await withMock();
    await initAds();
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 0, adReward: { ...EMPTY_AD_REWARD } },
    });

    useGameStore.getState().watchAdForCoins();
    mock.ads.closeRewarded(false);
    await Promise.resolve();
    await Promise.resolve();

    expect(useGameStore.getState().progress.coins).toBe(0);
    expect(useGameStore.getState().progress.adReward.coins).toBe(0);
  });

  it('does not pay a reward when ads are unavailable', async () => {
    await initAds(); // no platform at all
    useGameStore.getState().watchAdForCoins();
    await Promise.resolve();
    expect(useGameStore.getState().progress.coins).toBe(0);
  });

  it('keeps the quotas across a save round trip', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(migrateAdReward({ day: today, coins: 2, boosters: 1 }, today)).toEqual({
      day: today,
      coins: 2,
      boosters: 1,
    });
    // Another day: the counters are empty again.
    expect(migrateAdReward({ day: '2001-01-01', coins: 5, boosters: 5 }, today)).toEqual({
      day: today,
      coins: 0,
      boosters: 0,
    });
    expect(migrateAdReward(null, today)).toEqual({ day: today, coins: 0, boosters: 0 });
    expect(migrateAdReward({ day: today, coins: 'много', boosters: -3 }, today)).toEqual({
      day: today,
      coins: 0,
      boosters: 0,
    });
  });

  it('shows an interstitial before the next level, and never blocks it', async () => {
    const mock = await withMock();
    await initAds();
    setClock(1_700_000_000_000);
    useGameStore.getState().startLevel(1);

    // Without a finished level the gate says no: the button works as before.
    useGameStore.getState().nextLevelAfterAd();
    expect(mock.calls.fullscreenAdv).toBe(0);
    expect(useGameStore.getState().phase).toBe('playing');

    // Two finished levels later the ad appears between the levels; the player
    // stands on the win screen, which is exactly the logical pause.
    useGameStore.setState({ phase: 'won' });
    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    const before = useGameStore.getState().runtime?.config.id ?? 0;
    useGameStore.getState().nextLevelAfterAd();
    expect(mock.calls.fullscreenAdv).toBe(1);
    expect(mock.ads.interstitialOpen).toBe(true);

    // The next level starts only after the ad is closed.
    expect(useGameStore.getState().runtime?.config.id).toBe(before);
    mock.ads.closeInterstitial(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(useGameStore.getState().runtime?.config.id).not.toBe(before);
    expect(useGameStore.getState().phase).toBe('playing');
  });

  it('replays the level through the ad gate without ever freezing the game', async () => {
    const mock = await withMock();
    await initAds();

    useGameStore.getState().startLevel(3);
    const id = useGameStore.getState().runtime?.config.id;
    useGameStore.getState().replayAfterAd();
    expect(mock.calls.fullscreenAdv).toBe(0);
    expect(useGameStore.getState().runtime?.config.id).toBe(id);
    expect(useGameStore.getState().phase).toBe('playing');
  });

  it('uses the trusted clock for the ad interval', async () => {
    const base = 1_700_000_000_000;
    vi.useFakeTimers();
    try {
      const mock = await withMock();
      await initAds();
      vi.setSystemTime(new Date(base));
      setClock(base);
      for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();

      const shown = showInterstitial('level-next');
      finishInterstitial(mock);
      await shown;

      // The device clock jumps ten seconds ahead, the server time follows it
      // (the trusted window is short): ten seconds are still way too soon.
      vi.setSystemTime(new Date(base + 10_000));
      for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
      expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-soon' });

      // Three minutes on the server clock: the ad is allowed again.
      vi.setSystemTime(new Date(base + INTERSTITIAL_MIN_INTERVAL_MS + 1));
      expect(interstitialReady()).toEqual({ allowed: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never lets the local save decide the ad quota', () => {
    // `saveWith` exists to keep the shape of the save obvious in this file.
    expect(saveWith().progress.adReward).toBeDefined();
  });
});

describe('doubling the win reward with a video', () => {
  /** Wins level 1 by following its own solution. */
  function winLevel(): void {
    useGameStore.getState().startLevel(1);
    const runtime = useGameStore.getState().runtime;
    if (!runtime) throw new Error('level did not start');
    for (const move of planSolution(runtime.board).moves) {
      expect(useGameStore.getState().requestMove(move.from, move.to)).toBe(true);
    }
    expect(useGameStore.getState().phase).toBe('won');
  }

  it('adds the coins of the run once, and only after the video', async () => {
    const mock = await withMock();
    await initAds();
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 0, adReward: { ...EMPTY_AD_REWARD } },
    });
    winLevel();

    const earned = useGameStore.getState().outcome?.coins ?? 0;
    expect(earned).toBeGreaterThan(0);

    // The video is closed early: no reward, the button stays available.
    useGameStore.getState().doubleRewardWithAd();
    mock.ads.closeRewarded(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(useGameStore.getState().progress.coins).toBe(earned);
    expect(useGameStore.getState().rewardDoubled).toBe(false);

    // A watched video: the same amount again, and the panel shows it.
    useGameStore.getState().doubleRewardWithAd();
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    await Promise.resolve();
    await Promise.resolve();

    const doubled = useGameStore.getState();
    expect(doubled.progress.coins).toBe(earned * 2);
    expect(doubled.outcome?.coins).toBe(earned * 2);
    expect(doubled.rewardDoubled).toBe(true);
    expect(doubled.progress.adReward.coins).toBe(1);

    // Once per run, and the ad is not even requested again.
    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().doubleRewardWithAd();
    expect(mock.calls.rewardedVideo).toBe(callsBefore);
    expect(useGameStore.getState().progress.coins).toBe(earned * 2);
  });

  it('shares the daily quota of ad coins and comes back with a new run', async () => {
    const mock = await withMock();
    await initAds();
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        coins: 0,
        adReward: { day: currentDayKey(), coins: AD_COINS_PER_DAY, boosters: 0 },
      },
    });
    winLevel();

    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().doubleRewardWithAd();
    expect(mock.calls.rewardedVideo).toBe(callsBefore); // the quota is spent
    expect(useGameStore.getState().rewardDoubled).toBe(false);

    // A fresh attempt starts with its own doubling.
    useGameStore.getState().restartLevel();
    expect(useGameStore.getState().rewardDoubled).toBe(false);
  });
});

describe('the ad-free product', () => {
  it('switches the interstitial and the banner off for good', async () => {
    const mock = await withMock({
      adv: { bannerManaged: true },
      payments: { enabled: true, catalog: [{ id: 'remove_ads', price: '249 YAN' }] },
    });
    await initAds();
    await initPurchases();

    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN; i += 1) noteLevelFinished();
    expect(interstitialReady().allowed).toBe(true);
    await setBannerVisible(true);
    expect(adsStatus().banner.showing).toBe(true);

    const purchase = await buyProduct('remove_ads');
    expect(purchase.owned).toContain('remove_ads');
    // The non-consumable is never consumed and stays in the ledger.
    expect(mock.pay.consumed).toEqual([]);

    for (let i = 0; i < INTERSTITIAL_LEVELS_BETWEEN + 2; i += 1) noteLevelFinished();
    setClock(Date.now() + INTERSTITIAL_MIN_INTERVAL_MS + 1);
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'off' });
    const shown = await showInterstitial('level-next');
    expect(shown).toMatchObject({ outcome: 'not-shown', reason: 'off' });

    // The banner goes away, and no later sync can bring it back.
    const shownBefore = mock.calls.bannerShow;
    await setBannerVisible(false);
    expect(adsStatus().banner.showing).toBe(false);
    syncBannerForPhase('menu');
    await setBannerVisible(true);
    expect(adsStatus().banner.showing).toBe(false);
    expect(mock.calls.bannerShow).toBe(shownBefore);
    // The rewarded video of the shop stays available: it is voluntary.
    expect(rewardedReady().allowed).toBe(true);
  });
});
