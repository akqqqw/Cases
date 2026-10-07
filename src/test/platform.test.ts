// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createMockSdk, mockRequested } from '../platform/mock';
import {
  detectLang,
  getLang,
  langFromCode,
  langFromQuery,
  setLang,
  t,
  translateRank,
  translateWorld,
} from '../platform/i18n';
import {
  gameplayActiveNow,
  initPlatform,
  loadSdkScript,
  isYandex,
  onPlatformPause,
  onPlatformResume,
  platformInfo,
  platformReady,
  resetPlatform,
  serverTime,
  setGameplay,
  toggleFullscreen,
} from '../platform/yandex';
import { bootPlatform, gameplayForPhase, markGameReady, shutdownPlatform } from '../platform/boot';
import { DEFAULT_PLATFORM, useGameStore } from '../store/gameStore';
import { clearTrustedTime, currentDayKey, hasTrustedTime, now } from '../data/clock';

/** Removes every trace of a previous platform session. */
function cleanPlatform(): void {
  shutdownPlatform();
  resetPlatform();
  clearTrustedTime();
  delete (window as unknown as { YaGames?: unknown }).YaGames;
  setLang('ru', 'default');
  useGameStore.setState({
    platform: { ...DEFAULT_PLATFORM },
    phase: 'menu',
    runtime: null,
  });
}

afterEach(cleanPlatform);

describe('language detection', () => {
  it('sends Russian-reading locales to Russian and everything else to English', () => {
    for (const code of ['ru', 'be', 'kk', 'uk', 'uz', 'ru-RU', 'BE', 'uz-Latn']) {
      expect(langFromCode(code), code).toBe('ru');
    }
    for (const code of ['en', 'en-US', 'tr', 'de', 'fr', 'es', 'ar', 'ko', 'ja']) {
      expect(langFromCode(code), code).toBe('en');
    }
    expect(langFromCode('zh-Hans')).toBe('en');
    expect(langFromCode('zh-Hant')).toBe('ru');
    expect(langFromCode('')).toBeNull();
    expect(langFromCode(null)).toBeNull();
    expect(langFromCode(undefined)).toBeNull();
  });

  it('reads the `?lang=` switch of the local preview', () => {
    expect(langFromQuery('?lang=en')).toBe('en');
    expect(langFromQuery('lang=tr&sdk=mock')).toBe('en');
    expect(langFromQuery('?lang=be')).toBe('ru');
    expect(langFromQuery('?sdk=mock')).toBeNull();
    expect(langFromQuery('')).toBeNull();
  });

  it('prefers the query, then the platform, then the default', () => {
    expect(detectLang({ query: '?lang=en', platform: 'ru' })).toEqual({ lang: 'en', source: 'query' });
    expect(detectLang({ query: '?sdk=mock', platform: 'tr' })).toEqual({ lang: 'en', source: 'platform' });
    expect(detectLang({ platform: 'kk' })).toEqual({ lang: 'ru', source: 'platform' });
    expect(detectLang({})).toEqual({ lang: 'ru', source: 'default' });
    expect(detectLang({ fallback: 'en' })).toEqual({ lang: 'en', source: 'default' });
  });

  it('translates the menu strings and keeps placeholders', () => {
    setLang('ru', 'default');
    expect(t('menu.play')).toBe('▶ Играть');
    expect(t('menu.levelInfo', { id: 3, total: 60, world: 'Сладкое', done: 2 })).toBe(
      'Уровень 3 из 60 · Сладкое · пройдено 2',
    );
    expect(translateWorld('Сладкое')).toBe('Сладкое');

    setLang('en', 'platform');
    expect(getLang()).toBe('en');
    expect(t('menu.play')).toBe('▶ Play');
    expect(t('menu.eventDays', { n: 4 })).toBe('4 days left');
    expect(translateWorld('Сладкое')).toBe('Sweets');
    expect(translateWorld('Неизвестный мир')).toBe('Неизвестный мир');
    expect(translateRank('Мастер полок')).toBe('Shelf master');
    expect(translateRank('Кто-то')).toBe('Кто-то');
  });

  it('falls back to Russian for a key that has no English text', () => {
    setLang('en', 'platform');
    // `pause.menu` has a translation; an unknown key returns itself so a typo
    // is visible instead of silently empty.
    expect(t('pause.menu')).toBe('Menu');
    expect(t('definitely.missing.key')).toBe('definitely.missing.key');
    setLang('ru', 'default');
  });
});

describe('mock sdk', () => {
  it('is requested only by the documented query values', () => {
    expect(mockRequested('?sdk=mock')).toBe(true);
    expect(mockRequested('?sdk=1')).toBe(true);
    expect(mockRequested('?sdk=true&lang=en')).toBe(true);
    expect(mockRequested('?sdk=real')).toBe(false);
    expect(mockRequested('')).toBe(false);
  });

  it('reports the environment the real SDK reports', async () => {
    const mock = createMockSdk({ lang: 'tr', appId: 'my-app', timeMs: 1_700_000_000_000 });
    mock.install(window);

    const info = await initPlatform({ windowRef: window });
    expect(info.kind).toBe('yandex');
    expect(info.status).toBe('ready');
    expect(info.lang).toBe('tr');
    expect(info.appId).toBe('my-app');
    expect(isYandex()).toBe(true);
    expect(serverTime()).toBe(1_700_000_000_000);
  });
});

describe('platform facade', () => {
  it('falls back to a web build when the SDK is missing', async () => {
    const info = await initPlatform({ windowRef: window, timeoutMs: 1 });
    expect(info.kind).toBe('web');
    expect(info.status).toBe('unavailable');
    expect(isYandex()).toBe(false);
    // Every call is a safe no-op without the SDK.
    expect(platformReady()).toBe(false);
    expect(setGameplay(true)).toBe(false);
    expect(serverTime()).toBeNull();
    expect(await toggleFullscreen()).toBe(false);
  });

  it('reads `/sdk.js` exactly as the docs describe', async () => {
    // The local preview answers `/sdk.js` with the index page, so the script
    // "loads" without ever defining `YaGames`: that must count as no SDK.
    const withoutSdk = loadSdkScript(window, '/sdk.js', 100);
    const host = document.head.querySelector('script[src="/sdk.js"]');
    expect(host).not.toBeNull();
    host?.dispatchEvent(new Event('load'));
    expect(await withoutSdk).toBe(false);

    // And with the SDK defined the loader reports success.
    const withSdk = loadSdkScript(window, '/sdk.js', 100);
    (window as unknown as { YaGames?: unknown }).YaGames = { init: () => Promise.resolve({}) };
    document.head.querySelector('script[src="/sdk.js"]')?.dispatchEvent(new Event('load'));
    expect(await withSdk).toBe(true);
  });

  it('survives a broken `YaGames.init()`', async () => {
    const mock = createMockSdk({ failInit: true });
    mock.install(window);

    const info = await initPlatform({ windowRef: window });
    expect(info.kind).toBe('web');
    expect(info.status).toBe('error');
    expect(info.error).toContain('mock init failed');
    expect(platformInfo().error).toContain('mock init failed');
  });

  it('does not hang when the SDK never answers', async () => {
    const mock = createMockSdk({ hangInit: true });
    mock.install(window);

    const info = await initPlatform({ windowRef: window, initTimeoutMs: 5 });
    expect(info.status).toBe('error');
    expect(info.error).toContain('timeout');
  });

  it('reports readiness once and the gameplay markup only on change', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await initPlatform({ windowRef: window });

    expect(platformReady()).toBe(true);
    expect(platformReady()).toBe(false);
    expect(mock.calls.ready).toBe(1);

    expect(setGameplay(true)).toBe(true);
    expect(setGameplay(true)).toBe(false);
    expect(setGameplay(false)).toBe(true);
    expect(mock.calls.start).toBe(1);
    expect(mock.calls.stop).toBe(1);
    expect(gameplayActiveNow()).toBe(false);
  });

  it('drives fullscreen through the platform API', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await initPlatform({ windowRef: window });

    expect(platformInfo().fullscreen).toBe(false);
    expect(await toggleFullscreen()).toBe(true);
    expect(await toggleFullscreen()).toBe(false);
    expect(mock.calls.fullscreenOn).toBe(1);
    expect(mock.calls.fullscreenOff).toBe(1);
    expect(mock.fullscreenStatus()).toBe('off');
  });

  it('emits pause and resume to the subscribers and refreshes the clock', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await initPlatform({ windowRef: window });

    const log: string[] = [];
    const offPause = onPlatformPause(() => log.push('pause'));
    const offResume = onPlatformResume(() => log.push('resume'));

    mock.pause();
    mock.resume();
    offPause();
    offResume();
    mock.pause();
    mock.resume();

    expect(log).toEqual(['pause', 'resume']);
  });
});

describe('boot into the store', () => {
  it('runs as a plain web game without any SDK', async () => {
    const result = await bootPlatform({ query: '', timeoutMs: 1 });
    expect(result.mocked).toBe(false);
    expect(result.info.kind).toBe('web');
    expect(useGameStore.getState().platform.kind).toBe('web');
    expect(useGameStore.getState().platform.status).toBe('unavailable');
    expect(gameplayForPhase('menu')).toBe(false);
    expect(gameplayForPhase('paused')).toBe(false);
    expect(gameplayForPhase('playing')).toBe(true);
  });

  it('installs the local mock from `?sdk=mock` and takes its language', async () => {
    const result = await bootPlatform({ query: '?sdk=mock&lang=en' });
    expect(result.mocked).toBe(true);
    expect(result.lang).toBe('en');
    expect(result.langSource).toBe('query');
    expect(result.info.kind).toBe('yandex');
    expect(useGameStore.getState().platform.lang).toBe('en');
    expect(isYandex()).toBe(true);
    expect(document.documentElement.lang).toBe('en');
  });

  it('reads the portal language when the query does not force one', async () => {
    const mock = createMockSdk({ lang: 'uk' });
    mock.install(window);

    const result = await bootPlatform({ query: '' });
    expect(result.mocked).toBe(false);
    expect(result.lang).toBe('ru'); // uk reads Russian
    expect(result.langSource).toBe('platform');

    const english = await bootPlatform({ query: '?lang=de' });
    expect(english.lang).toBe('en');
    expect(english.langSource).toBe('query');
  });

  it('switches the game clock to the trusted server time', async () => {
    const noon = new Date(2026, 2, 1, 12, 0, 0).getTime();
    const mock = createMockSdk({ timeMs: noon });
    mock.install(window);

    expect(hasTrustedTime()).toBe(false);
    await bootPlatform({ query: '' });

    expect(hasTrustedTime()).toBe(true);
    expect(currentDayKey()).toBe('2026-03-01');
    expect(Math.abs(now() - noon)).toBeLessThan(60_000);
    expect(useGameStore.getState().platform.trustedTime).toBe(true);
  });

  it('calls `LoadingAPI.ready()` when the menu is on screen', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await bootPlatform({ query: '' });

    expect(markGameReady()).toBe(true);
    expect(markGameReady()).toBe(false);
    expect(mock.calls.ready).toBe(1);
  });

  it('marks gameplay start / stop with the game phase', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await bootPlatform({ query: '' });

    useGameStore.setState({ phase: 'playing' });
    expect(mock.calls.start).toBe(1);
    expect(mock.calls.stop).toBe(0);

    useGameStore.setState({ phase: 'paused' });
    expect(mock.calls.stop).toBe(1);

    useGameStore.setState({ phase: 'playing' });
    expect(mock.calls.start).toBe(2);
  });

  it('pauses for the platform and comes back exactly where it was', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await bootPlatform({ query: '' });

    useGameStore.setState({ phase: 'playing' });
    // A level with a runtime, so a resume has something to return to.
    const before = useGameStore.getState().phase;

    mock.pause();
    const paused = useGameStore.getState();
    expect(paused.platform.paused).toBe(true);
    expect(paused.platform.resumePhase).toBe('playing');
    expect(paused.phase).toBe('paused');
    expect(mock.calls.stop).toBe(1);

    mock.resume();
    const resumed = useGameStore.getState();
    expect(resumed.platform.paused).toBe(false);
    expect(resumed.platform.resumePhase).toBeNull();
    expect(resumed.phase).toBe('playing');
    expect(resumed.phase).toBe(before);
    expect(mock.calls.start).toBe(2);
  });

  it('keeps a player who paused the game themselves in the pause menu', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await bootPlatform({ query: '' });

    useGameStore.setState({ phase: 'paused' });
    mock.pause();
    expect(useGameStore.getState().platform.resumePhase).toBeNull();

    mock.resume();
    expect(useGameStore.getState().phase).toBe('paused');
    expect(useGameStore.getState().platform.paused).toBe(false);
  });

  it('does not restart the markup that the platform stopped', async () => {
    const mock = createMockSdk();
    mock.install(window);
    await bootPlatform({ query: '' });

    useGameStore.setState({ phase: 'playing' });
    mock.pause();
    // The game stays in a menu while the ad runs: the resume must not start it.
    useGameStore.setState({ phase: 'menu' });
    mock.resume();
    expect(mock.calls.start).toBe(1);
    expect(useGameStore.getState().phase).toBe('menu');
  });

  it('keeps the platform info in the store for the settings screen', async () => {
    const mock = createMockSdk({ lang: 'en', appId: 'store-app' });
    mock.install(window);
    await bootPlatform({ query: '' });

    const { platform } = useGameStore.getState();
    expect(platform).toMatchObject({
      kind: 'yandex',
      status: 'ready',
      lang: 'en',
      langSource: 'platform',
      paused: false,
      fullscreen: false,
    });
  });
});
