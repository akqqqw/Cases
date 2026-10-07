/**
 * Advertising on the Yandex Games platform.
 *
 * The rules below are taken verbatim from the platform documentation
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-adv and
 *  https://yandex.com/dev/games/doc/en/requirements/4/4 — item 4.4), and they
 * are enforced in code, not by convention:
 *
 *  - an interstitial is shown **only at a logical pause**: the player pressed
 *    «Дальше», «Заново» or opened the shop. The call happens right inside the
 *    click handler, so the delay between the action and the ad is ~0 (the
 *    requirement allows at most 2 seconds);
 *  - an interstitial is **never** shown while a level is being played
 *    (`phase === 'playing'` → the call is refused);
 *  - the frequency is capped twice: at least 3 minutes between two interstitials
 *    and at least two finished levels between them. The platform controls the
 *    real frequency on top of that and warns about too-frequent calls;
 *  - the game is paused and the sound is muted for the whole ad — the player can
 *    not interact with the level, so accidental clicks are impossible (the docs
 *    call accidental clicks ad fraud);
 *  - a rewarded video always stays **voluntary** and the reward is granted only
 *    inside `onRewarded`, i.e. after the platform confirmed the view. Closing the
 *    video early gives nothing;
 *  - the sticky banner is optional: it is shown in menus and hidden during a
 *    level, and only when the Developer Console hands banner control to the API.
 *
 * Everything is a no-op without the platform: a plain web build has no ads at
 * all, and the game keeps playing.
 */
import { now } from '../data/clock';
import { audio } from '../game/audio';
import { localStorageAdapter } from '../store/persistence';
import { flagNumber } from './flags';
import { sdkSession } from './yandex';

export type AdKind = 'interstitial' | 'rewarded';
/** Where the player was when the ad appeared (analytics of stage 11 reads it). */
export type AdPlacement =
  | 'level-next'
  | 'level-replay'
  | 'level-double'
  | 'revive'
  | 'shop-coins'
  | 'shop-booster';

export type AdOutcome = 'shown' | 'rewarded' | 'closed' | 'not-shown' | 'error';

/** Why an ad was not even requested. */
export type AdSkipReason = 'no-platform' | 'in-play' | 'too-often' | 'too-soon' | 'busy' | 'off';

export interface AdResult {
  kind: AdKind;
  placement: AdPlacement;
  outcome: AdOutcome;
  /** Filled when the ad never started. */
  reason?: AdSkipReason;
}

/** Interstitials: never more often than this. */
export const INTERSTITIAL_MIN_INTERVAL_MS = 3 * 60 * 1000;
/** ... and never more often than every second finished level. */
export const INTERSTITIAL_LEVELS_BETWEEN = 2;
/** A safety net on top of the platform's own frequency control. */
export const INTERSTITIAL_MAX_PER_SESSION = 8;
/** The docs allow at most 2 seconds between the action and the ad. */
export const INTERSTITIAL_MAX_DELAY_MS = 2_000;

/**
 * The same three limits, but read from the remote configuration (the Console
 * «Флаги» tab): an experiment can raise or lower the ad pressure without a new
 * build. The constants above stay the defaults embedded in `localFlags`.
 */
export function flagMinIntervalMs(): number {
  return Math.max(0, flagNumber('ads_min_interval_min')) * 60_000;
}

export function flagLevelsBetween(): number {
  return Math.max(1, Math.round(flagNumber('ads_levels_between')));
}

export function flagMaxPerSession(): number {
  return Math.max(0, Math.round(flagNumber('ads_max_per_session')));
}

/** Coins for one watched video (the shop shows the same number). */
export function flagCoinReward(): number {
  return Math.max(0, Math.round(flagNumber('ad_reward_coins')));
}

/** How many times a day the rewarded video pays coins (the doubling counts too). */
export function flagCoinsPerDay(): number {
  return Math.max(0, Math.round(flagNumber('ad_rewards_per_day')));
}

export interface BannerStatus {
  /** The Console option "use the API to display a sticky banner" is on. */
  managed: boolean;
  showing: boolean;
  /** The last platform reason (`ADV_IS_NOT_CONNECTED`, `UNKNOWN`, …). */
  reason: string | null;
  supported: boolean;
}

export interface AdsStatus {
  /** `ysdk.adv` is available. */
  available: boolean;
  /** An ad is on screen right now. */
  showing: boolean;
  kind: AdKind | null;
  placement: AdPlacement | null;
  interstitials: number;
  rewarded: number;
  lastInterstitialAt: number | null;
  /** Finished levels since the last interstitial. */
  levelsSinceInterstitial: number;
  banner: BannerStatus;
  last: AdResult | null;
}

export const EMPTY_ADS_STATUS: AdsStatus = {
  available: false,
  showing: false,
  kind: null,
  placement: null,
  interstitials: 0,
  rewarded: 0,
  lastInterstitialAt: null,
  // A session starts with a clean counter: the first ad needs two finished levels.
  levelsSinceInterstitial: 0,
  banner: { managed: false, showing: false, reason: null, supported: false },
  last: null,
};

/** Survives a page reload, so reloading the game does not reset the interval. */
const STAMP_KEY = 'shelf-sort:ads:last-interstitial';

let status: AdsStatus = { ...EMPTY_ADS_STATUS };
let initialized = false;
let inFlight: Promise<AdResult> | null = null;

const listeners = new Set<(value: AdsStatus) => void>();

/**
 * The store tells the ad layer which screen the player is on. It is injected
 * (`connectAds`) instead of imported, so the modules do not form a cycle: the
 * store imports the ad layer, never the other way round.
 */
export interface AdsHost {
  phase: () => string;
  /**
   * `true` when the player bought the «no ads» product. Requirement 4.4:
   * a game that sells ad disabling must not show interstitials — the rewarded
   * video stays available, because the player asks for it explicitly.
   */
  adsOff?: () => boolean;
}

let host: AdsHost | null = null;

export function connectAds(next: AdsHost): void {
  host = next;
}

function currentPhase(): string {
  return host?.phase() ?? 'menu';
}

/** The player paid to switch the ads off. */
export function adsDisabled(): boolean {
  return host?.adsOff?.() === true;
}

export function adsStatus(): AdsStatus {
  return { ...status, banner: { ...status.banner } };
}

export function subscribeAds(listener: (value: AdsStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<AdsStatus>): AdsStatus {
  status = { ...status, ...patch };
  const snapshot = adsStatus();
  for (const listener of [...listeners]) listener(snapshot);
  return snapshot;
}

/** Reads the persisted stamp of the last interstitial. */
function readStamp(): number | null {
  try {
    const raw = localStorageAdapter()?.getItem(STAMP_KEY) ?? null;
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStamp(at: number): void {
  try {
    localStorageAdapter()?.setItem(STAMP_KEY, String(at));
  } catch {
    /* ignore: the frequency limit then only lives in memory */
  }
}

/** The ad API of the current session, `null` without the platform. */
function adApi(): NonNullable<ReturnType<typeof sdkSession>>['adv'] | null {
  const sdk = sdkSession();
  return sdk?.adv ?? null;
}

export function adsAvailable(): boolean {
  const adv = adApi();
  return Boolean(adv && (typeof adv.showFullscreenAdv === 'function' || typeof adv.showRewardedVideo === 'function'));
}

/**
 * Called once after the platform boot: reads the banner state and the persisted
 * interstitial stamp.
 */
export async function initAds(): Promise<AdsStatus> {
  initialized = true;
  const adv = adApi();
  if (!adv) {
    return publish({ ...EMPTY_ADS_STATUS, available: false });
  }

  const stamp = readStamp();
  publish({
    available: true,
    interstitials: 0,
    rewarded: 0,
    lastInterstitialAt: stamp,
    levelsSinceInterstitial: 0,
    banner: { ...status.banner, supported: typeof adv.getBannerAdvStatus === 'function' },
  });

  if (typeof adv.getBannerAdvStatus === 'function') {
    try {
      const result = await adv.getBannerAdvStatus();
      publish({
        banner: {
          supported: true,
          // The status call works even when the API does not control the
          // banner: in that case the platform ignores show/hide, which is fine.
          managed: result?.reason !== 'ADV_IS_NOT_CONNECTED',
          showing: result?.stickyAdvIsShowing === true,
          reason: result?.reason ?? null,
        },
      });
    } catch {
      publish({ banner: { ...status.banner, supported: false } });
    }
  }

  return adsStatus();
}

/** A level was won: the counter that gates the next interstitial grows. */
export function noteLevelFinished(): void {
  publish({ levelsSinceInterstitial: status.levelsSinceInterstitial + 1 });
}

/** The level was restarted: nothing is counted, the gate stays as it was. */
export function interstitialReady(): { allowed: boolean; reason?: AdSkipReason } {
  if (adsDisabled()) return { allowed: false, reason: 'off' };
  if (!adsAvailable()) return { allowed: false, reason: 'no-platform' };
  if (inFlight) return { allowed: false, reason: 'busy' };
  if (currentPhase() === 'playing') return { allowed: false, reason: 'in-play' };
  if (status.levelsSinceInterstitial < flagLevelsBetween()) return { allowed: false, reason: 'too-often' };
  if (status.interstitials >= flagMaxPerSession()) return { allowed: false, reason: 'too-often' };

  const last = status.lastInterstitialAt;
  if (last !== null && now() - last < flagMinIntervalMs()) return { allowed: false, reason: 'too-soon' };
  return { allowed: true };
}

/** Rewarded videos have no platform limit; the quota lives in the game. */
export function rewardedReady(): { allowed: boolean; reason?: AdSkipReason } {
  if (!adsAvailable()) return { allowed: false, reason: 'no-platform' };
  if (inFlight) return { allowed: false, reason: 'busy' };
  if (currentPhase() === 'playing') return { allowed: false, reason: 'in-play' };
  return { allowed: true };
}

function beginAd(kind: AdKind, placement: AdPlacement): void {
  // Pause the game and mute the sound for the whole ad (item 4.4: the game must
  // be paused during the show; the platform also stops the gameplay markup).
  audio.suspend();
  publish({ showing: true, kind, placement });
}

function finishAd(kind: AdKind, placement: AdPlacement, outcome: AdOutcome): AdResult {
  audio.restore();
  const patch: Partial<AdsStatus> = {
    showing: false,
    kind: null,
    placement: null,
    last: { kind, placement, outcome },
  };
  patch[kind === 'interstitial' ? 'interstitials' : 'rewarded'] =
    (kind === 'interstitial' ? status.interstitials : status.rewarded) + 1;
  publish(patch);
  return { kind, placement, outcome };
}

/**
 * Full-screen (interstitial) ad. Resolves after the ad closes; `outcome` is
 * `not-shown` when the platform declined the call (for example because the
 * player already saw ads too often).
 */
export function showInterstitial(placement: AdPlacement): Promise<AdResult> {
  const ready = interstitialReady();
  if (!ready.allowed) {
    const result: AdResult = { kind: 'interstitial', placement, outcome: 'not-shown', reason: ready.reason };
    publish({ last: result });
    return Promise.resolve(result);
  }

  const adv = adApi();
  const showFullscreenAdv = adv?.showFullscreenAdv;
  if (!adv || typeof showFullscreenAdv !== 'function') {
    return Promise.resolve({ kind: 'interstitial', placement, outcome: 'not-shown', reason: 'no-platform' });
  }

  const startedAt = now();
  beginAd('interstitial', placement);

  const promise = new Promise<AdResult>((resolve) => {
    let settled = false;
    const settle = (outcome: AdOutcome, reason?: AdSkipReason): void => {
      if (settled) return;
      settled = true;
      const result = finishAd('interstitial', placement, outcome);
      // The stamp is written even when the ad was not shown: the platform
      // counted the call and the next one must not come sooner either.
      status = { ...status, lastInterstitialAt: startedAt, levelsSinceInterstitial: 0 };
      writeStamp(startedAt);
      publish({});
      resolve(reason ? { ...result, reason } : result);
    };

    try {
      showFullscreenAdv.call(adv, {
        callbacks: {
          onClose: (wasShown: boolean) => settle(wasShown ? 'shown' : 'not-shown'),
          onError: () => settle('error'),
        },
      });
    } catch {
      settle('error');
    }
  });

  inFlight = promise;
  // The promise is assigned *after* the callbacks may have fired (the platform
  // can answer synchronously), so the flag is cleared here, not inside `settle`.
  void promise.then(() => {
    if (inFlight === promise) inFlight = null;
  });
  return promise;
}

/**
 * Rewarded video. The promise resolves with `rewarded` **only** when the
 * platform fired `onRewarded`; `closed` means the player skipped the video and
 * gets nothing.
 */
export function showRewarded(placement: AdPlacement): Promise<AdResult> {
  const ready = rewardedReady();
  if (!ready.allowed) {
    const result: AdResult = { kind: 'rewarded', placement, outcome: 'not-shown', reason: ready.reason };
    publish({ last: result });
    return Promise.resolve(result);
  }

  const adv = adApi();
  const showRewardedVideo = adv?.showRewardedVideo;
  if (!adv || typeof showRewardedVideo !== 'function') {
    return Promise.resolve({ kind: 'rewarded', placement, outcome: 'not-shown', reason: 'no-platform' });
  }

  beginAd('rewarded', placement);

  const promise = new Promise<AdResult>((resolve) => {
    let rewarded = false;
    let settled = false;
    const settle = (outcome: AdOutcome): void => {
      if (settled) return;
      settled = true;
      if (rewarded && outcome !== 'rewarded') outcome = 'rewarded';
      const result = finishAd('rewarded', placement, outcome);
      resolve(result);
    };

    try {
      showRewardedVideo.call(adv, {
        callbacks: {
          onRewarded: () => {
            rewarded = true;
          },
          onClose: (wasShown: boolean) => settle(rewarded ? 'rewarded' : wasShown ? 'closed' : 'not-shown'),
          onError: () => settle('error'),
        },
      });
    } catch {
      settle('error');
    }
  });

  inFlight = promise;
  void promise.then(() => {
    if (inFlight === promise) inFlight = null;
  });
  return promise;
}

/**
 * Sticky banner: visible in menus, hidden while a level is played (item 4.4 —
 * the ad must not interfere with the game). Silently does nothing when the
 * Console does not hand banner control to the API.
 */
export async function setBannerVisible(visible: boolean): Promise<BannerStatus> {
  const adv = adApi();
  if (!adv || !initialized) return { ...status.banner };
  if (visible && adsDisabled()) visible = false;
  if (status.banner.showing === visible) return { ...status.banner };
  if (!status.banner.managed) {
    // The platform shows the banner itself; the button would be ignored.
    publish({ banner: { ...status.banner, showing: visible } });
    return { ...status.banner };
  }

  try {
    if (visible && typeof adv.showBannerAdv === 'function') {
      const result = await adv.showBannerAdv();
      publish({
        banner: {
          ...status.banner,
          showing: result?.stickyAdvIsShowing === true,
          reason: result?.reason ?? null,
        },
      });
    } else if (!visible && typeof adv.hideBannerAdv === 'function') {
      const result = await adv.hideBannerAdv();
      publish({ banner: { ...status.banner, showing: result?.stickyAdvIsShowing === true } });
    } else {
      publish({ banner: { ...status.banner, showing: visible } });
    }
  } catch {
    publish({ banner: { ...status.banner, reason: 'UNKNOWN' } });
  }

  return { ...status.banner };
}

/** Keeps the banner in sync with the screen the player is on. */
export function syncBannerForPhase(phase: string = currentPhase()): void {
  if (!initialized) return;
  // A player who bought «no ads» never sees the sticky banner either.
  void setBannerVisible(phase !== 'playing' && !adsDisabled());
}

/** `true` while an ad is on screen (the UI disables its buttons then). */
export function adsShowing(): boolean {
  return status.showing;
}

/**
 * Test seam: forgets the ad state. The host stays connected — the store injects
 * itself once per page, exactly like the cloud subscribers.
 */
export function resetAds(): void {
  inFlight = null;
  initialized = false;
  status = { ...EMPTY_ADS_STATUS, banner: { ...EMPTY_ADS_STATUS.banner } };
}
