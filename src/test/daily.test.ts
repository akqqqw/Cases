import { describe, expect, it } from 'vitest';
import {
  DAILY_TASK_COUNT,
  DAILY_TASKS,
  EMPTY_STREAK,
  METRIC_LABELS,
  advanceStreak,
  dailyKey,
  formatCountdown,
  hashKey,
  isYesterday,
  msUntilTomorrow,
  pickDailyTasks,
  streakBonus,
} from '../data/dailies';
import { migrateStreak } from '../store/persistence';
import { BAR_SECONDS, PROGRESSION, bellNote, chordAt, midiToFreq, nextChordIndex } from '../game/musicTheory';
import { ITEM_IDS } from '../data/items';

describe('daily tasks', () => {
  it('has sane, well paid tasks', () => {
    expect(DAILY_TASKS.length).toBeGreaterThanOrEqual(6);
    for (const task of DAILY_TASKS) {
      expect(task.target).toBeGreaterThan(0);
      expect(task.reward).toBeGreaterThan(0);
      expect(task.title.length).toBeGreaterThan(0);
      expect(METRIC_LABELS[task.metric]).toBeTruthy();
      expect(ITEM_IDS).toContain(task.icon);
    }
  });

  it('picks three different tasks for a day, deterministically', () => {
    const first = pickDailyTasks('2026-10-06');
    const again = pickDailyTasks('2026-10-06');
    expect(first).toHaveLength(DAILY_TASK_COUNT);
    expect(first.map((task) => task.id)).toEqual(again.map((task) => task.id));
    expect(new Set(first.map((task) => task.id)).size).toBe(DAILY_TASK_COUNT);
  });

  it('gives different tasks on different days', () => {
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'];
    const sets = days.map((day) => pickDailyTasks(day).map((task) => task.id).join(','));
    expect(new Set(sets).size).toBeGreaterThan(1);
  });

  it('never asks for more tasks than exist', () => {
    expect(pickDailyTasks('2026-10-06', 999)).toHaveLength(DAILY_TASKS.length);
  });

  it('formats the local date key and the hash stable', () => {
    expect(dailyKey(new Date(2026, 9, 6))).toBe('2026-10-06');
    expect(dailyKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(hashKey('2026-10-06')).toBe(hashKey('2026-10-06'));
    expect(hashKey('a')).not.toBe(hashKey('b'));
  });

  it('counts down to midnight', () => {
    const noon = new Date(2026, 9, 6, 12, 0, 0);
    expect(msUntilTomorrow(noon)).toBe(12 * 60 * 60 * 1000);
    expect(formatCountdown(msUntilTomorrow(noon))).toBe('12 ч 0 мин');
    expect(formatCountdown(90 * 1000)).toBe('1 мин');
  });
});

describe('daily streak', () => {
  it('grows on consecutive days and restarts after a gap', () => {
    let streak = advanceStreak(EMPTY_STREAK, '2026-10-06');
    expect(streak).toEqual({ days: 1, lastDay: '2026-10-06' });

    // second reward on the very same day does not inflate the streak
    expect(advanceStreak(streak, '2026-10-06')).toEqual({ days: 1, lastDay: '2026-10-06' });

    streak = advanceStreak(streak, '2026-10-07');
    streak = advanceStreak(streak, '2026-10-08');
    expect(streak.days).toBe(3);

    expect(advanceStreak(streak, '2026-10-11')).toEqual({ days: 1, lastDay: '2026-10-11' });
  });

  it('knows what yesterday means', () => {
    expect(isYesterday('2026-10-05', '2026-10-06')).toBe(true);
    expect(isYesterday('2026-10-04', '2026-10-06')).toBe(false);
    expect(isYesterday('', '2026-10-06')).toBe(false);
    expect(isYesterday('2026-09-30', '2026-10-01')).toBe(true);
  });

  it('pays a growing but capped bonus', () => {
    expect(streakBonus(0)).toBe(0);
    expect(streakBonus(1)).toBe(0);
    expect(streakBonus(2)).toBe(10);
    expect(streakBonus(5)).toBe(40);
    expect(streakBonus(99)).toBe(50);
  });

  it('sanitises a stored streak', () => {
    expect(migrateStreak(undefined)).toEqual(EMPTY_STREAK);
    expect(migrateStreak({ days: 4, lastDay: '2026-10-05' })).toEqual({ days: 4, lastDay: '2026-10-05' });
    expect(migrateStreak({ days: -2, lastDay: '2026-10-05' })).toEqual(EMPTY_STREAK);
    expect(migrateStreak({ days: 4, lastDay: 'nonsense' })).toEqual(EMPTY_STREAK);
    expect(migrateStreak({ days: 4, lastDay: '2999-01-01' })).toEqual(EMPTY_STREAK);
  });
});

describe('background music theory', () => {
  it('loops a four chord progression', () => {
    expect(PROGRESSION).toHaveLength(4);
    for (const chord of PROGRESSION) {
      expect(chord.notes.length).toBeGreaterThanOrEqual(3);
      for (const note of chord.notes) expect(note).toBeGreaterThanOrEqual(0);
    }
    expect(nextChordIndex(0)).toBe(0);
    expect(nextChordIndex(3)).toBe(3);
    expect(nextChordIndex(4)).toBe(0);
    expect(nextChordIndex(-1)).toBe(3);
  });

  it('maps midi notes to audible frequencies', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 5);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
    expect(chordAt(2).name).toBe('C');
    expect(chordAt(5).name).toBe('F'); // 5 -> 1
  });

  it('keeps the melody inside a pleasant range', () => {
    const bpm = 60 / BAR_SECONDS;
    expect(bpm).toBeGreaterThan(10);
    for (let step = 0; step < 16; step += 1) {
      const note = bellNote(step);
      expect(note).toBeGreaterThan(50);
      expect(note).toBeLessThan(96);
    }
  });
});
