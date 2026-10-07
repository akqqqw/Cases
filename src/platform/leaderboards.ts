/**
 * Leaderboards on top of the Yandex Games SDK.
 *
 * Documented API used here
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-leaderboard):
 *   - `ysdk.leaderboards.getEntries(name, {quantityTop, quantityAround, includeUser})`
 *     — 20 requests per 5 minutes, the only call that works for guests too;
 *   - `ysdk.leaderboards.setScore(name, score)` — authorized users only,
 *     **no more than one request per second**, and only after
 *     `ysdk.isAvailableMethod('leaderboards.setScore')` said yes;
 *   - `ysdk.leaderboards.getPlayerEntry(name)` — not needed: `getEntries` with
 *     `includeUser: true` already returns `userRank` (and this saves the
 *     60-per-5-minutes budget);
 *   - a missing leaderboard answers with an HTTP 404: the table simply was not
 *     created in the Console yet, which is a normal state for a draft.
 *
 * Three tables, all `numeric` and sorted descending (see `BOARDS`):
 *   - `shelf_mastery` — the sum of the best mastery points of every level;
 *   - `shelf_stars3`  — how many levels were cleared with three stars;
 *   - `shelf_week`    — the record of stars collected within one week.
 *
 * Everything here is optional: without the platform, without the API, without
 * authorization or without a table the game keeps working, the screen just
 * explains why the ranking is empty. Scores are only ever sent upwards, so a
 * published result is never taken back — and a request is skipped entirely when
 * the value did not improve.
 */
import { currentDayKey } from '../data/clock';
import { weekStars, type WeekProgress } from '../data/weeks';
import { localStorageAdapter, type PersistedState } from '../store/persistence';
import { isYandex, leaderboardsApi, methodAvailable, type SdkLeaderboardEntry, type SdkLeaderboards } from './yandex';

export type BoardId = 'mastery' | 'stars3' | 'week';

export interface BoardDef {
  id: BoardId;
  /** Technical name — must match the Console field exactly (otherwise a 404). */
  sdkName: string;
  icon: string;
  titleKey: string;
  hintKey: string;
  /** `'record'`: a running counter; `'best'`: the best value ever. */
  kind: 'total' | 'count' | 'record';
}

export const BOARDS: readonly BoardDef[] = [
  {
    id: 'mastery',
    sdkName: 'shelf_mastery',
    icon: '🏆',
    titleKey: 'lb.board.mastery',
    hintKey: 'lb.board.masteryHint',
    kind: 'total',
  },
  {
    id: 'stars3',
    sdkName: 'shelf_stars3',
    icon: '⭐',
    titleKey: 'lb.board.stars3',
    hintKey: 'lb.board.stars3Hint',
    kind: 'count',
  },
  {
    id: 'week',
    sdkName: 'shelf_week',
    icon: '📅',
    titleKey: 'lb.board.week',
    hintKey: 'lb.board.weekHint',
    kind: 'record',
  },
];

export const BOARD_IDS: BoardId[] = BOARDS.map((board) => board.id);

export function boardDef(id: BoardId): BoardDef {
  return BOARDS.find((board) => board.id === id) ?? BOARDS[0]!;
}

/** The SDK rejects anything faster than one `setScore` per second. */
export const SCORE_MIN_INTERVAL_MS = 1_100;
/** A loaded table is reused for this long — the SDK allows 20 `getEntries` / 5 min. */
export const BOARD_TTL_MS = 60_000;
/** Window and limit of `getEntries` from the docs (with a small reserve). */
export const ENTRIES_WINDOW_MS = 5 * 60 * 1000;
export const ENTRIES_LIMIT = 18;
export const TOP_ENTRIES = 10;
export const AROUND_ENTRIES = 3;
/** Where the high-water marks of the published scores live. */
export const SENT_KEY = 'shelf-sort:leaderboard:sent';
const REQUEST_TIMEOUT_MS = 8_000;

/** Everything the module needs from the game (the store provides it). */
export interface LeaderboardHost {
  /** The local save — scores are derived from it. */
  read: () => PersistedState;
  /** `true` when a player is signed in (`setScore` requires authorization). */
  authorized: () => boolean;
  /** `player.getUniqueID()` of the signed-in player, `null` for a guest. */
  playerId: () => string | null;
}

export type LeaderboardPhase = 'idle' | 'disabled' | 'unavailable' | 'ready' | 'error' | 'no-board';

export type LeaderboardReason =
  | 'no-platform'
  | 'no-api'
  | 'unauthorized'
  | 'no-board'
  | 'error'
  | 'sent'
  | null;

export type BoardPhase = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error' | 'no-board' | 'too-often';

export interface BoardEntry {
  rank: number;
  score: number;
  /** `''` for a player who hid their profile — the UI shows a generic card. */
  name: string;
  avatar: string | null;
  self: boolean;
}

export interface BoardView {
  id: BoardId;
  phase: BoardPhase;
  entries: BoardEntry[];
  userRank: number;
  loadedAt: number | null;
}

export interface LeaderboardStatus {
  /** The platform and its leaderboard API are present. */
  available: boolean;
  /** The player is signed in — only then can a score be sent. */
  authorized: boolean;
  phase: LeaderboardPhase;
  reason: LeaderboardReason;
  /** Values already accepted by `setScore()` (a table only grows). */
  sent: Record<BoardId, number>;
  publishing: boolean;
  lastPublishAt: number | null;
  boards: Record<BoardId, BoardView>;
}

export interface ScoreSource {
  levelStars: Record<number, number>;
  mastery: { best: Record<number, number> };
  weeks: WeekProgress;
}

/** Pure score of the three tables — the single source of the published numbers. */
export function boardScores(source: ScoreSource): Record<BoardId, number> {
  const perfect = Object.values(source.levelStars).filter((stars) => Number(stars) >= 3).length;
  const mastery = Object.values(source.mastery.best).reduce(
    (sum, points) => sum + Math.max(0, Math.floor(Number(points) || 0)),
    0,
  );
  return {
    mastery,
    stars3: perfect,
    week: Math.max(0, Math.floor(Number(source.weeks.best) || 0)),
  };
}

function emptyBoards(): Record<BoardId, BoardView> {
  return {
    mastery: { id: 'mastery', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
    stars3: { id: 'stars3', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
    week: { id: 'week', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
  };
}

export function emptyLeaderboardStatus(): LeaderboardStatus {
  return {
    available: false,
    authorized: false,
    phase: 'idle',
    reason: null,
    sent: { mastery: 0, stars3: 0, week: 0 },
    publishing: false,
    lastPublishAt: null,
    boards: emptyBoards(),
  };
}

// ------------------------------------------------------------------- live part

let host: LeaderboardHost | null = null;
let api: SdkLeaderboards | null = null;
let status: LeaderboardStatus = emptyLeaderboardStatus();
let chain: Promise<LeaderboardStatus> = Promise.resolve(status);
let lastScoreAt = 0;
/** When the tables were read — `getEntries` allows only 20 requests / 5 min. */
let entryCalls: number[] = [];

const listeners = new Set<(value: LeaderboardStatus) => void>();

export function leaderboardStatus(): LeaderboardStatus {
  return { ...status, boards: { ...status.boards }, sent: { ...status.sent } };
}

export function subscribeLeaderboards(listener: (value: LeaderboardStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<LeaderboardStatus>): LeaderboardStatus {
  status = { ...status, ...patch };
  const snapshot = leaderboardStatus();
  for (const listener of [...listeners]) listener(snapshot);
  return snapshot;
}

function publishBoard(id: BoardId, patch: Partial<BoardView>): void {
  publish({ boards: { ...status.boards, [id]: { ...status.boards[id], ...patch } } });
}

/** The store injects itself once — the module never imports the store. */
export function connectLeaderboards(next: LeaderboardHost | null = null): void {
  if (next) host = next;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), REQUEST_TIMEOUT_MS);
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

/** `err.code` of the SDK (`'LEADERBOARD_PLAYER_NOT_PRESENT'`, `404`, …). */
function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return '';
}

/** The table was not created in the Console — the docs promise a 404 for it. */
function isMissingBoard(error: unknown): boolean {
  const code = errorCode(error);
  if (code.includes('404') || code.toLowerCase().includes('not_found')) return true;
  const message = error instanceof Error ? error.message : '';
  return message.includes('404');
}

// --------------------------------------------------------------- sent scores

function readSent(): Record<BoardId, number> {
  const result: Record<BoardId, number> = { mastery: 0, stars3: 0, week: 0 };
  try {
    const raw = localStorageAdapter()?.getItem(SENT_KEY) ?? null;
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Partial<Record<BoardId, unknown>>;
    for (const id of BOARD_IDS) {
      const value = Math.floor(Number(parsed?.[id]) || 0);
      if (Number.isFinite(value) && value > 0) result[id] = value;
    }
  } catch {
    /* a broken stamp only means one extra request, never a broken game */
  }
  return result;
}

function writeSent(sent: Record<BoardId, number>): void {
  try {
    localStorageAdapter()?.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    /* ignore: the marks then only live in memory */
  }
}

// -------------------------------------------------------------------- init

/**
 * Connects the ranking: the API object, the authorization of the session and
 * the first publish. Never rejects — a platform without leaderboards is a
 * normal state (draft, web version).
 */
export async function initLeaderboards(): Promise<LeaderboardStatus> {
  if (!isYandex()) {
    api = null;
    return publish({ ...emptyLeaderboardStatus(), phase: 'disabled', reason: 'no-platform' });
  }

  publish({ available: false, phase: 'idle', reason: null });
  api = await leaderboardsApi();
  if (!api) {
    return publish({ ...emptyLeaderboardStatus(), available: false, phase: 'unavailable', reason: 'no-api' });
  }

  const sent = readSent();
  lastScoreAt = 0;
  publish({ available: true, sent, reason: null });
  void publishScores();
  return leaderboardStatus();
}

// ---------------------------------------------------------------- publishing

/**
 * Sends the scores that improved since the last successful `setScore()`.
 * Serialized through one promise chain, so two triggers never run at once and
 * the calls keep the documented one-per-second distance.
 */
export function publishScores(): Promise<LeaderboardStatus> {
  chain = chain.then(() => runPublish(), () => runPublish());
  return chain;
}

async function runPublish(): Promise<LeaderboardStatus> {
  if (!api || !host) return leaderboardStatus();

  const authorized = host.authorized();
  if (status.authorized !== authorized) publish({ authorized });
  if (!authorized) return publish({ reason: status.reason === 'sent' ? 'sent' : 'unauthorized' });

  const wanted = boardScores(host.read().progress);
  const todo = BOARD_IDS.filter((id) => wanted[id] > (status.sent[id] ?? 0));
  if (todo.length === 0) return leaderboardStatus();

  const setScore = api.setScore;
  if (typeof setScore !== 'function') {
    return publish({ phase: 'unavailable', reason: 'no-api' });
  }
  if (!(await methodAvailable('leaderboards.setScore'))) {
    return publish({ phase: 'unavailable', reason: 'no-api' });
  }

  publish({ publishing: true });
  for (const id of todo) {
    const score = wanted[id] ?? 0;
    const wait = Math.max(0, lastScoreAt + SCORE_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await delay(wait);
    lastScoreAt = Date.now();
    try {
      await withTimeout(setScore.call(api, boardDef(id).sdkName, score), 'setScore timeout');
    } catch (error) {
      const missing = isMissingBoard(error);
      return publish({ publishing: false, phase: missing ? 'no-board' : 'error', reason: missing ? 'no-board' : 'error' });
    }
    const sent = { ...status.sent, [id]: score };
    publish({ sent });
    writeSent(sent);
  }

  return publish({ publishing: false, phase: 'ready', reason: 'sent', lastPublishAt: Date.now() });
}

// ------------------------------------------------------------------ reading

function mapEntry(entry: SdkLeaderboardEntry, selfId: string | null): BoardEntry {
  const name = typeof entry?.player?.publicName === 'string' ? entry.player.publicName.trim() : '';
  let avatar: string | null = null;
  try {
    const url = entry?.player?.getAvatarSrc?.('small');
    avatar = typeof url === 'string' && url.length > 0 ? url : null;
  } catch {
    avatar = null;
  }
  const uniqueID = typeof entry?.player?.uniqueID === 'string' ? entry.player.uniqueID : '';
  const rank = Math.floor(Number(entry?.rank) || 0);
  const score = Math.floor(Number(entry?.score) || 0);
  return {
    rank: rank > 0 ? rank : 0,
    score: Number.isFinite(score) && score > 0 ? score : 0,
    name,
    avatar,
    self: Boolean(selfId && uniqueID && uniqueID === selfId),
  };
}

/**
 * Loads one table: the top plus a few neighbours of the player. A table that
 * was loaded less than `BOARD_TTL_MS` ago is reused unless `force` is set — the
 * `getEntries` budget is the tightest limit of the three methods.
 */
export async function loadBoard(id: BoardId, options: { force?: boolean } = {}): Promise<BoardView> {
  const view = status.boards[id];
  if (!api) {
    publishBoard(id, { phase: 'unavailable' });
    return status.boards[id]!;
  }
  if (!options.force && view.phase === 'ready' && view.loadedAt) {
    const fresh = Date.now() - view.loadedAt < BOARD_TTL_MS;
    if (fresh) return view;
  }

  // The budget of the platform is protected: a player who refreshes the screen
  // again and again gets the cached rows and a message instead of a rejection.
  const now = Date.now();
  entryCalls = entryCalls.filter((at) => now - at < ENTRIES_WINDOW_MS);
  if (entryCalls.length >= ENTRIES_LIMIT) {
    publishBoard(id, { phase: 'too-often' });
    return status.boards[id]!;
  }

  const getEntries = api.getEntries;
  if (typeof getEntries !== 'function') {
    publishBoard(id, { phase: 'unavailable' });
    return status.boards[id]!;
  }

  entryCalls.push(now);
  publishBoard(id, { phase: 'loading' });
  const selfId = host?.playerId?.() ?? null;
  try {
    const answer = await withTimeout(
      getEntries.call(api, boardDef(id).sdkName, {
        quantityTop: TOP_ENTRIES,
        includeUser: true,
        quantityAround: AROUND_ENTRIES,
      }),
      'getEntries timeout',
    );
    const entries = (answer?.entries ?? []).map((entry) => mapEntry(entry, selfId));
    const userRank = Math.floor(Number(answer?.userRank) || 0);
    publishBoard(id, {
      phase: 'ready',
      entries,
      userRank: userRank > 0 ? userRank : 0,
      loadedAt: Date.now(),
    });
  } catch (error) {
    publishBoard(id, { phase: isMissingBoard(error) ? 'no-board' : 'error' });
  }
  return status.boards[id]!;
}

/** The player's own values — what the screen shows above the table. */
export function currentScores(): Record<BoardId, number> {
  if (!host) return { mastery: 0, stars3: 0, week: 0 };
  return boardScores(host.read().progress);
}

/** The stars of the running week (`0` when the week just started over). */
export function currentWeekStars(day: string = currentDayKey()): number {
  const weeks = host?.read().progress.weeks;
  return weeks ? weekStars(weeks, day) : 0;
}

/**
 * Test seam: forgets the API, the timers and the status. Subscribers and the
 * host stay connected — the game store connects once per page.
 */
export function resetLeaderboards(): void {
  api = null;
  chain = Promise.resolve(leaderboardStatus());
  lastScoreAt = 0;
  entryCalls = [];
  status = emptyLeaderboardStatus();
}

/** Exposed for tests: the marks that are already known to the platform. */
export function sentScores(): Record<BoardId, number> {
  return { ...status.sent };
}
