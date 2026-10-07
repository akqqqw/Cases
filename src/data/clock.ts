import { dailyKey, msUntilTomorrow as msUntilLocalTomorrow } from './dailies';

/**
 * The day clock of the game.
 *
 * Local device time is the default source, but it must not stay the only one:
 * as soon as the game talks to the Yandex Games SDK (or to any server), the
 * adapter calls `setTrustedTime(...)` once the real time is known and every day
 * key in the game — daily tasks, the streak and the daily gift — switches to
 * that clock without touching any other module.
 *
 * `resolveDay` keeps the calendar monotonic on top of the clock: a day that was
 * already played can never be reopened by moving the device clock back, so the
 * gift calendar cannot be farmed by flipping the date.
 */
export type ClockSource = 'local' | 'server';

export interface ClockInfo {
  source: ClockSource;
  /** `trusted − local` in milliseconds (0 while the local clock is the source). */
  offsetMs: number;
  /** The day the game currently plays in, `YYYY-MM-DD`. */
  day: string;
  /** When the trusted reading was received, `0` when there was none. */
  syncedAt: number;
}

/** A trusted reading is used for this long without a refresh, then it goes stale. */
const TRUST_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * A stored day further ahead than this is treated as a broken device clock
 * rather than as a fast-forwarded one: the calendar resets instead of locking
 * the player out for months.
 */
export const MAX_DAY_JUMP = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

let trusted: { ms: number; receivedAt: number } | null = null;

/** Remembers the real time (server / SDK) and how long ago it was received. */
export function setTrustedTime(ms: number, receivedAt: number = Date.now()): boolean {
  if (!Number.isFinite(ms) || !Number.isFinite(receivedAt)) return false;
  trusted = { ms, receivedAt };
  return true;
}

export function clearTrustedTime(): void {
  trusted = null;
}

/** `true` while the game runs on the trusted clock instead of the local one. */
export function hasTrustedTime(at: number = Date.now()): boolean {
  return trustedNow(at) !== null;
}

function trustedNow(at: number): number | null {
  if (!trusted) return null;
  const age = at - trusted.receivedAt;
  if (age < 0 || age > TRUST_WINDOW_MS) return null;
  return trusted.ms + age;
}

/** Current moment, from the best source available. */
export function now(at: number = Date.now()): number {
  return trustedNow(at) ?? at;
}

/** Day key of the current moment, `YYYY-MM-DD`. */
export function currentDayKey(at: number = Date.now()): string {
  return dailyKey(new Date(now(at)));
}

/** Which clock is in use right now — handy for the SDK adapter and for tests. */
export function clockInfo(at: number = Date.now()): ClockInfo {
  const server = trustedNow(at);
  return {
    source: server === null ? 'local' : 'server',
    offsetMs: server === null ? 0 : Math.round(server - at),
    day: currentDayKey(at),
    syncedAt: server === null || !trusted ? 0 : trusted.receivedAt,
  };
}

/** Milliseconds until the next midnight, counted from the best clock we have. */
export function msUntilTomorrow(at: number = Date.now()): number {
  return msUntilLocalTomorrow(new Date(now(at)));
}

/** Whole calendar days from `from` to `to` (`to − from`), `null` for bad input. */
export function dayDiff(from: string, to: string): number | null {
  const start = parseDayUtc(from);
  const end = parseDayUtc(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / DAY_MS);
}

function parseDayUtc(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(year, month - 1, day);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The day the player actually plays in.
 *
 * - ahead of the local clock (a fast-forward, or a handful of skipped days) —
 *   the stored day wins, so the calendar cannot be farmed by moving the clock
 *   back and forth;
 * - absurdly far ahead (`MAX_DAY_JUMP`) — treated as a broken clock, so the
 *   player is not locked out of the calendar for months;
 * - anything else — today.
 */
export function resolveDay(lastSeenDay: string, today: string = currentDayKey()): string {
  if (parseDayUtc(lastSeenDay) === null) return today;
  if (lastSeenDay <= today) return today;

  const jump = dayDiff(today, lastSeenDay);
  if (jump === null || jump > MAX_DAY_JUMP) return today;
  return lastSeenDay;
}

/** Highest of two day keys — the value that should be persisted as `lastSeenDay`. */
export function latestDay(a: string, b: string): string {
  if (parseDayUtc(a) === null) return b;
  if (parseDayUtc(b) === null) return a;
  return a >= b ? a : b;
}
