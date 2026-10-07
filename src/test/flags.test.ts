// @vitest-environment jsdom
/**
 * Remote configuration (the Console «Флаги» tab) — `platform/flags.ts`.
 *
 * The docs (`sdk-config`) ask for one request at startup, `defaultFlags` as the
 * built-in configuration and `clientFeatures` as the target of the experiment.
 * The tests pin the merge order (query → remote → cache → local), the clamping
 * of every numeric flag and the fact that the game keeps working without the
 * platform at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FLAGS_CACHE_KEY,
  LOCAL_FLAGS,
  clampFlag,
  clientFeatures,
  emptyFlagsStatus,
  flagNumber,
  flags,
  flagsFromQuery,
  flagsStatus,
  initFlags,
  mergeFlags,
  resetFlags,
  sanitizeFlags,
  subscribeFlags,
  valuesFrom,
} from '../platform/flags';
import { EMPTY_AD_REWARD } from '../store/persistence';
import { useGameStore } from '../store/gameStore';
import { initAds, interstitialReady, noteLevelFinished, resetAds } from '../platform/ads';
import { planSolution } from '../core/solver';
import { createMockSdk, type MockSdk } from '../platform/mock';
import { initPlatform, resetPlatform } from '../platform/yandex';
import { setLang } from '../platform/i18n';

async function withMock(options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> {
  const mock = createMockSdk(options);
  mock.install(window);
  await initPlatform({ windowRef: window });
  return mock;
}

function clean(): void {
  resetFlags();
  resetAds();
  resetPlatform();
  window.localStorage.clear();
  delete (window as unknown as { YaGames?: unknown }).YaGames;
  setLang('ru', 'default');
}

afterEach(clean);

describe('local configuration', () => {
  it('embeds the defaults of the game — the same values the constants use', () => {
    expect(LOCAL_FLAGS).toMatchObject({
      ads_min_interval_min: '3',
      ads_levels_between: '2',
      ads_max_per_session: '8',
      ad_reward_coins: '60',
      ad_rewards_per_day: '3',
      coins_multiplier: '1',
    });
    expect(Object.keys(LOCAL_FLAGS).length).toBe(6);
  });

  it('clamps every numeric flag to its sane range', () => {
    expect(clampFlag('ads_levels_between', '0')).toBe(1);
    expect(clampFlag('ads_levels_between', '999')).toBe(20);
    expect(clampFlag('ads_min_interval_min', '-5')).toBe(0);
    expect(clampFlag('ads_max_per_session', '1000')).toBe(50);
    expect(clampFlag('coins_multiplier', '3.5')).toBe(3.5);
    expect(clampFlag('coins_multiplier', 'oops')).toBe(1);
    expect(clampFlag('coins_multiplier', undefined)).toBe(1);
  });

  it('types the raw values once', () => {
    const typed = valuesFrom({ ads_levels_between: '5', coins_multiplier: '2' });
    expect(typed.adsLevelsBetween).toBe(5);
    expect(typed.coinsMultiplier).toBe(2);
  });

  it('keeps only string and finite-number values of a sane length', () => {
    expect(sanitizeFlags({ a: 'ok', b: 42, c: null, d: 'x'.repeat(101), e: Number.NaN })).toEqual({ a: 'ok', b: '42' });
    expect(sanitizeFlags(null)).toEqual({});
    expect(sanitizeFlags(['nope'])).toEqual({});
  });
});

describe('query override', () => {
  it('reads ?flags=k=v and drops keys the game does not know', () => {
    expect(flagsFromQuery('?flags=ads_levels_between=1,coins_multiplier=2')).toEqual({
      ads_levels_between: '1',
      coins_multiplier: '2',
    });
    expect(flagsFromQuery('?flags=ads_levels_between=1,unknown_key=9')).toEqual({ ads_levels_between: '1' });
    expect(flagsFromQuery('')).toEqual({});
    expect(flagsFromQuery('?flags=')).toEqual({});
  });

  it('wins over the platform and still reports itself as the source', async () => {
    await withMock({ flags: { ads_levels_between: '7' } });
    const status = await initFlags({ query: '?flags=ads_levels_between=1' });
    expect(status.source).toBe('query');
    expect(status.available).toBe(true);
    expect(flagNumber('ads_levels_between')).toBe(1);
  });
});

describe('initFlags', () => {
  it('takes the remote configuration over the local one', async () => {
    const mock = await withMock({ flags: { ads_levels_between: '4', coins_multiplier: '2' } });
    const status = await initFlags();

    expect(status.source).toBe('remote');
    expect(status.available).toBe(true);
    expect(status.raw.ads_levels_between).toBe('4');
    expect(status.values.adsLevelsBetween).toBe(4);
    expect(flagNumber('coins_multiplier')).toBe(2);
    // The keys the portal does not send keep their local values.
    expect(flagNumber('ads_max_per_session')).toBe(8);
    expect(mock.calls.getFlags).toBe(1);
  });

  it('sends the player state as client features', async () => {
    const mock = await withMock({ flags: { coins_multiplier: '2' } });
    setLang('en', 'platform');
    await initFlags({ features: { levels: 12, stars: 30, paying: 'paying' } });
    expect(mock.calls.getFlags).toBe(1);
    // The request goes through the SDK; the features are built by the module.
    expect(clientFeatures({ levels: 12, stars: 30, paying: 'paying' })).toEqual([
      { name: 'lang', value: 'en' },
      { name: 'levels', value: '12' },
      { name: 'stars', value: '30' },
      { name: 'payingStatus', value: 'paying' },
    ]);
  });

  it('works without the platform: the local configuration is the game', async () => {
    const status = await initFlags();
    expect(status.available).toBe(false);
    expect(status.source).toBe('local');
    expect(flagNumber('ads_min_interval_min')).toBe(3);
    expect(status.error).toBeNull();
  });

  it('falls back to the cache of the last successful read when the platform fails', async () => {
    await withMock({ flags: { ads_levels_between: '5' } });
    await initFlags();
    expect(window.localStorage.getItem(FLAGS_CACHE_KEY)).toContain('ads_levels_between');

    // A new session on the same device, but the flags endpoint is down.
    resetFlags();
    resetPlatform();
    await withMock({ flagsFail: true });
    const status = await initFlags();
    expect(status.source).toBe('cache');
    expect(status.available).toBe(false);
    expect(flagNumber('ads_levels_between')).toBe(5);
    expect(status.error).not.toBeNull();
  });

  it('never rejects and keeps the defaults when there is nothing to read', async () => {
    await withMock({ flagsFail: true });
    const status = await initFlags();
    expect(status.source).toBe('local');
    expect(status.raw).toEqual(LOCAL_FLAGS);
  });

  it('notifies the subscribers and exposes a snapshot', async () => {
    const seen: string[] = [];
    const stop = subscribeFlags((value) => seen.push(value.source));
    await withMock({ flags: { coins_multiplier: '2' } });
    await initFlags();
    expect(seen).toContain('remote');
    expect(flagsStatus().values.coinsMultiplier).toBe(2);
    expect(flags().adsMaxPerSession).toBe(8);
    stop();
  });
});

describe('the flags reach the game', () => {
  /** Lets the fire-and-forget chains settle. */
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('changes the ad pressure and the prize of a video', async () => {
    const mock = await withMock();
    await initAds();
    await initFlags({ query: '?flags=ad_reward_coins=100,ad_rewards_per_day=1,ads_levels_between=1,ads_max_per_session=2' });
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 0, adReward: { ...EMPTY_AD_REWARD } },
    });

    // One finished level is enough (the flag replaced the default of two).
    expect(interstitialReady()).toEqual({ allowed: false, reason: 'too-often' });
    noteLevelFinished();
    expect(interstitialReady().allowed).toBe(true);

    // The video now pays the flag value, and only once a day.
    useGameStore.getState().watchAdForCoins();
    mock.ads.reward();
    mock.ads.closeRewarded(true);
    await flush();
    expect(useGameStore.getState().progress.coins).toBe(100);

    const callsBefore = mock.calls.rewardedVideo;
    useGameStore.getState().watchAdForCoins();
    expect(mock.calls.rewardedVideo).toBe(callsBefore);
    expect(useGameStore.getState().progress.coins).toBe(100);
  });

  it('multiplies the coins of a level', async () => {
    await withMock();
    await initFlags({ query: '?flags=coins_multiplier=2' });
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 0 } });

    useGameStore.getState().startLevel(1);
    const runtime = useGameStore.getState().runtime;
    if (!runtime) throw new Error('level did not start');
    for (const move of planSolution(runtime.board).moves) {
      expect(useGameStore.getState().requestMove(move.from, move.to)).toBe(true);
    }

    const state = useGameStore.getState();
    expect(state.phase).toBe('won');
    // The panel shows the award of the run, the wallet got twice as much.
    expect(state.progress.coins).toBe((state.outcome?.coins ?? 0) * 2);
  });
});

describe('mergeFlags', () => {
  it('prefers the remote values, then the cache, then the local configuration', () => {
    // A successful read is authoritative: a key the portal no longer sends
    // falls back to the shipped default, not to the previous value — otherwise
    // a flag deleted in the Console would stay alive on the devices forever.
    const remote = mergeFlags({ ads_max_per_session: '3' }, { ads_max_per_session: '9', coins_multiplier: '2' });
    expect(remote.source).toBe('remote');
    expect(remote.raw.ads_max_per_session).toBe('3');
    expect(remote.raw.coins_multiplier).toBe(LOCAL_FLAGS.coins_multiplier);
    expect(remote.raw.ad_rewards_per_day).toBe(LOCAL_FLAGS.ad_rewards_per_day);

    // Without an answer the cache is the best knowledge of the device.
    const cached = mergeFlags(null, { ads_max_per_session: '9', coins_multiplier: '2' });
    expect(cached.source).toBe('cache');
    expect(cached.raw.ads_max_per_session).toBe('9');
    expect(cached.raw.coins_multiplier).toBe('2');
  });

  it('reports an empty status before the first read', () => {
    const status = emptyFlagsStatus();
    expect(status.available).toBe(false);
    expect(status.source).toBe('default');
    expect(status.loadedAt).toBeNull();
  });
});
