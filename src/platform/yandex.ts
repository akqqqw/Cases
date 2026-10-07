/**
 * Yandex Games platform session.
 *
 * Everything the game needs from the platform goes through this module: the SDK
 * script, `YaGames.init()`, the loading / gameplay markup, pause & resume
 * events, the trusted server time and fullscreen state. The game itself never
 * touches `window.YaGames` — it asks this facade, which always answers, even
 * when there is no SDK at all (a plain browser, the local dev preview, tests).
 *
 * Only documented API is used:
 *   - connection: `<script src="/sdk.js">` (relative path for the Yandex server)
 *     then `YaGames.init()`
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-about
 *   - `ysdk.features.LoadingAPI.ready()`, `GameplayAPI.start()/stop()`
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-game-events
 *   - `ysdk.environment.{app.id, i18n.lang, payload, referrer}`
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-environment
 *   - `ysdk.on('game_api_pause' | 'game_api_resume')`
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-events
 *   - `ysdk.serverTime()`
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-server-time
 *   - `ysdk.screen.fullscreen.{status, request(), exit()}` + STATUS_ON / STATUS_OFF
 *     https://yandex.com/dev/games/doc/en/sdk/sdk-params
 */
export type PlatformKind = 'yandex' | 'web';
export type SdkStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

/** The part of the SDK the game uses, typed so the game stays strict. */
interface SdkEnvironment {
  app?: { id?: string };
  i18n?: { lang?: string };
  payload?: string;
  referrer?: { type?: string; promoId?: string; intent?: string; inappId?: string };
}

interface SdkFullscreen {
  status?: string;
  STATUS_ON?: string;
  STATUS_OFF?: string;
  request?: () => Promise<void> | void;
  exit?: () => Promise<void> | void;
}

/** Advertising surface (`ysdk.adv`) — used only by `platform/ads.ts`. */
interface SdkAdv {
  showFullscreenAdv?: (options?: {
    callbacks?: {
      onOpen?: () => void;
      onClose?: (wasShown: boolean) => void;
      onError?: (error: unknown) => void;
    };
  }) => void;
  showRewardedVideo?: (options?: {
    callbacks?: {
      onOpen?: () => void;
      onRewarded?: () => void;
      onClose?: (wasShown: boolean) => void;
      onError?: (error: unknown) => void;
    };
  }) => void;
  getBannerAdvStatus?: () => Promise<{ stickyAdvIsShowing?: boolean; reason?: string }>;
  showBannerAdv?: () => Promise<{ stickyAdvIsShowing?: boolean; reason?: string }>;
  hideBannerAdv?: () => Promise<{ stickyAdvIsShowing?: boolean }>;
}

/**
 * Ranking surface (`ysdk.leaderboards`) — used only by `platform/leaderboards.ts`
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-leaderboard). Accessing
 * `ysdk.getLeaderboards()` first is deprecated but still documented, so it is
 * kept as a fallback for older SDK builds.
 */
export interface SdkLeaderboardEntry {
  extraData?: string;
  rank?: number;
  score?: number;
  player?: {
    publicName?: string;
    uniqueID?: string;
    getAvatarSrc?: (size?: 'small' | 'medium' | 'large') => string;
    getAvatarSrcSet?: (size?: 'small' | 'medium' | 'large') => string;
  };
}

export interface SdkLeaderboards {
  setScore?: (leaderboardName: string, score: number, extraData?: string) => Promise<void>;
  getPlayerEntry?: (leaderboardName: string) => Promise<SdkLeaderboardEntry>;
  getEntries?: (
    leaderboardName: string,
    options?: { includeUser?: boolean; quantityAround?: number; quantityTop?: number },
  ) => Promise<{ entries?: SdkLeaderboardEntry[]; userRank?: number }>;
}

/**
 * In-app purchases (`ysdk.payments`) — used only by `platform/purchases.ts`
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-purchases). The game processes
 * purchases on the client (`signed: false`), which is the documented default for
 * a game without its own server.
 */
export interface SdkProduct {
  id?: string;
  title?: string;
  description?: string;
  imageURI?: string;
  price?: string;
  priceValue?: string;
  priceCurrencyCode?: string;
  getPriceCurrencyImage?: (size?: 'small' | 'medium' | 'svg') => string;
}

export interface SdkPurchase {
  productID?: string;
  purchaseToken?: string;
  developerPayload?: string;
}

export interface SdkPayments {
  purchase?: (data: { id: string; developerPayload?: string }) => Promise<SdkPurchase>;
  getPurchases?: () => Promise<SdkPurchase[] | { signature: string }>;
  getCatalog?: () => Promise<SdkProduct[]>;
  consumePurchase?: (purchaseToken: string) => Promise<void>;
}

interface YandexSdk {
  environment?: SdkEnvironment;
  features?: {
    LoadingAPI?: { ready?: () => void };
    GameplayAPI?: { start?: () => void; stop?: () => void };
  };
  screen?: { fullscreen?: SdkFullscreen };
  serverTime?: () => number;
  on?: (event: string, listener: () => void) => void;
  off?: (event: string, listener: () => void) => void;
  /** Player data (cloud saves) — see `platform/player.ts`. */
  getPlayer?: (options?: { scopes?: boolean; signed?: boolean }) => Promise<unknown>;
  auth?: { openAuthDialog?: () => Promise<void> };
  /** `localStorage`-compatible storage that survives iOS resets. */
  getStorage?: () => Promise<Storage>;
  /** Interstitial, rewarded video and the sticky banner. */
  adv?: SdkAdv;
  /** Leaderboards — the modern entry point. */
  leaderboards?: SdkLeaderboards;
  /** Deprecated initializer of the same object (kept as a fallback). */
  getLeaderboards?: () => Promise<SdkLeaderboards>;
  /** `ysdk.isAvailableMethod('leaderboards.setScore')` — tells what is enabled. */
  isAvailableMethod?: (method: string) => Promise<boolean>;
  /** Remote configuration of the Console (stage: experiment flags). */
  getFlags?: (params?: {
    defaultFlags?: Record<string, string>;
    clientFeatures?: Array<{ name: string; value: string }>;
  }) => Promise<Record<string, string>>;
  /** In-app purchases — the modern entry point, no preload needed. */
  payments?: SdkPayments;
  /** Deprecated preloader of the same object (kept as a fallback). */
  getPayments?: (options?: { signed?: boolean }) => Promise<SdkPayments>;
}

declare global {
  interface Window {
    YaGames?: { init?: (options?: { signed?: boolean }) => Promise<YandexSdk> };
  }
}

export interface PlatformInfo {
  /** `yandex` inside the platform, `web` everywhere else. */
  kind: PlatformKind;
  status: SdkStatus;
  /** Interface language the platform asks for (`en`, `ru`, `tr`, …). */
  lang: string | null;
  appId: string | null;
  payload: string | null;
  referrer: string | null;
  /** Fullscreen state of the platform, `false` when unknown. */
  fullscreen: boolean;
  /** `true` once `ysdk.serverTime()` was read. */
  trustedTime: boolean;
  /** Last problem, kept for the debug line. */
  error: string | null;
}

export const PLATFORM_PAUSE_EVENT = 'game_api_pause';
export const PLATFORM_RESUME_EVENT = 'game_api_resume';

/** Relative path is what the Yandex server expects (see the docs). */
export const SDK_SCRIPT_PATH = '/sdk.js';
const SCRIPT_TIMEOUT_MS = 8000;
const INIT_TIMEOUT_MS = 10_000;
/** The platform has no fullscreen event, the docs suggest polling the status. */
const FULLSCREEN_POLL_MS = 500;

let sdk: YandexSdk | null = null;
let info: PlatformInfo = {
  kind: 'web',
  status: 'idle',
  lang: null,
  appId: null,
  payload: null,
  referrer: null,
  fullscreen: false,
  trustedTime: false,
  error: null,
};

const pauseListeners = new Set<() => void>();
const resumeListeners = new Set<() => void>();
let fullscreenPoll: ReturnType<typeof setInterval> | null = null;
let fullscreenListener: (() => void) | null = null;
let readySent = false;
let gameplayActive = false;

export function platformInfo(): PlatformInfo {
  return { ...info };
}

/** `true` when the game really runs inside Yandex Games. */
export function isYandex(): boolean {
  return info.kind === 'yandex' && sdk !== null;
}

/**
 * The raw session for the sibling platform modules (`player.ts`, `cloud.ts`).
 * The game code never uses it directly.
 */
/**
 * The leaderboard object of the current session, `null` without the platform.
 * `ysdk.leaderboards` is the documented way; `getLeaderboards()` is the legacy
 * fallback and is only used when the modern field is missing.
 */
export async function leaderboardsApi(): Promise<SdkLeaderboards | null> {
  const session = sdk;
  if (!session) return null;
  if (session.leaderboards) return session.leaderboards;

  const legacy = session.getLeaderboards;
  if (typeof legacy !== 'function') return null;
  try {
    return (await legacy.call(session)) ?? null;
  } catch {
    return null;
  }
}

/**
 * The payments object of the current session, `null` without the platform.
 * `ysdk.payments` initializes itself on the first call; `getPayments()` (the
 * documented preloader) is used when the field is missing, so either SDK build
 * works. `signed: false` is the client-side mode of the docs — the game has no
 * server to verify a signature on.
 */
export async function paymentsApi(): Promise<SdkPayments | null> {
  const session = sdk;
  if (!session) return null;
  if (session.payments) return session.payments;

  const preload = session.getPayments;
  if (typeof preload !== 'function') return null;
  try {
    return (await preload.call(session, { signed: false })) ?? null;
  } catch {
    return null;
  }
}

/**
 * `ysdk.isAvailableMethod(name)`. The docs ask to check `leaderboards.setScore`
 * before writing a score. An SDK without the checker is assumed to have the
 * method — the call itself answers with an error when it does not.
 */
export async function methodAvailable(name: string): Promise<boolean> {
  const session = sdk;
  const check = session?.isAvailableMethod;
  if (!session || typeof check !== 'function') return true;
  try {
    return (await check.call(session, name)) === true;
  } catch {
    return false;
  }
}

export function sdkSession(): YandexSdk | null {
  return sdk;
}

function isAvailable(windowRef: Window): boolean {
  return typeof windowRef.YaGames?.init === 'function';
}

/**
 * Injects `/sdk.js` and waits for it. A missing SDK (local preview, tests, a
 * blocked script) is a normal outcome, not an error: the game keeps working.
 */
export function loadSdkScript(
  windowRef: Window = window,
  scriptPath: string = SDK_SCRIPT_PATH,
  timeoutMs: number = SCRIPT_TIMEOUT_MS,
): Promise<boolean> {
  if (isAvailable(windowRef)) return Promise.resolve(true);
  if (typeof document === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };

    const script = document.createElement('script');
    script.src = scriptPath;
    script.async = true;
    script.onload = () => finish(isAvailable(windowRef));
    script.onerror = () => finish(false);

    const timer = window.setTimeout(() => finish(isAvailable(windowRef)), timeoutMs);
    document.head.appendChild(script);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SDK init timeout')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Reads `ysdk.environment` into the flat platform info. */
function readEnvironment(target: YandexSdk): void {
  const environment = target.environment ?? {};
  info.lang = typeof environment.i18n?.lang === 'string' ? environment.i18n.lang : null;
  info.appId = typeof environment.app?.id === 'string' ? environment.app.id : null;
  info.payload = typeof environment.payload === 'string' ? environment.payload : null;
  const referrer = environment.referrer;
  info.referrer = referrer?.type ? referrer.type : null;
}

/**
 * Starts the platform session. Never rejects: on any problem the game simply
 * runs as a plain web build (`kind: 'web'`).
 */
export async function initPlatform(options: {
  windowRef?: Window;
  scriptPath?: string;
  timeoutMs?: number;
  initTimeoutMs?: number;
} = {}): Promise<PlatformInfo> {
  const windowRef = options.windowRef ?? (typeof window === 'undefined' ? null : window);
  if (!windowRef) {
    info = { ...info, kind: 'web', status: 'unavailable' };
    return platformInfo();
  }

  info = { ...info, status: 'loading', error: null };
  readySent = false;
  gameplayActive = false;

  const loaded = await loadSdkScript(windowRef, options.scriptPath, options.timeoutMs);
  const init = windowRef.YaGames?.init;
  if (!loaded || typeof init !== 'function') {
    sdk = null;
    info = { ...info, kind: 'web', status: 'unavailable', fullscreen: false, trustedTime: false };
    return platformInfo();
  }

  try {
    const session = await withTimeout(init.call(windowRef.YaGames), options.initTimeoutMs ?? INIT_TIMEOUT_MS);
    sdk = session ?? null;
    if (!sdk) throw new Error('YaGames.init() returned nothing');

    readEnvironment(sdk);
    info.kind = 'yandex';
    info.status = 'ready';
    subscribePlatformEvents(sdk);
    watchFullscreen(windowRef);
    refreshTrustedTime();
  } catch (error) {
    sdk = null;
    info = {
      ...info,
      kind: 'web',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      fullscreen: false,
      trustedTime: false,
    };
  }

  return platformInfo();
}

function subscribePlatformEvents(session: YandexSdk): void {
  try {
    session.on?.(PLATFORM_PAUSE_EVENT, () => {
      for (const listener of pauseListeners) listener();
    });
    session.on?.(PLATFORM_RESUME_EVENT, () => {
      // The trusted time is refreshed on every resume: it cannot drift.
      refreshTrustedTime();
      for (const listener of resumeListeners) listener();
    });
  } catch {
    /* an SDK without events must not break the game */
  }
}

function watchFullscreen(windowRef: Window): void {
  if (fullscreenPoll !== null) windowRef.clearInterval(fullscreenPoll);
  info.fullscreen = readFullscreen();
  fullscreenPoll = windowRef.setInterval(() => {
    const next = readFullscreen();
    if (next !== info.fullscreen) info = { ...info, fullscreen: next };
  }, FULLSCREEN_POLL_MS);
  // The platform fullscreens its own frame, so `fullscreenchange` only matters
  // for the plain-web fallback.
  if (!fullscreenListener && typeof document !== 'undefined') {
    fullscreenListener = () => {
      if (sdk) return;
      info = { ...info, fullscreen: readFullscreen() };
    };
    document.addEventListener('fullscreenchange', fullscreenListener);
  }
}

function readFullscreen(): boolean {
  const fullscreen = sdk?.screen?.fullscreen;
  if (fullscreen) {
    const on = fullscreen.STATUS_ON ?? 'on';
    return fullscreen.status === on;
  }
  // jsdom and some embeds leave `fullscreenElement` undefined, so read it as a
  // truthy value instead of comparing with `null`.
  if (typeof document !== 'undefined') return Boolean(document.fullscreenElement);
  return false;
}

/** Informs the platform that the game is loaded and interactive. */
export function platformReady(): boolean {
  if (readySent || !sdk) return false;
  try {
    sdk.features?.LoadingAPI?.ready?.();
    readySent = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Gameplay markup: `start()` while a level is played, `stop()` in menus, on the
 * pause screen and before an ad. The platform uses it for analytics and ads.
 */
export function setGameplay(active: boolean): boolean {
  if (!sdk || active === gameplayActive) return false;
  try {
    if (active) sdk.features?.GameplayAPI?.start?.();
    else sdk.features?.GameplayAPI?.stop?.();
    gameplayActive = active;
    return true;
  } catch {
    return false;
  }
}

export function gameplayActiveNow(): boolean {
  return gameplayActive;
}

/** Trusted server time in ms, or `null` when the platform cannot provide it. */
export function serverTime(): number | null {
  try {
    const value = sdk?.serverTime?.();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Reads the server time into the game clock, if it is available. */
export function refreshTrustedTime(): number | null {
  const value = serverTime();
  if (value === null) return null;
  info = { ...info, trustedTime: true };
  return value;
}

export function onPlatformPause(listener: () => void): () => void {
  pauseListeners.add(listener);
  return () => pauseListeners.delete(listener);
}

export function onPlatformResume(listener: () => void): () => void {
  resumeListeners.add(listener);
  return () => resumeListeners.delete(listener);
}

/** Fullscreen: the platform button and our own both end up here. */
export async function toggleFullscreen(): Promise<boolean> {
  const fullscreen = sdk?.screen?.fullscreen;
  try {
    if (fullscreen) {
      if (readFullscreen()) await fullscreen.exit?.();
      else await fullscreen.request?.();
    } else if (typeof document !== 'undefined') {
      // Plain web fallback so the button also works in the local preview.
      if (readFullscreen()) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    }
  } catch {
    /* the browser or the platform refused — the state below is the truth */
  }
  info = { ...info, fullscreen: readFullscreen() };
  return info.fullscreen;
}

/** Stops the fullscreen poll (used by tests and by a full page teardown). */
export function stopPlatformWatchers(): void {
  if (fullscreenPoll !== null && typeof window !== 'undefined') {
    window.clearInterval(fullscreenPoll);
  }
  fullscreenPoll = null;
  if (fullscreenListener && typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', fullscreenListener);
  }
  fullscreenListener = null;
}

/** Test seam: forgets the session and every subscription. */
export function resetPlatform(): void {
  stopPlatformWatchers();
  sdk = null;
  readySent = false;
  gameplayActive = false;
  pauseListeners.clear();
  resumeListeners.clear();
  info = {
    kind: 'web',
    status: 'idle',
    lang: null,
    appId: null,
    payload: null,
    referrer: null,
    fullscreen: false,
    trustedTime: false,
    error: null,
  };
}
