/**
 * Cloud saves on top of the Yandex Games player data.
 *
 * Rules that come straight from the requirements (item 1.9) and from the SDK
 * limits (https://yandex.com/dev/games/doc/en/sdk/sdk-player):
 *
 *  - the local IndexedDB save stays the primary store and the offline fallback;
 *    the cloud copy is written next to it and is used when the player opens the
 *    game on another device;
 *  - saving happens right after every action (the store autosaves, this module
 *    just mirrors it to the cloud with a debounce and a rate limit — the SDK
 *    allows 100 `setData` calls per 5 minutes);
 *  - the cloud is written for guests too (`player.isAuthorized()` is irrelevant
 *    for `setData`), so progress is never lost while the player is not signed in;
 *  - a newer save is never overwritten by an older or empty one: the decision is
 *    made by `decideSync()` below, which compares how far each save has come and
 *    only then the timestamps;
 *  - one `save` key holds the whole state as JSON (200 KB limit, our save is a
 *    few KB) and `setStats()` mirrors the numeric summary that later stages
 *    (leaderboards, achievements) will read.
 */
import { now } from '../data/clock';
import {
  SAVE_VERSION,
  DEFAULT_PROGRESS,
  clearWipeMarker,
  loadCloudMirror,
  loadWipeMarker,
  migrate,
  progressRank,
  saveCloudMirror,
  setStorageAdapter,
  type PersistedState,
} from '../store/persistence';
import { describePlayer, loadPlayer, openAuthDialog, platformStorage, type PlayerHandle } from './player';
import { isYandex } from './yandex';

/** Key of the save inside the player data (as in the docs' example). */
export const CLOUD_KEY = 'save';
/** Two stamps closer than this are considered "the same moment". */
export const SYNC_TIE_MS = 5_000;
/** Never push more often than this (100 calls / 5 min leaves plenty of room). */
export const MIN_PUSH_INTERVAL_MS = 10_000;
/** Changes are mirrored after a short pause, so a burst of moves is one write. */
export const PUSH_DEBOUNCE_MS = 4_000;
/** Documented limit of `player.setData()`. */
export const MAX_CLOUD_BYTES = 200_000;

export interface CloudEnvelope {
  v: number;
  /** Stamp of the save (see `PersistedState.savedAt`). */
  savedAt: number;
  /** `player.getUniqueID()` of the author, `null` when it was not available. */
  playerId: string | null;
  state: PersistedState;
}

export type CloudAction = 'push' | 'pull' | 'noop';

export type CloudReason =
  | 'no-cloud'
  | 'blank-cloud'
  | 'blank-local'
  | 'legacy-local'
  | 'cloud-newer'
  | 'local-newer'
  | 'cloud-further'
  | 'local-kept'
  | 'another-account'
  | 'local-wiped'
  | 'offline'
  | 'too-big'
  | 'error';

export interface CloudDecision {
  action: CloudAction;
  reason: CloudReason;
}

export type CloudPhase =
  | 'idle'
  | 'disabled'
  | 'syncing'
  | 'synced'
  | 'pushed'
  | 'pulled'
  | 'offline'
  | 'error';

export interface CloudStatus {
  /** The platform is available and the player object was obtained. */
  available: boolean;
  phase: CloudPhase;
  authorized: boolean;
  guest: boolean;
  playerId: string | null;
  playerName: string | null;
  lastSyncAt: number | null;
  /** Local changes that are not in the cloud yet. */
  dirty: boolean;
  reason: CloudReason | null;
  /** Stamp of the save that is known to be in the cloud. */
  cloudSavedAt: number | null;
}

/** Everything the sync needs from the game (the store provides it). */
export interface CloudHost {
  /** The local save that should be mirrored. */
  read: () => PersistedState;
  /**
   * Applies a save that came from the cloud. Optional: a caller that only has
   * something to push (the autosave subscription) passes just `read`.
   */
  apply?: (state: PersistedState) => void;
}

export const EMPTY_CLOUD_STATUS: CloudStatus = {
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
};

// ------------------------------------------------------------------- pure part

export function buildEnvelope(
  state: PersistedState,
  playerId: string | null,
  savedAt: number = state.savedAt,
): CloudEnvelope {
  const stamp = savedAt > 0 ? savedAt : now();
  return { v: SAVE_VERSION, savedAt: stamp, playerId, state: { ...state, savedAt: stamp } };
}

/** Validates whatever came from the cloud and upgrades it like a local save. */
export function parseEnvelope(raw: unknown): CloudEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<CloudEnvelope>;
  // A save written by a future version is refused instead of being mangled.
  if (Number(source.v) > SAVE_VERSION) return null;
  if (!source.state || typeof source.state !== 'object') return null;

  const savedAt = Number(source.savedAt);
  const state = migrate(source.state);
  return {
    v: SAVE_VERSION,
    savedAt: Number.isFinite(savedAt) && savedAt > 0 ? Math.floor(savedAt) : state.savedAt,
    playerId: typeof source.playerId === 'string' && source.playerId.length > 0 ? source.playerId : null,
    state,
  };
}

/**
 * Rank of a fresh save: one unlocked level and the free decoration. Anything at
 * or below it carries no progress a player could lose.
 */
export const BLANK_RANK = progressRank(DEFAULT_PROGRESS);

/**
 * Which save wins. Order matters:
 *   1. no cloud copy at all → create it;
 *   2. an empty cloud copy never overwrites real progress (and vice versa: a
 *      fresh device takes the cloud save);
 *   3. a local save from before the cloud layer is compared by progress only,
 *      because it has no stamp;
 *   4. two real saves are compared by time, then by progress.
 */
export function decideSync(
  local: { savedAt: number; rank: number },
  cloud: CloudEnvelope | null,
): CloudDecision {
  if (!cloud) return { action: 'push', reason: 'no-cloud' };

  const cloudRank = progressRank(cloud.state.progress);
  if (cloudRank <= BLANK_RANK && local.rank > BLANK_RANK) return { action: 'push', reason: 'blank-cloud' };
  if (local.rank <= BLANK_RANK && cloudRank > BLANK_RANK) return { action: 'pull', reason: 'blank-local' };

  if (local.savedAt <= 0) {
    return cloudRank > local.rank
      ? { action: 'pull', reason: 'legacy-local' }
      : { action: 'push', reason: 'legacy-local' };
  }

  if (cloud.savedAt > local.savedAt + SYNC_TIE_MS) return { action: 'pull', reason: 'cloud-newer' };
  if (local.savedAt > cloud.savedAt + SYNC_TIE_MS) return { action: 'push', reason: 'local-newer' };
  if (cloudRank > local.rank) return { action: 'pull', reason: 'cloud-further' };
  return { action: 'push', reason: 'local-kept' };
}

/** Size of the save in bytes — `player.setData()` allows 200 KB per player. */
export function cloudBytes(state: PersistedState): number {
  try {
    return JSON.stringify(buildEnvelope(state, null)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Content of a save without its stamp (used to skip pointless pushes). */
export function contentSignature(state: PersistedState): string {
  try {
    const { savedAt: _stamp, ...rest } = state;
    return JSON.stringify(rest);
  } catch {
    return '';
  }
}

/** Numeric summary mirrored through `player.setStats()` (10 KB, numbers only). */
export function statsFor(state: PersistedState): Record<string, number> {
  const progress = state.progress;
  const stars = Object.values(progress.levelStars).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const crowns = Object.values(progress.mastery.crowns).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return {
    stars,
    level: Math.floor(progress.unlockedLevel) || 1,
    coins: Math.floor(progress.coins) || 0,
    crowns,
    mastery: progressRank(progress),
    events: progress.eventWins.length,
    streak: Math.floor(progress.dailyStreak.days) || 0,
  };
}

// ------------------------------------------------------------------ live part

let host: CloudHost | null = null;
let player: PlayerHandle | null = null;
let status: CloudStatus = { ...EMPTY_CLOUD_STATUS };
let lastPushedSignature: string | null = null;
let lastPushedStats: string | null = null;
let lastPushAt = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<CloudStatus> | null = null;

const listeners = new Set<(value: CloudStatus) => void>();

/** Under network throttling the platform may answer very late (or never). */
const DATA_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), DATA_TIMEOUT_MS);
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

export function cloudStatus(): CloudStatus {
  return { ...status };
}

export function subscribeCloud(listener: (value: CloudStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<CloudStatus>): CloudStatus {
  status = { ...status, ...patch };
  const snapshot = cloudStatus();
  for (const listener of [...listeners]) listener(snapshot);
  return snapshot;
}

/** Injects the platform storage the docs recommend for iOS, when available. */
export async function adoptPlatformStorage(): Promise<boolean> {
  const storage = await platformStorage();
  if (!storage) return false;
  setStorageAdapter(storage);
  return true;
}

async function readCloud(): Promise<{ cloud: CloudEnvelope | null; online: boolean }> {
  const target = player?.player;
  if (!target?.getData) return { cloud: null, online: false };
  try {
    const data = await withTimeout(target.getData([CLOUD_KEY]), 'getData timeout');
    const raw = data ? (data as Record<string, unknown>)[CLOUD_KEY] : null;
    const parsed = parseEnvelope(raw);
    // The mirror is only a hint: while the read worked, the cloud is the truth.
    if (parsed) void saveCloudMirror(parsed);
    return { cloud: parsed, online: true };
  } catch {
    return { cloud: parseEnvelope(await loadCloudMirror()), online: false };
  }
}

/**
 * Starts the cloud session: player, safe storage, first read and the first
 * decision. Never rejects — without the platform the game simply keeps saving
 * locally.
 */
export async function initCloud(local: CloudHost): Promise<CloudStatus> {
  host = local;

  if (!isYandex()) {
    player = null;
    return publish({
      ...EMPTY_CLOUD_STATUS,
      phase: 'disabled',
      reason: null,
    });
  }

  publish({ available: false, phase: 'syncing', reason: null });
  player = await loadPlayer();
  if (!player) {
    return publish({ available: false, phase: 'offline', reason: 'offline' });
  }

  publish({
    available: true,
    authorized: player.authorized,
    guest: player.guest,
    playerId: player.id,
    playerName: player.name,
  });

  await adoptPlatformStorage().catch(() => false);

  const { cloud, online } = await readCloud();
  const snapshot = host.read();

  if (!online) {
    // No connection: keep the local save, mark it dirty and let the retry push
    // it once the network is back.
    if (cloud && progressRank(cloud.state.progress) > progressRank(snapshot.progress)) {
      applyCloud(cloud, 'offline');
      return publish({ phase: 'offline', dirty: false, reason: 'offline', cloudSavedAt: cloud.savedAt });
    }
    return publish({ phase: 'offline', dirty: true, reason: 'offline', cloudSavedAt: cloud?.savedAt ?? null });
  }

  // A deliberate reset must overwrite the cloud, not be undone by the
  // "blank local takes the cloud save" rule.
  const wiped = (await loadWipeMarker()) !== null;
  const decision: CloudDecision = wiped
    ? { action: 'push', reason: 'local-wiped' }
    : cloud && cloud.playerId && player.id && cloud.playerId !== player.id
      ? // The cloud copy belongs to another account: never mix two players up.
        progressRank(cloud.state.progress) > 0
        ? ({ action: 'pull', reason: 'another-account' } as CloudDecision)
        : ({ action: 'push', reason: 'another-account' } as CloudDecision)
      : decideSync(
          { savedAt: snapshot.savedAt, rank: progressRank(snapshot.progress) },
          cloud,
        );

  return run(decision, cloud, { initial: true });
}

function applyCloud(cloud: CloudEnvelope, reason: CloudReason): void {
  host?.apply?.({ ...cloud.state, savedAt: cloud.savedAt });
  lastPushedSignature = contentSignature(cloud.state);
  publish({ cloudSavedAt: cloud.savedAt, reason });
}

async function run(
  decision: CloudDecision,
  cloud: CloudEnvelope | null,
  options: { initial?: boolean } = {},
): Promise<CloudStatus> {
  if (!player) return publish({ phase: 'offline', reason: 'offline' });

  if (decision.action === 'pull' && cloud) {
    if (options.initial) applyCloud(cloud, decision.reason);
    return publish({
      phase: 'pulled',
      dirty: false,
      lastSyncAt: Date.now(),
      reason: decision.reason,
      cloudSavedAt: cloud.savedAt,
    });
  }

  return pushNow(decision.reason);
}

/** Writes the local save to the cloud (the only place that calls `setData`). */
async function pushNow(reason: CloudReason): Promise<CloudStatus> {
  if (!player || !host) return publish({ phase: 'offline', reason: 'offline' });

  const state = host.read();
  const bytes = cloudBytes(state);
  if (bytes > MAX_CLOUD_BYTES) {
    return publish({ phase: 'error', dirty: true, reason: 'too-big' });
  }

  const { setData } = player.player;
  if (typeof setData !== 'function') return publish({ phase: 'offline', dirty: true, reason: 'offline' });

  const envelope = buildEnvelope(state, player.id);
  try {
    await withTimeout(setData.call(player.player, { [CLOUD_KEY]: envelope }, true), 'setData timeout');
  } catch {
    return publish({ phase: 'offline', dirty: true, reason: 'offline' });
  }

  lastPushAt = Date.now();
  lastPushedSignature = contentSignature(state);
  void saveCloudMirror(envelope);
  // The cloud now holds our save — a previous "reset" is recorded there too.
  void clearWipeMarker();

  // Numeric mirror for the leaderboards / achievements of the next stages.
  const stats = statsFor(state);
  const statsSignature = JSON.stringify(stats);
  const { setStats } = player.player;
  if (statsSignature !== lastPushedStats && typeof setStats === 'function') {
    try {
      await withTimeout(setStats.call(player.player, stats), 'setStats timeout');
      lastPushedStats = statsSignature;
    } catch {
      /* statistics are optional: a failure must not fail the save */
    }
  }

  return publish({
    phase: 'pushed',
    dirty: false,
    lastSyncAt: Date.now(),
    reason,
    cloudSavedAt: envelope.savedAt,
  });
}

/**
 * Marks the save as changed. The push happens after a short pause and no more
 * often than `MIN_PUSH_INTERVAL_MS`, so playing a level does not spam the API.
 */
export function noteLocalChange(local?: CloudHost): void {
  if (local) host = local;
  if (!player) return;
  if (host) {
    // Nothing moved since the last push? Then there is nothing to write.
    if (lastPushedSignature !== null && contentSignature(host.read()) === lastPushedSignature) {
      return;
    }
  }
  publish({ dirty: true });
  schedulePush();
}

function schedulePush(delayMs = PUSH_DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  const wait = Math.max(0, lastPushAt + MIN_PUSH_INTERVAL_MS - Date.now());
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushCloud();
  }, Math.max(delayMs, wait));
}

/** Pushes right now (called on pause, on hiding the page and by the button). */
export async function flushCloud(): Promise<CloudStatus> {
  if (!player) return cloudStatus();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (inFlight) return inFlight;

  const wait = Math.max(0, lastPushAt + MIN_PUSH_INTERVAL_MS - Date.now());
  if (wait > 0) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flushCloud();
    }, wait);
    return cloudStatus();
  }

  inFlight = pushNow(status.reason ?? 'local-newer').finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * The "Синхронизировать" button: reads the cloud and applies whichever save is
 * newer (or pushes the local one), i.e. the same decision as at boot.
 */
export async function syncCloudNow(local?: CloudHost): Promise<CloudStatus> {
  if (local) host = local;
  if (!player || !host) return cloudStatus();

  publish({ phase: 'syncing' });
  const { cloud, online } = await readCloud();
  if (!online) return publish({ phase: 'offline', dirty: true, reason: 'offline' });

  const snapshot = host.read();
  const decision = decideSync(
    { savedAt: snapshot.savedAt, rank: progressRank(snapshot.progress) },
    cloud,
  );
  if (decision.action === 'pull' && cloud) applyCloud(cloud, decision.reason);
  return run(decision, cloud);
}

/** Opens the authorization dialog and re-runs the sync afterwards. */
export async function authorizeCloud(local?: CloudHost): Promise<CloudStatus> {
  if (local) host = local;
  const opened = await openAuthDialog();
  if (!opened) return publish({ phase: 'offline', reason: 'error' });

  player = await loadPlayer();
  if (!player) return publish({ phase: 'offline', reason: 'offline' });

  publish({
    available: true,
    authorized: player.authorized,
    guest: player.guest,
    playerId: player.id,
    playerName: player.name,
  });
  return syncCloudNow();
}

/** `true` when the save has local changes that are not in the cloud yet. */
export function cloudDirty(): boolean {
  return status.dirty;
}

/**
 * Test seam: forgets the player, the timers and the status. Subscribers stay
 * connected — the game store subscribes once per page, tests included.
 */
export function resetCloud(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  debounceTimer = null;
  retryTimer = null;
  inFlight = null;
  host = null;
  player = null;
  lastPushedSignature = null;
  lastPushedStats = null;
  lastPushAt = 0;
  status = { ...EMPTY_CLOUD_STATUS };
}

export { describePlayer };
