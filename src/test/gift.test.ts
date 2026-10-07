import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAILY_GIFTS,
  GIFT_CYCLE_DAYS,
  giftBoosterLines,
  giftCalendar,
  giftCycleDay,
  giftForDay,
} from '../data/gift';
import { EMPTY_STREAK, dailyKey, pickDailyTasks } from '../data/dailies';
import {
  MAX_DAY_JUMP,
  clearTrustedTime,
  clockInfo,
  currentDayKey,
  dayDiff,
  hasTrustedTime,
  latestDay,
  msUntilTomorrow,
  resolveDay,
  setTrustedTime,
} from '../data/clock';
import { ITEM_IDS } from '../data/items';
import { BOOSTERS, BOOSTER_IDS, emptyBoosters } from '../core/boosters';
import { useGameStore } from '../store/gameStore';
import { migrateLastSeenDay } from '../store/persistence';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` shifted by whole days. */
function keyAfter(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return dailyKey(new Date(year, month - 1, day + days));
}

const today = (): string => currentDayKey();

describe('game clock', () => {
  afterEach(() => clearTrustedTime());

  it('uses the device clock until a trusted time arrives', () => {
    expect(hasTrustedTime()).toBe(false);
    expect(clockInfo().source).toBe('local');
    expect(clockInfo().offsetMs).toBe(0);
    expect(currentDayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('switches every day key to the trusted clock', () => {
    const server = new Date(2031, 0, 5, 10, 30, 0).getTime();
    expect(setTrustedTime(server)).toBe(true);

    expect(hasTrustedTime()).toBe(true);
    expect(currentDayKey()).toBe('2031-01-05');
    expect(clockInfo().source).toBe('server');
    expect(clockInfo().day).toBe('2031-01-05');
    expect(Math.abs(clockInfo().offsetMs)).toBeGreaterThan(DAY_MS);

    clearTrustedTime();
    expect(hasTrustedTime()).toBe(false);
    expect(currentDayKey()).toBe(today());
  });

  it('keeps running from the last reading and drops a stale one', () => {
    const at = Date.now();
    setTrustedTime(at + 5 * 60 * 1000, at);
    // five minutes later the trusted clock has moved five minutes on
    expect(clockInfo(at + 5 * 60 * 1000).source).toBe('server');
    expect(clockInfo(at + 5 * 60 * 1000).offsetMs).toBe(5 * 60 * 1000);

    // half a day later the reading is stale and the device clock takes over
    expect(clockInfo(at + 13 * 60 * 60 * 1000).source).toBe('local');

    clearTrustedTime();
    expect(setTrustedTime(Number.NaN)).toBe(false);
    expect(hasTrustedTime()).toBe(false);
  });

  it('counts whole days between keys', () => {
    expect(dayDiff('2026-10-06', '2026-10-06')).toBe(0);
    expect(dayDiff('2026-10-06', '2026-10-09')).toBe(3);
    expect(dayDiff('2026-01-31', '2026-02-01')).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2026-10-06', 'не день')).toBeNull();
    expect(latestDay('2026-10-06', '2026-10-08')).toBe('2026-10-08');
    expect(latestDay('', '2026-10-08')).toBe('2026-10-08');
    expect(latestDay('2026-10-08', '')).toBe('2026-10-08');
  });

  it('never lets the calendar move backwards', () => {
    expect(resolveDay('', '2026-10-06')).toBe('2026-10-06');
    expect(resolveDay('2026-10-06', '2026-10-06')).toBe('2026-10-06');
    // the device clock was moved back: yesterday's already played day wins
    expect(resolveDay('2026-10-10', '2026-10-06')).toBe('2026-10-10');
    expect(resolveDay('2026-09-30', '2026-10-06')).toBe('2026-10-06');

    // a sane forward jump is kept…
    const forward = keyAfter('2026-10-06', MAX_DAY_JUMP);
    expect(resolveDay(forward, '2026-10-06')).toBe(forward);
    // …an absurd one is treated as a broken clock so the player is not locked out
    expect(resolveDay(keyAfter('2026-10-06', MAX_DAY_JUMP + 1), '2026-10-06')).toBe('2026-10-06');
    expect(resolveDay('мусор', '2026-10-06')).toBe('2026-10-06');
  });

  it('sanitises the stored day', () => {
    const day = today();
    expect(migrateLastSeenDay(keyAfter(day, 3))).toBe(keyAfter(day, 3));
    expect(migrateLastSeenDay(keyAfter(day, 400))).toBe(day);
    expect(migrateLastSeenDay(keyAfter(day, -5))).toBe(day);
    expect(migrateLastSeenDay('06.10.2026')).toBe('');
    expect(migrateLastSeenDay(42)).toBe('');
    expect(migrateLastSeenDay(undefined)).toBe('');
  });

  it('counts down to midnight from the best clock', () => {
    expect(msUntilTomorrow()).toBeGreaterThan(0);
    expect(msUntilTomorrow()).toBeLessThanOrEqual(DAY_MS);
  });
});

describe('daily gift calendar', () => {
  it('offers seven days with growing rewards', () => {
    expect(DAILY_GIFTS).toHaveLength(GIFT_CYCLE_DAYS);
    expect(GIFT_CYCLE_DAYS).toBe(7);

    for (const [index, gift] of DAILY_GIFTS.entries()) {
      expect(gift.day).toBe(index + 1);
      expect(gift.coins).toBeGreaterThan(0);
      expect(ITEM_IDS).toContain(gift.icon);
      expect(gift.label.length).toBeGreaterThan(0);
      expect(gift.note.length).toBeGreaterThan(0);
      if (index > 0) {
        expect(gift.coins).toBeGreaterThan((DAILY_GIFTS[index - 1] as { coins: number }).coins);
      }
    }

    // the second day already pays better than a daily task
    expect(giftForDay(2).coins).toBeGreaterThanOrEqual(50);
    // the big day of the cycle is worth a couple of levels
    expect(giftForDay(7).coins).toBeGreaterThan(200);
  });

  it('gives boosters on the special days only', () => {
    const withBoosters = DAILY_GIFTS.filter((gift) => gift.boosters);

    expect(withBoosters.map((gift) => gift.day)).toEqual([3, 5, 6, 7]);
    for (const gift of withBoosters) {
      const lines = giftBoosterLines(gift);
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(BOOSTER_IDS).toContain(line.id);
        expect(line.count).toBeGreaterThan(0);
        expect(line.icon).toBe(BOOSTERS[line.id].icon);
        expect(line.title.length).toBeGreaterThan(0);
      }
    }

    expect(giftBoosterLines(giftForDay(1))).toEqual([]);
    expect(giftBoosterLines({ ...giftForDay(6), boosters: { hammer: 0 } })).toEqual([]);
    expect(giftBoosterLines(giftForDay(7)).map((line) => line.id).sort()).toEqual(['extraMove', 'hammer']);
  });

  it('clamps a day into the calendar', () => {
    expect(giftForDay(0).day).toBe(1);
    expect(giftForDay(-3).day).toBe(1);
    expect(giftForDay(3.7).day).toBe(3);
    expect(giftForDay(99).day).toBe(GIFT_CYCLE_DAYS);
    expect(giftForDay(Number.NaN).day).toBe(1);
  });

  it('cycles the calendar every seven days', () => {
    expect(giftCycleDay(0)).toBe(1);
    expect(giftCycleDay(1)).toBe(1);
    expect(giftCycleDay(7)).toBe(7);
    expect(giftCycleDay(8)).toBe(1);
    expect(giftCycleDay(13)).toBe(6);
    expect(giftCycleDay(14)).toBe(7);
    expect(giftCycleDay(15)).toBe(1);
    expect(giftCycleDay(-4)).toBe(1);
    expect(giftCycleDay(Number.NaN)).toBe(1);
  });

  it('starts on the first day and walks through the week', () => {
    const first = giftCalendar(EMPTY_STREAK, '2026-10-06');
    expect(first.canClaim).toBe(true);
    expect(first.cycleDay).toBe(1);
    expect(first.gift.coins).toBe(giftForDay(1).coins);
    expect(first.streak).toEqual({ days: 1, lastDay: '2026-10-06' });
    expect(first.tomorrow.day).toBe(2);

    let streak = EMPTY_STREAK;
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'];
    const paid: number[] = [];
    for (const day of days) {
      const calendar = giftCalendar(streak, day);
      expect(calendar.cycleDay).toBe(days.indexOf(day) + 1);
      expect(calendar.canClaim).toBe(true);
      paid.push(calendar.gift.coins);
      streak = calendar.streak;
    }
    expect(paid).toHaveLength(GIFT_CYCLE_DAYS);
    expect([...paid].sort((a, b) => a - b)).toEqual(paid);

    // the eighth day starts the calendar over, but the streak keeps growing
    const second = giftCalendar(streak, '2026-10-13');
    expect(second.cycleDay).toBe(1);
    expect(second.streak.days).toBe(8);
    expect(second.canClaim).toBe(true);
  });

  it('restarts the calendar after a missed day', () => {
    const streak = { days: 5, lastDay: '2026-10-06' };
    const missed = giftCalendar(streak, '2026-10-09');

    expect(missed.cycleDay).toBe(1);
    expect(missed.gift.coins).toBe(giftForDay(1).coins);
    expect(missed.streak).toEqual({ days: 1, lastDay: '2026-10-09' });
    expect(missed.canClaim).toBe(true);
  });

  it('knows when today is already collected', () => {
    const collected = giftCalendar({ days: 2, lastDay: '2026-10-07' }, '2026-10-07');

    expect(collected.canClaim).toBe(false);
    expect(collected.cycleDay).toBe(2);
    expect(collected.tomorrow.day).toBe(3);

    const last = giftCalendar({ days: 7, lastDay: '2026-10-12' }, '2026-10-12');
    expect(last.canClaim).toBe(false);
    expect(last.cycleDay).toBe(GIFT_CYCLE_DAYS);
    expect(last.tomorrow.day).toBe(1);
  });
});

describe('daily gift in the store', () => {
  const fresh = (patch: Partial<ReturnType<typeof useGameStore.getState>['progress']> = {}): void => {
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        coins: 100,
        dailyStreak: { ...EMPTY_STREAK },
        lastSeenDay: '',
        boosters: emptyBoosters(),
        ...patch,
      },
    });
  };

  beforeEach(() => fresh());

  it('collects the gift of the day exactly once', () => {
    const state = useGameStore.getState();
    expect(state.claimDailyGift()).toBe(true);

    const after = useGameStore.getState();
    const day = today();
    expect(after.progress.coins).toBe(100 + giftForDay(1).coins);
    expect(after.progress.dailyStreak).toEqual({ days: 1, lastDay: day });
    expect(after.progress.lastSeenDay).toBe(day);
    expect(after.toast?.text).toContain('Подарок 1/7');
    expect(after.toast?.tone).toBe('good');

    expect(useGameStore.getState().claimDailyGift()).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(100 + giftForDay(1).coins);
    expect(useGameStore.getState().toast?.text).toContain('Подарок уже получен');
  });

  it('pays the booster of the seventh day', () => {
    fresh({
      coins: 0,
      dailyStreak: { days: 6, lastDay: keyAfter(today(), -1) },
      lastSeenDay: keyAfter(today(), -1),
    });

    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    const after = useGameStore.getState();

    expect(after.progress.coins).toBe(giftForDay(7).coins);
    expect(after.progress.boosters.hammer).toBe(1);
    expect(after.progress.boosters.extraMove).toBe(1);
    expect(after.progress.boosters.shuffle).toBe(0);
    expect(after.progress.dailyStreak.days).toBe(7);
  });

  it('shares one streak with the daily tasks', () => {
    const task = pickDailyTasks(today())[0] as ReturnType<typeof pickDailyTasks>[number];
    const counts = { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 };
    counts[task.metric] = task.target;

    useGameStore.setState({ daily: { date: today(), counts, claimed: [] } });

    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    const afterGift = useGameStore.getState().progress.coins;

    expect(useGameStore.getState().claimDaily(task.id)).toBe(true);
    const afterTask = useGameStore.getState();

    // the second reward of the day pays the task itself, without the streak bonus
    expect(afterTask.progress.coins).toBe(afterGift + task.reward);
    expect(afterTask.progress.dailyStreak).toEqual({ days: 1, lastDay: today() });
    expect(afterTask.toast?.text).not.toContain('серия');
  });

  it('does not reopen a day after the clock rolled back', () => {
    const future = keyAfter(today(), 2);
    fresh({ dailyStreak: { days: 3, lastDay: future }, lastSeenDay: future });

    expect(useGameStore.getState().claimDailyGift()).toBe(false);
    expect(useGameStore.getState().progress.lastSeenDay).toBe(future);

    // the next day after the future one still pays normally
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        dailyStreak: { days: 3, lastDay: keyAfter(future, -1) },
      },
    });
    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    expect(useGameStore.getState().progress.dailyStreak.days).toBe(4);
  });

  it('follows a trusted time source day by day', () => {
    const base = new Date(2031, 0, 5, 10, 0, 0).getTime();
    expect(setTrustedTime(base)).toBe(true);
    fresh({ coins: 0 });

    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    expect(useGameStore.getState().progress.dailyStreak).toEqual({ days: 1, lastDay: '2031-01-05' });
    expect(useGameStore.getState().progress.lastSeenDay).toBe('2031-01-05');

    // the trusted clock rolls over to the next day: the next cell is paid
    setTrustedTime(base + DAY_MS);
    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    const after = useGameStore.getState().progress;
    expect(after.dailyStreak).toEqual({ days: 2, lastDay: '2031-01-06' });
    expect(after.coins).toBe(giftForDay(1).coins + giftForDay(2).coins);

    // a rolled back clock cannot reopen the day that was already collected
    setTrustedTime(base);
    expect(useGameStore.getState().claimDailyGift()).toBe(false);

    clearTrustedTime();
  });

  it('resets the calendar and the streak after a gap', () => {
    fresh({
      coins: 0,
      dailyStreak: { days: 4, lastDay: keyAfter(today(), -3) },
      lastSeenDay: keyAfter(today(), -3),
    });

    expect(useGameStore.getState().claimDailyGift()).toBe(true);
    const after = useGameStore.getState();

    expect(after.progress.dailyStreak).toEqual({ days: 1, lastDay: today() });
    expect(after.progress.coins).toBe(giftForDay(1).coins);
  });
});
