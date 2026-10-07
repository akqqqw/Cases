/**
 * The `Player` object of the Yandex Games SDK — the thin typed layer only.
 * The sync rules live in `cloud.ts`.
 *
 * Documented API used here
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-player):
 *   - `ysdk.getPlayer()` — up to 20 calls per 5 minutes,
 *   - `player.isAuthorized()` — the current way to check authorization
 *     (`getMode()` is deprecated),
 *   - `player.getUniqueID()`, `player.getName()`,
 *   - `player.getData(keys?)` / `player.setData(data, flush)` — 200 KB per
 *     player, 100 calls per 5 minutes,
 *   - `player.setStats()` — numeric values only, 10 KB, 60 calls per minute,
 *   - `ysdk.auth.openAuthDialog()` — the authorization dialog,
 *   - `ysdk.getStorage()` — `localStorage`-compatible storage that survives
 *     iOS resets (the docs recommend it for progress safety).
 */
import { sdkSession } from './yandex';

export interface SdkPlayer {
  isAuthorized?: () => boolean;
  getUniqueID?: () => string;
  getName?: () => string;
  getPhoto?: (size: 'small' | 'medium' | 'large') => string;
  getData?: (keys?: string[]) => Promise<Record<string, unknown>>;
  setData?: (data: object, flush?: boolean) => Promise<void>;
  setStats?: (stats: object) => Promise<void>;
  getStats?: (keys?: string[]) => Promise<Record<string, unknown>>;
}

export interface PlayerHandle {
  player: SdkPlayer;
  authorized: boolean;
  id: string | null;
  name: string | null;
  /** `true` when the player is a guest ("lite") — cloud saves still work. */
  guest: boolean;
}

/** The platform can take a while under throttling: never wait forever. */
const PLAYER_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
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

/** `ysdk.getPlayer()`; `null` when there is no platform or it refuses. */
export async function loadPlayer(): Promise<PlayerHandle | null> {
  const sdk = sdkSession();
  if (!sdk || typeof sdk.getPlayer !== 'function') return null;

  try {
    const player = (await withTimeout(sdk.getPlayer(), PLAYER_TIMEOUT_MS, 'getPlayer timeout')) as SdkPlayer | null;
    if (!player || typeof player.getData !== 'function' || typeof player.setData !== 'function') {
      return null;
    }
    return describePlayer(player);
  } catch {
    return null;
  }
}

/** Reads the authorization state and the profile fields that may exist. */
export function describePlayer(player: SdkPlayer): PlayerHandle {
  let authorized = false;
  try {
    authorized = player.isAuthorized?.() === true;
  } catch {
    authorized = false;
  }

  let id: string | null = null;
  try {
    const value = player.getUniqueID?.();
    id = typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    id = null;
  }

  let name: string | null = null;
  if (authorized) {
    try {
      const value = player.getName?.();
      name = typeof value === 'string' && value.length > 0 ? value : null;
    } catch {
      name = null;
    }
  }

  return { player, authorized, id, name, guest: !authorized };
}

/** Opens the authorization dialog; `true` when the player authorized. */
export async function openAuthDialog(): Promise<boolean> {
  const sdk = sdkSession();
  const open = sdk?.auth?.openAuthDialog;
  if (!sdk || typeof open !== 'function') return false;
  try {
    await open.call(sdk.auth);
    return true;
  } catch {
    return false;
  }
}

/**
 * `ysdk.getStorage()` — the storage the docs recommend for iOS, where plain
 * `localStorage` is often reset. `null` when the platform has no such method.
 */
export async function platformStorage(): Promise<Storage | null> {
  const sdk = sdkSession();
  const get = sdk?.getStorage;
  if (!sdk || typeof get !== 'function') return null;
  try {
    const storage = (await withTimeout(get.call(sdk), PLAYER_TIMEOUT_MS, 'getStorage timeout')) as Storage | null;
    if (!storage) return null;
    if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
    return storage;
  } catch {
    return null;
  }
}
