/**
 * The week counter behind the «лучший результат недели» leaderboard.
 *
 * The ranking of the platform stores one number per player and never forgets
 * it: a table cannot be reset every Monday, so the game keeps the *record* of
 * the best week instead — «лучший результат недели» = the most stars collected
 * within one calendar week. `stars` is the running week, `best` is the record;
 * both only ever grow, so a published score is never taken back.
 *
 * The week key is ISO-8601 (`2026-W41`): Monday is the first day and the week
 * belongs to the year its Thursday falls into.
 */

export interface WeekProgress {
  /** Key of the week `stars` were collected in (`YYYY-Www`), `''` when none. */
  key: string;
  /** Stars collected in the running week. */
  stars: number;
  /** Record of the best week ever — what the leaderboard shows. */
  best: number;
}

export const EMPTY_WEEK: WeekProgress = { key: '', stars: 0, best: 0 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** `'2026-10-06'` → `[2026, 10, 6]`; `null` for anything else. */
function parseDay(day: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  return [year, month, date];
}

/** ISO-8601 week key of a `YYYY-MM-DD` day; `''` when the day is malformed. */
export function weekKeyFor(day: string): string {
  const parsed = parseDay(day);
  if (!parsed) return '';
  const [year, month, date] = parsed;
  // Work in UTC: the day key is already a calendar day, no timezone involved.
  const target = new Date(Date.UTC(year, month - 1, date));
  if (Number.isNaN(target.getTime())) return '';
  // Thursday of the same ISO week decides the year and the week number.
  const monday = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - monday + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstMonday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstMonday + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Stars of the running week (`0` when the record belongs to another week). */
export function weekStars(week: WeekProgress, day: string): number {
  const key = weekKeyFor(day);
  return key.length > 0 && week.key === key ? Math.max(0, Math.floor(week.stars) || 0) : 0;
}

/**
 * Adds freshly won stars to the running week. A new week starts from zero, the
 * record keeps the best week, and a `gained` of zero still moves the counter to
 * the new week (the player is playing, just not improving).
 */
export function bumpWeek(week: WeekProgress, day: string, gained: number): WeekProgress {
  const key = weekKeyFor(day);
  if (key.length === 0) return week;
  const add = Math.max(0, Math.floor(Number(gained) || 0));
  const stars = week.key === key ? Math.max(0, Math.floor(week.stars) || 0) + add : add;
  return { key, stars, best: Math.max(Math.max(0, Math.floor(week.best) || 0), stars) };
}
