/**
 * Daily tasks — small, always-fresh goals that pay coins. Three of them are
 * picked per day, deterministically from the date, so a day always shows the
 * same tasks (and every player sees the same set on a given day).
 */
export type DailyMetric = 'matches' | 'levels' | 'golden' | 'bombs' | 'stars';

export interface DailyTaskDef {
  id: string;
  metric: DailyMetric;
  target: number;
  reward: number;
  title: string;
  /** Product icon shown on the card. */
  icon: string;
}

export const DAILY_TASKS: DailyTaskDef[] = [
  { id: 'matches-15', metric: 'matches', target: 15, reward: 50, title: 'Собери 15 троек', icon: 'apple' },
  { id: 'matches-30', metric: 'matches', target: 30, reward: 80, title: 'Собери 30 троек', icon: 'cheese' },
  { id: 'levels-2', metric: 'levels', target: 2, reward: 60, title: 'Пройди 2 уровня', icon: 'bread' },
  { id: 'levels-4', metric: 'levels', target: 4, reward: 110, title: 'Пройди 4 уровня', icon: 'book' },
  { id: 'stars-6', metric: 'stars', target: 6, reward: 100, title: 'Заработай 6 звёзд', icon: 'flower' },
  { id: 'golden-2', metric: 'golden', target: 2, reward: 70, title: 'Собери 2 золотые тройки', icon: 'candy' },
  { id: 'bombs-2', metric: 'bombs', target: 2, reward: 80, title: 'Взорви 2 бомбы', icon: 'robot' },
  { id: 'bombs-4', metric: 'bombs', target: 4, reward: 130, title: 'Взорви 4 бомбы', icon: 'phone' },
  { id: 'matches-45', metric: 'matches', target: 45, reward: 140, title: 'Собери 45 троек', icon: 'cake' },
];

export const DAILY_TASK_COUNT = 3;

export const METRIC_LABELS: Record<DailyMetric, string> = {
  matches: 'тройки',
  levels: 'уровни',
  golden: 'золотые тройки',
  bombs: 'взрывы',
  stars: 'звёзды',
};

/** Local date key, `YYYY-MM-DD`. */
export function dailyKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayKey(now: Date = new Date()): string {
  return dailyKey(now);
}

/** Stable FNV-1a hash — the same key always yields the same tasks. */
export function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Picks the tasks of the day (deterministic, without repetition). */
export function pickDailyTasks(key: string = todayKey(), count = DAILY_TASK_COUNT): DailyTaskDef[] {
  const pool = [...DAILY_TASKS];
  const picked: DailyTaskDef[] = [];
  let seed = hashKey(key);

  while (picked.length < Math.min(count, DAILY_TASKS.length) && pool.length > 0) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const index = seed % pool.length;
    const task = pool.splice(index, 1)[0];
    if (task) picked.push(task);
  }

  return picked;
}

/** Streak of days on which at least one daily reward was collected. */
export interface DailyStreak {
  days: number;
  /** Last day a reward was collected, `YYYY-MM-DD`. */
  lastDay: string;
}

export const EMPTY_STREAK: DailyStreak = { days: 0, lastDay: '' };

/** Extra coins for keeping the streak alive (paid once per day). */
export function streakBonus(days: number): number {
  return Math.min(50, Math.max(0, days - 1) * 10);
}

function parseDay(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day).getTime();
}

/** `true` when `key` is exactly the day before `today`. */
export function isYesterday(key: string, today: string = todayKey()): boolean {
  const then = parseDay(key);
  const now = parseDay(today);
  if (Number.isNaN(then) || Number.isNaN(now)) return false;
  return now - then === 24 * 60 * 60 * 1000;
}

/** The streak after collecting a reward today. */
export function advanceStreak(streak: DailyStreak, today: string = todayKey()): DailyStreak {
  if (streak.lastDay === today) return { days: Math.max(1, streak.days), lastDay: today };
  if (isYesterday(streak.lastDay, today)) return { days: streak.days + 1, lastDay: today };
  return { days: 1, lastDay: today };
}

/** Milliseconds until the next day starts (for the "обновятся через" hint). */
export function msUntilTomorrow(now: Date = new Date()): number {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
}
