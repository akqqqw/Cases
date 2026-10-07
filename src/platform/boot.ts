/**
 * Boot sequence of the platform layer.
 *
 *  1. detect the interface language (`?lang=` first, then the platform),
 *  2. load `/sdk.js` and call `YaGames.init()` — a plain browser is fine, the
 *     game keeps working as a web build,
 *  3. read `ysdk.environment`, switch the game to the trusted server clock,
 *  4. subscribe to `game_api_pause` / `game_api_resume`,
 *  5. keep the gameplay markup in sync with the game phase,
 *  6. tell the platform the game is ready (`LoadingAPI.ready()`) as soon as the
 *     menu is on screen.
 *
 * The module is deliberately framework-free; `App.tsx` calls `bootPlatform()`
 * once and `markGameReady()` when the menu shows up.
 */
import { audio } from '../game/audio';
import { setTrustedTime } from '../data/clock';
import { useGameStore, type Phase } from '../store/gameStore';
import { initAds, syncBannerForPhase } from './ads';
import { flushCloud } from './cloud';
import { detectLang, setLang, type Lang, type LangSource } from './i18n';
import { MOCK_PREVIEW_BOARDS, MOCK_PREVIEW_PRODUCTS, createMockSdk, mockRequested } from './mock';
import {
  initPlatform,
  onPlatformPause,
  onPlatformResume,
  platformInfo,
  platformReady,
  refreshTrustedTime,
  setGameplay,
  stopPlatformWatchers,
  type PlatformInfo,
} from './yandex';

export interface BootResult {
  info: PlatformInfo;
  lang: Lang;
  langSource: LangSource;
  /** `true` when the local mock SDK was installed from `?sdk=mock`. */
  mocked: boolean;
}

/** Gameplay markup: a level is being played right now, nothing else counts. */
export function gameplayForPhase(phase: Phase): boolean {
  return phase === 'playing';
}

let booted = false;
let unsubscribeStore: (() => void) | null = null;
let unsubscribePause: (() => void) | null = null;
let unsubscribeResume: (() => void) | null = null;
let readyCalled = false;

/**
 * Pushes the server time into the game clock (`data/clock.ts`, stage 4) so the
 * daily gift and the daily tasks cannot be cheated by moving the device clock.
 */
export function applyTrustedTime(): boolean {
  const value = refreshTrustedTime();
  if (value === null) return false;
  return setTrustedTime(value);
}

/**
 * Keeps the gameplay markup honest: `start()` while a level runs, `stop()` in
 * menus, on the pause screen, on a win/lose screen and whenever the platform
 * itself holds the game (an ad or a purchase window is on screen).
 */
function subscribeGameplay(): void {
  unsubscribeStore = useGameStore.subscribe((state, previous) => {
    if (state.phase === previous.phase && state.platform.paused === previous.platform.paused) return;
    if (state.platform.paused) {
      setGameplay(false);
      return;
    }
    setGameplay(gameplayForPhase(state.phase));
  });
}

function subscribePlatformPause(): void {
  unsubscribePause = onPlatformPause(() => {
    // Silence first: the ad of the platform is already playing.
    audio.suspend();
    useGameStore.getState().platformPause();
    setGameplay(false);
  });

  unsubscribeResume = onPlatformResume(() => {
    useGameStore.getState().platformResume();
    applyTrustedTime();
    audio.restore();
    // An ad or a network switch may have happened: the save goes to the cloud.
    void flushCloud();
    const state = useGameStore.getState();
    setGameplay(!state.platform.paused && gameplayForPhase(state.phase));
  });
}

/** Copies the facade state into the store so the UI can render it. */
function pushPlatform(info: PlatformInfo, lang: Lang, langSource: LangSource): void {
  useGameStore.getState().setPlatform({
    kind: info.kind,
    status: info.status,
    lang,
    langSource,
    fullscreen: info.fullscreen,
    trustedTime: info.trustedTime,
  });
}

/**
 * Starts the platform session. Resolves even when there is no platform at all:
 * the game must never fail to boot because of an SDK.
 */
export async function bootPlatform(options: {
  windowRef?: Window;
  query?: string;
  scriptPath?: string;
  timeoutMs?: number;
} = {}): Promise<BootResult> {
  const windowRef = options.windowRef ?? (typeof window === 'undefined' ? null : window);
  const query = options.query ?? (typeof window === 'undefined' ? '' : window.location.search);

  // The query parameter is applied before the first render, so the language
  // never flickers; the platform may still refine it below.
  const first = detectLang({ query });
  setLang(first.lang, first.source);

  let mocked = false;
  if (windowRef && mockRequested(query)) {
    const requested = new URLSearchParams(query.replace(/^\?/, '')).get('lang') ?? 'ru';
    createMockSdk({
      lang: requested,
      leaderboards: { seeded: MOCK_PREVIEW_BOARDS },
      // The preview has a Console: five products with portal prices.
      payments: { enabled: true, catalog: MOCK_PREVIEW_PRODUCTS },
    }).install(windowRef);
    mocked = true;
  }

  const info = await initPlatform({
    windowRef: windowRef ?? undefined,
    scriptPath: options.scriptPath,
    timeoutMs: options.timeoutMs,
  });

  const final = detectLang({ query, platform: info.lang });
  setLang(final.lang, final.source);
  if (typeof document !== 'undefined') document.documentElement.lang = final.lang;
  if (info.trustedTime) applyTrustedTime();
  pushPlatform(platformInfo(), final.lang, final.source);

  if (!booted) {
    booted = true;
    subscribeGameplay();
    subscribePlatformPause();
  }

  // Advertising comes last: the banner state and the ad API are only touched
  // once the game is playable, and a platform without ads is simply skipped.
  await initAds();
  syncBannerForPhase(useGameStore.getState().phase);

  // The very first markup — the menu.
  setGameplay(gameplayForPhase(useGameStore.getState().phase));

  return { info: platformInfo(), lang: final.lang, langSource: final.source, mocked };
}

/**
 * The menu is on screen and the player can interact — exactly the moment the
 * docs describe for `LoadingAPI.ready()`. Safe to call more than once.
 */
export function markGameReady(): boolean {
  if (readyCalled) return false;
  readyCalled = platformReady();
  return readyCalled;
}

/** Test seam: stops every subscription and the fullscreen poll. */
export function shutdownPlatform(): void {
  unsubscribeStore?.();
  unsubscribePause?.();
  unsubscribeResume?.();
  unsubscribeStore = null;
  unsubscribePause = null;
  unsubscribeResume = null;
  stopPlatformWatchers();
  booted = false;
  readyCalled = false;
}
