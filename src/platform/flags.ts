/**
 * Remote configuration of the platform — the flags of the experiments.
 *
 * Documented API used here
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-config):
 *   - `ysdk.getFlags({ defaultFlags, clientFeatures })` returns a flat object of
 *     string values; the remote configuration from the Console wins over
 *     `defaultFlags`, and the docs ask to request the flags **once at startup**;
 *   - `defaultFlags` is mandatory in practice: without it a lost connection or a
 *     project without a published configuration would leave the game with
 *     nothing to read;
 *   - `clientFeatures` lets the Console target a configuration at the state of
 *     the player (`payingStatus`, the number of cleared levels, the language…).
 *
 * What the game actually tunes with flags (all data-driven, no rebuild needed):
 *   - `ads_min_interval_min` / `ads_levels_between` / `ads_max_per_session` —
 *     how often the interstitial may appear (see `platform/ads.ts`);
 *   - `ad_reward_coins` / `ad_rewards_per_day` — the economy of the rewarded
 *     videos;
 *   - `coins_multiplier` — the A/B surface of the coin economy.
 *
 * Every value is parsed and clamped: a typo in the Console can change the game
 * (that is the point of a remote config) but can never break it — a broken flag
 * silently falls back to the shipped default.
 */
import { isYandex, sdkSession } from './yandex';
import { getLang } from './i18n';
import { localStorageAdapter } from '../store/persistence';

/** Flags the game understands — the local fallback configuration. */
export const LOCAL_FLAGS: Record<string, string> = {
  ads_min_interval_min: '3',
  ads_levels_between: '2',
  ads_max_per_session: '8',
  ad_reward_coins: '60',
  ad_rewards_per_day: '3',
  coins_multiplier: '1',
};

/** Bounds of every numeric flag: `min … max`, clamped on read. */
export const FLAG_LIMITS: Record<string, { min: number; max: number }> = {
  ads_min_interval_min: { min: 0, max: 120 },
  ads_levels_between: { min: 1, max: 20 },
  ads_max_per_session: { min: 0, max: 50 },
  ad_reward_coins: { min: 0, max: 10_000 },
  ad_rewards_per_day: { min: 0, max: 50 },
  coins_multiplier: { min: 0, max: 10 },
};

/** Last successfully read configuration lives here (survives a reload). */
export const FLAGS_CACHE_KEY = 'shelf-sort:flags';

export type FlagsSource = 'remote' | 'cache' | 'local' | 'query' | 'default';

export interface FlagValues {
  adsMinIntervalMin: number;
  adsLevelsBetween: number;
  adsMaxPerSession: number;
  adRewardCoins: number;
  adRewardsPerDay: number;
  coinsMultiplier: number;
}

export interface FlagsStatus {
  /** `true` when the platform answered (or the cache had a configuration). */
  available: boolean;
  source: FlagsSource;
  /** Raw key-value pairs the game received (remote merged over local). */
  raw: Record<string, string>;
  values: FlagValues;
  /** When the configuration was read. */
  loadedAt: number | null;
  error: string | null;
}

/** Client parameter for `getFlags` — a name-value pair, both strings. */
export interface ClientFeature {
  name: string;
  value: string;
}

export function clampFlag(key: string, value: string | undefined): number {
  const limits = FLAG_LIMITS[key] ?? { min: 0, max: Number.MAX_SAFE_INTEGER };
  const fallback = Number(LOCAL_FLAGS[key] ?? 0);
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  if (!Number.isFinite(number)) return limits.min;
  return Math.min(limits.max, Math.max(limits.min, number));
}

/** Typed view of the raw flags — the only thing the game code reads. */
export function valuesFrom(raw: Record<string, string>): FlagValues {
  return {
    adsMinIntervalMin: clampFlag('ads_min_interval_min', raw.ads_min_interval_min),
    adsLevelsBetween: clampFlag('ads_levels_between', raw.ads_levels_between),
    adsMaxPerSession: clampFlag('ads_max_per_session', raw.ads_max_per_session),
    adRewardCoins: clampFlag('ad_reward_coins', raw.ad_reward_coins),
    adRewardsPerDay: clampFlag('ad_rewards_per_day', raw.ad_rewards_per_day),
    coinsMultiplier: clampFlag('coins_multiplier', raw.coins_multiplier),
  };
}

export function emptyFlagsStatus(): FlagsStatus {
  return {
    available: false,
    source: 'default',
    raw: { ...LOCAL_FLAGS },
    values: valuesFrom(LOCAL_FLAGS),
    loadedAt: null,
    error: null,
  };
}

/**
 * Parses `?flags=ads_levels_between=1,coins_multiplier=2` — the developer switch
 * of the preview, applied before the platform can answer (and it wins over the
 * remote configuration, otherwise a local experiment could not be checked).
 */
export function flagsFromQuery(search: string): Record<string, string> {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query.length === 0) return {};
  const value = new URLSearchParams(query).get('flags');
  if (!value) return {};

  const result: Record<string, string> = {};
  for (const pair of value.split(',')) {
    const [rawKey, rawValue] = pair.split('=');
    const key = rawKey?.trim() ?? '';
    if (key.length === 0 || rawValue === undefined) continue;
    if (!(key in LOCAL_FLAGS)) continue; // unknown keys are ignored, not stored
    result[key] = rawValue.trim();
  }
  return result;
}

/** Remote wins over cache, cache over the shipped defaults. */
export function mergeFlags(
  remote: Record<string, string> | null,
  cached: Record<string, string> | null,
): { raw: Record<string, string>; source: FlagsSource } {
  if (remote && Object.keys(remote).length > 0) return { raw: { ...LOCAL_FLAGS, ...remote }, source: 'remote' };
  if (cached && Object.keys(cached).length > 0) return { raw: { ...LOCAL_FLAGS, ...cached }, source: 'cache' };
  return { raw: { ...LOCAL_FLAGS }, source: 'local' };
}

/** Only the strings, only the known keys — anything else is dropped. */
export function sanitizeFlags(input: unknown): Record<string, string> {
  // An array is not a configuration: `Object.entries` would turn it into "0: …".
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length <= 100) result[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = String(value);
  }
  return result;
}

// ------------------------------------------------------------------- live part

let status: FlagsStatus = emptyFlagsStatus();

const listeners = new Set<(value: FlagsStatus) => void>();

export function flagsStatus(): FlagsStatus {
  return { ...status, raw: { ...status.raw } };
}

export function subscribeFlags(listener: (value: FlagsStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<FlagsStatus>): FlagsStatus {
  status = { ...status, ...patch };
  status.values = valuesFrom(status.raw);
  const snapshot = flagsStatus();
  for (const listener of [...listeners]) listener(snapshot);
  return snapshot;
}

/** Current typed values — what the game reads (cheap, no copy of the raw map). */
export function flags(): FlagValues {
  return valuesFrom(status.raw);
}

export function flagNumber(key: keyof typeof FLAG_LIMITS): number {
  return clampFlag(key, status.raw[key]);
}

/** Current client parameters for `getFlags` — the state of this player. */
export function clientFeatures(features: { levels?: number; stars?: number; paying?: string } = {}): ClientFeature[] {
  const list: ClientFeature[] = [{ name: 'lang', value: getLang() }];
  if (features.levels !== undefined) list.push({ name: 'levels', value: String(features.levels) });
  if (features.stars !== undefined) list.push({ name: 'stars', value: String(features.stars) });
  if (features.paying !== undefined) list.push({ name: 'payingStatus', value: features.paying });
  return list;
}

export interface FlagsRequest {
  /** State of the player used as the client parameters of the request. */
  features?: { levels?: number; stars?: number; paying?: string };
  /** `?flags=` value of the current page (the preview override). */
  query?: string;
}

/**
 * Reads the configuration once per session: the query override first, then the
 * platform, then the cache of the last successful read, then the defaults.
 * Never rejects — a game without flags is the normal case, not an error.
 */
export async function initFlags(request: FlagsRequest = {}): Promise<FlagsStatus> {
  const override = flagsFromQuery(request.query ?? (typeof window === 'undefined' ? '' : window.location.search));
  if (Object.keys(override).length > 0) {
    return publish({
      available: true,
      source: 'query',
      raw: { ...LOCAL_FLAGS, ...override },
      loadedAt: Date.now(),
      error: null,
    });
  }

  const cached = readCache();
  if (!isYandex()) {
    const merged = mergeFlags(null, cached);
    return publish({ available: merged.source !== 'local', ...merged, error: null });
  }

  const sdk = sdkSession();
  const request0 = sdk?.getFlags;
  if (typeof request0 !== 'function') {
    const merged = mergeFlags(null, cached);
    return publish({ available: false, ...merged, error: 'no-api' });
  }

  try {
    const remote = sanitizeFlags(
      await withTimeout(
        request0.call(sdk, { defaultFlags: LOCAL_FLAGS, clientFeatures: clientFeatures(request.features) }),
        6_000,
      ),
    );
    const merged = mergeFlags(remote, cached);
    writeCache(merged.raw);
    return publish({ available: true, ...merged, loadedAt: Date.now(), error: null });
  } catch (error) {
    const merged = mergeFlags(null, cached);
    return publish({
      available: false,
      ...merged,
      error: error instanceof Error ? error.message : 'error',
    });
  }
}

function readCache(): Record<string, string> | null {
  try {
    const raw = localStorageAdapter()?.getItem(FLAGS_CACHE_KEY) ?? null;
    if (!raw) return null;
    return sanitizeFlags(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCache(raw: Record<string, string>): void {
  try {
    localStorageAdapter()?.setItem(FLAGS_CACHE_KEY, JSON.stringify(raw));
  } catch {
    /* ignore: the flags then live only in memory */
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('flags timeout')), ms);
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

/** Test seam: forgets the configuration (subscribers stay connected). */
export function resetFlags(): void {
  status = emptyFlagsStatus();
}
