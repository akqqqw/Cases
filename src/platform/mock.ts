/**
 * A local stand-in for the Yandex Games SDK.
 *
 * Two uses, one implementation:
 *   - tests (`src/test/platform.test.ts`) drive the game through a fake SDK;
 *   - the dev preview can be opened with `?sdk=mock` (`&lang=en`) to see the
 *     platform path — environment language, loading markup, gameplay markup,
 *     `game_api_pause` / `game_api_resume` and the server clock — without the
 *     Developer Console.
 *
 * It follows the documented shape of the real SDK
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-about and the sibling pages), so
 * the game code cannot tell the difference.
 */
import { SDK_SCRIPT_PATH } from './yandex';

export interface MockPlayerOptions {
  /** `player.isAuthorized()` — a guest still gets cloud saves. */
  authorized?: boolean;
  id?: string;
  name?: string;
  /** Rejects every `getData()` (broken network / broken cloud). */
  failGet?: boolean;
  /** Rejects every `setData()`. */
  failSet?: boolean;
  /** Data that is already in the cloud when the game starts. */
  data?: Record<string, unknown>;
}

export interface MockAdvOptions {
  /** `true` (default): ads are available. */
  enabled?: boolean;
  /** The platform declines the interstitial: `onClose(false)`. */
  fullscreenAvailable?: boolean;
  /** Rewarded video is not available at all. */
  rewardedAvailable?: boolean;
  /** The Console hands banner control to the API. */
  bannerManaged?: boolean;
  /** `getBannerAdvStatus()` rejects. */
  bannerFails?: boolean;
  /** The SDK throws when an ad is requested. */
  throws?: boolean;
}

export interface MockLeaderboardOptions {
  /** `false`: the platform has no leaderboard API at all. */
  enabled?: boolean;
  /** `isAvailableMethod('leaderboards.setScore')` — a draft may have it off. */
  canSetScore?: boolean;
  /** Every leaderboard call rejects (broken network). */
  fail?: boolean;
  /** The table was not created in the Console: the SDK answers with a 404. */
  missing?: boolean;
  /** `getEntries()` never resolves (a hanging request). */
  hang?: boolean;
  /** Rows that other players already have: board name → `[name, score]`. */
  seeded?: Record<string, Array<[string, number]>>;
}

export interface MockLeaderboardController {
  /** Scores the game sent through `setScore()`, per board name. */
  sent: Record<string, number[]>;
  /** Current rows of a fake table (`name`, `score`) sorted like the SDK does. */
  board: (sdkName: string) => Array<{ name: string; score: number }>;
  /** Adds a row to a fake table — as another player would. */
  seed: (sdkName: string, name: string, score: number) => void;
}

/**
 * Tables the dev preview (`?sdk=mock`) shows in the rating screen, so the empty
 * leaderboard of a fresh draft is not what a developer sees first. Tests seed
 * their own rows and stay deterministic.
 */
export const MOCK_PREVIEW_BOARDS: Record<string, Array<[string, number]>> = {
  shelf_mastery: [['Аня', 320], ['Борис', 180], ['Марк', 95]],
  shelf_stars3: [['Аня', 42], ['Марк', 27], ['Борис', 18]],
  shelf_week: [['Марк', 61], ['Аня', 54], ['Борис', 33]],
};

/** Products of the preview Console — ids match `PRODUCTS` of `purchases.ts`. */
export const MOCK_PREVIEW_PRODUCTS: Array<{ id: string; title?: string; description?: string; price?: string; currency?: string }> = [
  { id: 'coins_small', title: 'Горсть монет', price: '75 YAN' },
  { id: 'coins_big', title: 'Мешок монет', price: '199 YAN' },
  { id: 'boosters_pack', title: 'Набор бустеров', price: '149 YAN' },
  { id: 'starter_pack', title: 'Стартовый набор', price: '299 YAN' },
  { id: 'remove_ads', title: 'Без рекламы', price: '249 YAN' },
];

export interface MockPaymentsOptions {
  /** `false` (default here): the platform has no purchases at all. */
  enabled?: boolean;
  /** The draft has products, but the payments API answers with an error. */
  fail?: boolean;
  /** The player closes the payment window (the promise rejects). */
  decline?: boolean;
  /** Products of the fake Console (id → price in portal currency). */
  catalog?: Array<{ id: string; title?: string; description?: string; price?: string; currency?: string }>;
  /** Purchases that are paid but not consumed yet (the next-launch case). */
  pending?: string[];
}

export interface MockPaymentsController {
  /** Products that reached `consumePurchase()` in this session. */
  consumed: string[];
  /** Products the fake platform still holds as paid (tokens → product id). */
  pending: Record<string, string>;
  /** Marks a purchase as unprocessed — as a lost connection would. */
  addPending: (id: string) => string;
}

export interface MockSdkOptions {
  /** `ysdk.environment.i18n.lang` the fake portal reports. */
  lang?: string;
  appId?: string;
  /** Start value of the fake `serverTime()`. */
  timeMs?: number;
  /** Mutable clock: every call to `serverTime()` shifts by this many ms. */
  timeStepMs?: number;
  /** Real time is used when `timeMs` is not given. */
  now?: () => number;
  /** Starts in fullscreen, as the platform may do for a launch ad. */
  fullscreen?: boolean;
  /** Rejects `YaGames.init()` — the "SDK is broken" case. */
  failInit?: boolean;
  /** Never resolves `YaGames.init()` — the "SDK hangs" case. */
  hangInit?: boolean;
  /** The player object (`ysdk.getPlayer()`) — cloud saves. */
  player?: MockPlayerOptions;
  /** `ysdk.getStorage()`: starts missing, as on desktop platforms. */
  storage?: boolean;
  /** `ysdk.adv` — interstitial, rewarded video and the banner. */
  adv?: MockAdvOptions;
  /** `ysdk.leaderboards` — three tables of the ranking (stage 10). */
  leaderboards?: MockLeaderboardOptions;
  /** `ysdk.getFlags()` — the remote configuration of the Console. */
  flags?: Record<string, string>;
  /** Rejects `getFlags()` — the "no remote configuration" case. */
  flagsFail?: boolean;
  /** `ysdk.payments` — in-app purchases. */
  payments?: MockPaymentsOptions;
}

export interface MockSdkCalls {
  ready: number;
  start: number;
  stop: number;
  fullscreenOn: number;
  fullscreenOff: number;
  getPlayer: number;
  setData: number;
  getData: number;
  setStats: number;
  authDialogs: number;
  fullscreenAdv: number;
  rewardedVideo: number;
  bannerStatus: number;
  bannerShow: number;
  bannerHide: number;
  lbDescription: number;
  lbSetScore: number;
  lbEntries: number;
  lbAvailableChecks: number;
  getFlags: number;
  payCatalog: number;
  payPurchases: number;
  payPurchase: number;
  payConsume: number;
}

export interface MockAdController {
  /** The interstitial is on screen and waits for `closeInterstitial()`. */
  interstitialOpen: boolean;
  /** The rewarded video is on screen. */
  rewardedOpen: boolean;
  /** Finishes the interstitial with the `wasShown` flag. */
  closeInterstitial: (wasShown?: boolean) => void;
  /** Fires `onRewarded` — the player watched the video to the end. */
  reward: () => void;
  /** Finishes the rewarded video (`reward()` first when the view counted). */
  closeRewarded: (wasShown?: boolean) => void;
  /** Fails the currently open ad. */
  fail: () => void;
  /** `true` while the platform reports the banner as shown. */
  bannerShown: () => boolean;
}

export interface MockSdk {
  calls: MockSdkCalls;
  /** Manual control over the ad flow (like the real ad network). */
  ads: MockAdController;
  /** Fake leaderboards: what the game sent and what other players scored. */
  lb: MockLeaderboardController;
  /** Fake purchases: what the player bought, consumed and still owes. */
  pay: MockPaymentsController;
  /** Cloud content of the fake player (what `getData()` returns). */
  cloud: Record<string, unknown>;
  /** Makes the fake player authorized / a guest. */
  setAuthorized: (authorized: boolean) => void;
  /** Drops / restores the connection (both directions of the cloud). */
  setOnline: (online: boolean) => void;
  /** Emits `game_api_pause` to every registered listener. */
  pause: () => void;
  /** Emits `game_api_resume` to every registered listener. */
  resume: () => void;
  /** Current fake fullscreen status (`'on'` / `'off'`). */
  fullscreenStatus: () => string;
  /** Installs the fake into `window` so `initPlatform()` picks it up. */
  install: (windowRef?: Window) => void;
}

/** Builds a fake SDK session; `install()` puts `YaGames` on the window. */
export function createMockSdk(options: MockSdkOptions = {}): MockSdk {
  const lang = options.lang ?? 'ru';
  const step = options.timeStepMs ?? 0;
  let time = options.timeMs ?? Date.now();

  const calls: MockSdkCalls = {
    ready: 0,
    start: 0,
    stop: 0,
    fullscreenOn: 0,
    fullscreenOff: 0,
    getPlayer: 0,
    setData: 0,
    getData: 0,
    setStats: 0,
    authDialogs: 0,
    fullscreenAdv: 0,
    rewardedVideo: 0,
    bannerStatus: 0,
    bannerShow: 0,
    bannerHide: 0,
    lbDescription: 0,
    lbSetScore: 0,
    lbEntries: 0,
    lbAvailableChecks: 0,
    getFlags: 0,
    payCatalog: 0,
    payPurchases: 0,
    payPurchase: 0,
    payConsume: 0,
  };
  const advOptions = options.adv ?? {};
  const adsEnabled = advOptions.enabled ?? true;
  let bannerShown = false;
  const playerOptions = options.player ?? {};
  const cloud: Record<string, unknown> = { ...(playerOptions.data ?? {}) };
  let authorized = playerOptions.authorized ?? true;
  let failGet = playerOptions.failGet === true;
  let failSet = playerOptions.failSet === true;
  const listeners: Record<string, Array<() => void>> = {};
  let status = options.fullscreen ? 'on' : 'off';

  const serverTime = (): number => {
    const value = options.timeMs === undefined ? (options.now ? options.now() : Date.now()) : time;
    time += step;
    return value;
  };

  const player = {
    isAuthorized: () => authorized,
    /** Used as a `getFlags` client feature: a paying player may get other flags. */
    getPayingStatus: () => (Object.keys(pendingTokens).length > 0 || consumed.length > 0 ? 'paying' : 'not_paying'),
    getUniqueID: () => playerOptions.id ?? 'mock-player-1',
    getName: () => playerOptions.name ?? 'Игрок',
    getPhoto: () => 'https://example.com/photo.png',
    getData: async (keys?: string[]) => {
      calls.getData += 1;
      if (failGet) throw new Error('mock getData failed');
      if (!keys) return { ...cloud };
      const result: Record<string, unknown> = {};
      for (const key of keys) if (key in cloud) result[key] = cloud[key];
      return result;
    },
    setData: async (data: object) => {
      calls.setData += 1;
      if (failSet) throw new Error('mock setData failed');
      Object.assign(cloud, data);
    },
    setStats: async (stats: object) => {
      calls.setStats += 1;
      Object.assign(cloud, stats);
    },
    getStats: async () => ({ ...cloud }),
  };

  let fullscreenCallbacks: { onOpen?: () => void; onClose?: (wasShown: boolean) => void; onError?: (error: unknown) => void } | null = null;
  let rewardedCallbacks: { onOpen?: () => void; onRewarded?: () => void; onClose?: (wasShown: boolean) => void; onError?: (error: unknown) => void } | null = null;

  const adController: MockAdController = {
    get interstitialOpen() {
      return fullscreenCallbacks !== null;
    },
    get rewardedOpen() {
      return rewardedCallbacks !== null;
    },
    closeInterstitial: (wasShown = true) => {
      const callbacks = fullscreenCallbacks;
      fullscreenCallbacks = null;
      callbacks?.onClose?.(wasShown);
    },
    reward: () => {
      rewardedCallbacks?.onRewarded?.();
    },
    closeRewarded: (wasShown = true) => {
      const callbacks = rewardedCallbacks;
      rewardedCallbacks = null;
      callbacks?.onClose?.(wasShown);
    },
    fail: () => {
      const fullscreen = fullscreenCallbacks;
      const rewarded = rewardedCallbacks;
      fullscreenCallbacks = null;
      rewardedCallbacks = null;
      fullscreen?.onError?.(new Error('mock ad error'));
      rewarded?.onError?.(new Error('mock ad error'));
    },
    bannerShown: () => bannerShown,
  };

  const adv = {
    showFullscreenAdv: (options2?: { callbacks?: { onOpen?: () => void; onClose?: (wasShown: boolean) => void; onError?: (error: unknown) => void } }) => {
      calls.fullscreenAdv += 1;
      if (advOptions.throws) throw new Error('mock fullscreen adv failed');
      if (!adsEnabled || advOptions.fullscreenAvailable === false) {
        options2?.callbacks?.onClose?.(false);
        return;
      }
      fullscreenCallbacks = options2?.callbacks ?? {};
      fullscreenCallbacks.onOpen?.();
    },
    showRewardedVideo: (options2?: { callbacks?: { onOpen?: () => void; onRewarded?: () => void; onClose?: (wasShown: boolean) => void; onError?: (error: unknown) => void } }) => {
      calls.rewardedVideo += 1;
      if (advOptions.throws) throw new Error('mock rewarded video failed');
      if (!adsEnabled || advOptions.rewardedAvailable === false) {
        options2?.callbacks?.onClose?.(false);
        return;
      }
      rewardedCallbacks = options2?.callbacks ?? {};
      rewardedCallbacks.onOpen?.();
    },
    getBannerAdvStatus: async () => {
      calls.bannerStatus += 1;
      if (advOptions.bannerFails) throw new Error('mock banner status failed');
      if (!adsEnabled) return { stickyAdvIsShowing: false, reason: 'ADV_IS_NOT_CONNECTED' };
      return advOptions.bannerManaged
        ? { stickyAdvIsShowing: bannerShown }
        : { stickyAdvIsShowing: bannerShown, reason: 'ADV_IS_NOT_CONNECTED' };
    },
    showBannerAdv: async () => {
      calls.bannerShow += 1;
      bannerShown = true;
      return advOptions.bannerManaged
        ? { stickyAdvIsShowing: true }
        : { stickyAdvIsShowing: false, reason: 'ADV_IS_NOT_CONNECTED' };
    },
    hideBannerAdv: async () => {
      calls.bannerHide += 1;
      bannerShown = false;
      return { stickyAdvIsShowing: false };
    },
  };

  // ---------------------------------------------------------- leaderboards
  const lbOptions = options.leaderboards ?? {};
  const lbEnabled = lbOptions.enabled ?? true;
  const sent: Record<string, number[]> = {};
  const boards: Record<string, Map<string, number>> = {};
  for (const [name, rows] of Object.entries(lbOptions.seeded ?? {})) {
    const board = new Map<string, number>();
    for (const [player, score] of rows) board.set(player, score);
    boards[name] = board;
  }
  const boardRows = (sdkName: string): Array<{ name: string; score: number }> =>
    [...(boards[sdkName]?.entries() ?? [])]
      .map(([name, score]) => ({ name, score }))
      .sort((a, b) => b.score - a.score);

  const leaderboardController: MockLeaderboardController = {
    sent,
    board: (sdkName) => boardRows(sdkName),
    seed: (sdkName, name, score) => {
      const board = boards[sdkName] ?? new Map<string, number>();
      board.set(name, score);
      boards[sdkName] = board;
    },
  };

  const failLeaderboard = (): never => {
    throw new Error('mock leaderboard failed');
  };
  const leaderboards = {
    getDescription: async (sdkName: string) => {
      calls.lbDescription += 1;
      if (lbOptions.fail) return failLeaderboard();
      if (lbOptions.missing) {
        throw Object.assign(new Error('mock leaderboard is missing'), { code: 404 });
      }
      return {
        name: sdkName,
        default: sdkName === 'shelf_mastery',
        title: { ru: sdkName, en: sdkName },
        description: { invert_sort_order: false, sort_order: 'DESC', score_format: { options: { decimal_offset: 0 }, type: 'numeric' } },
      };
    },
    setScore: async (sdkName: string, score: number) => {
      calls.lbSetScore += 1;
      if (lbOptions.fail) return failLeaderboard();
      if (lbOptions.missing) {
        throw Object.assign(new Error('mock leaderboard is missing'), { code: 404 });
      }
      if (!authorized) throw Object.assign(new Error('mock player is not authorized'), { code: 'UNAUTHORIZED' });
      (sent[sdkName] ??= []).push(score);
      const board = boards[sdkName] ?? new Map<string, number>();
      board.set(meName, Math.max(board.get(meName) ?? 0, score));
      boards[sdkName] = board;
    },
    getPlayerEntry: async (sdkName: string) => {
      calls.lbEntries += 1;
      if (lbOptions.fail) return failLeaderboard();
      if (lbOptions.missing) {
        throw Object.assign(new Error('mock leaderboard is missing'), { code: 404 });
      }
      const rows = boardRows(sdkName);
      const index = rows.findIndex((row) => row.name === meName);
      if (index < 0) throw Object.assign(new Error('no entry'), { code: 'LEADERBOARD_PLAYER_NOT_PRESENT' });
      return { rank: index + 1, score: rows[index]?.score ?? 0, extraData: '', player: mockEntryPlayer(meName) };
    },
    getEntries: async (
      sdkName: string,
      options2?: { includeUser?: boolean; quantityAround?: number; quantityTop?: number },
    ) => {
      calls.lbEntries += 1;
      if (lbOptions.fail) return failLeaderboard();
      if (lbOptions.missing) {
        throw Object.assign(new Error('mock leaderboard is missing'), { code: 404 });
      }
      if (lbOptions.hang) await new Promise(() => {});
      const rows = boardRows(sdkName);
      const top = Math.max(1, Math.min(20, options2?.quantityTop ?? 5));
      const mine = authorized ? rows.findIndex((row) => row.name === meName) : -1;
      const around = Math.max(0, Math.min(10, options2?.quantityAround ?? 0));
      const wanted = new Set<number>();
      for (let index = 0; index < Math.min(top, rows.length); index += 1) wanted.add(index);
      if (mine >= 0 && options2?.includeUser) {
        for (let index = Math.max(0, mine - around); index <= Math.min(rows.length - 1, mine + around); index += 1) {
          wanted.add(index);
        }
      }
      const entries = [...wanted]
        .sort((a, b) => a - b)
        .map((index) => ({
          rank: index + 1,
          score: rows[index]?.score ?? 0,
          extraData: '',
          player: mockEntryPlayer(rows[index]?.name ?? ''),
        }));
      return { entries, userRank: mine >= 0 && options2?.includeUser ? mine + 1 : 0 };
    },
  };

  // The player of the session keeps the id of `getUniqueID()` — that is how the
  // game recognises its own row in the table.
  const meName = playerOptions.name ?? 'Игрок';
  const mockEntryPlayer = (name: string) => ({
    publicName: name,
    uniqueID: name === meName ? (playerOptions.id ?? 'mock-player-1') : `mock-${name}`,
    getAvatarSrc: (size: 'small' | 'medium' | 'large' = 'small') => `https://example.com/${encodeURIComponent(name)}-${size}.png`,
    getAvatarSrcSet: () => `https://example.com/${encodeURIComponent(name)}.png 2x`,
  });

  // --------------------------------------------------------------- purchases
  const payOptions = options.payments ?? {};
  const payCatalog = payOptions.catalog ?? [];
  const consumed: string[] = [];
  let tokenSeed = 0;
  const pendingTokens: Record<string, string> = {};
  for (const id of payOptions.pending ?? []) {
    tokenSeed += 1;
    pendingTokens[`mock-token-${tokenSeed}`] = id;
  }
  const paymentsController: MockPaymentsController = {
    consumed,
    pending: pendingTokens,
    addPending: (id: string) => {
      tokenSeed += 1;
      const token = `mock-token-${tokenSeed}`;
      pendingTokens[token] = id;
      return token;
    },
  };

  const payments = {
    getCatalog: async () => {
      calls.payCatalog += 1;
      if (payOptions.fail) throw new Error('mock payments failed');
      if (!payOptions.enabled) throw new Error('mock payments are off');
      return payCatalog.map((item) => ({
        id: item.id,
        title: item.title ?? item.id,
        description: item.description ?? '',
        imageURI: `https://example.com/${item.id}.png`,
        price: item.price ?? `99 ${item.currency ?? 'YAN'}`,
        priceValue: (item.price ?? '99').replace(/[^0-9.,]/g, '') || '99',
        priceCurrencyCode: item.currency ?? 'YAN',
        getPriceCurrencyImage: (size: 'small' | 'medium' | 'svg' = 'small') =>
          `https://yastatic.net/currency/${(item.currency ?? 'YAN').toLowerCase()}-${size}.svg`,
      }));
    },
    getPurchases: async () => {
      calls.payPurchases += 1;
      if (payOptions.fail) throw new Error('mock payments failed');
      if (!payOptions.enabled) throw new Error('mock payments are off');
      return Object.entries(pendingTokens).map(([token, productID]) => ({
        productID,
        purchaseToken: token,
        developerPayload: '',
      }));
    },
    purchase: async (data: { id: string }) => {
      calls.payPurchase += 1;
      if (payOptions.fail || !payOptions.enabled) throw new Error('mock payments failed');
      if (payOptions.decline) throw new Error('mock purchase declined');
      const product = payCatalog.find((item) => item.id === data.id);
      if (!product) throw new Error('mock product is missing');
      const token = paymentsController.addPending(data.id);
      return { productID: data.id, purchaseToken: token, developerPayload: '' };
    },
    consumePurchase: async (token: string) => {
      calls.payConsume += 1;
      if (payOptions.fail || !payOptions.enabled) throw new Error('mock payments failed');
      if (!(token in pendingTokens)) throw new Error('mock token is unknown');
      consumed.push(pendingTokens[token] as string);
      delete pendingTokens[token];
    },
  };

  // ------------------------------------------------------------ remote config
  const flagValues = options.flags ?? {};

  const sdk = {
    environment: { app: { id: options.appId ?? 'mock-app' }, i18n: { lang }, payload: '' },
    features: {
      LoadingAPI: { ready: () => { calls.ready += 1; } },
      GameplayAPI: {
        start: () => { calls.start += 1; },
        stop: () => { calls.stop += 1; },
      },
    },
    screen: {
      fullscreen: {
        STATUS_ON: 'on',
        STATUS_OFF: 'off',
        get status() {
          return status;
        },
        request: async () => {
          if (status === 'on') return;
          status = 'on';
          calls.fullscreenOn += 1;
        },
        exit: async () => {
          if (status === 'off') return;
          status = 'off';
          calls.fullscreenOff += 1;
        },
      },
    },
    serverTime,
    adv,
    getFlags: async (params?: {
      defaultFlags?: Record<string, string>;
      clientFeatures?: Array<{ name: string; value: string }>;
    }) => {
      calls.getFlags += 1;
      if (options.flagsFail) throw new Error('mock getFlags failed');
      return { ...(params?.defaultFlags ?? {}), ...flagValues };
    },
    payments: payOptions.enabled ? payments : undefined,
    getPayments: async () => {
      if (!payOptions.enabled) throw new Error('mock payments are off');
      return payments;
    },
    leaderboards: lbEnabled ? leaderboards : undefined,
    isAvailableMethod: async (method: string) => {
      calls.lbAvailableChecks += 1;
      if (method === 'leaderboards.setScore') return lbEnabled && lbOptions.canSetScore !== false;
      if (method.startsWith('leaderboards.')) return lbEnabled;
      return true;
    },
    getPlayer: async () => {
      calls.getPlayer += 1;
      return player;
    },
    auth: {
      openAuthDialog: async () => {
        calls.authDialogs += 1;
        // The platform dialog is followed by a real authorization in the tests.
        authorized = true;
      },
    },
    getStorage: async () => {
      if (!options.storage) throw new Error('mock storage is off');
      const map = new Map<string, string>();
      return {
        get length() {
          return map.size;
        },
        clear: () => map.clear(),
        getItem: (key: string) => map.get(key) ?? null,
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => {
          map.delete(key);
        },
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
      } as Storage;
    },
    on: (event: string, listener: () => void) => {
      (listeners[event] ??= []).push(listener);
    },
    off: (event: string, listener: () => void) => {
      listeners[event] = (listeners[event] ?? []).filter((entry) => entry !== listener);
    },
  };

  const emit = (event: string): void => {
    for (const listener of [...(listeners[event] ?? [])]) listener();
  };

  return {
    calls,
    cloud,
    ads: adController,
    lb: leaderboardController,
    pay: paymentsController,
    setAuthorized: (value: boolean) => {
      authorized = value;
    },
    setOnline: (value: boolean) => {
      failGet = !value;
      failSet = !value;
    },
    pause: () => emit('game_api_pause'),
    resume: () => emit('game_api_resume'),
    fullscreenStatus: () => status,
    install: (windowRef: Window = window) => {
      (windowRef as unknown as { YaGames?: unknown }).YaGames = {
        init: () =>
          options.failInit
            ? Promise.reject(new Error('mock init failed'))
            : options.hangInit
              ? new Promise(() => {})
              : Promise.resolve(sdk),
      };
    },
  };
}

/** `true` when the URL asks for the mock (`?sdk=mock`, `?sdk=1`). */
export function mockRequested(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query.length === 0) return false;
  const value = new URLSearchParams(query).get('sdk');
  return value === 'mock' || value === '1' || value === 'true';
}

/** The SDK is already available — nothing to load. */
export const MOCK_SDK_PATH = SDK_SCRIPT_PATH;
