import { advanceStreak, type DailyStreak } from './dailies';
import { BOOSTERS, type BoosterId, type BoosterInventory } from '../core/boosters';

/**
 * Daily gift: a seven day calendar that pays for coming back every day. The
 * first visit of a day collects the cell of the current day; the reward grows
 * with the streak, and a missed day restarts both the streak and the calendar.
 *
 * Everything here is data — the calendar is a table, the cycle length is a
 * constant, and the store reads it through `giftCalendar`.
 */
export interface GiftDay {
  /** Cell of the calendar, 1..7. */
  day: number;
  coins: number;
  boosters?: Partial<BoosterInventory>;
  /** One line reward, shown on the card and in the toast. */
  label: string;
  /** Flavour text for the cell. */
  note: string;
  /** Product icon used on the cell. */
  icon: string;
}

export const GIFT_CYCLE_DAYS = 7;

export const DAILY_GIFTS: GiftDay[] = [
  {
    day: 1,
    coins: 40,
    label: '+40 монет',
    note: 'Разминка',
    icon: 'apple',
  },
  {
    day: 2,
    coins: 60,
    label: '+60 монет',
    note: 'Уже традиция',
    icon: 'bread',
  },
  {
    day: 3,
    coins: 80,
    boosters: { shuffle: 1 },
    label: '+80 монет и перемешивание',
    note: 'Сюрприз на полке',
    icon: 'cheese',
  },
  {
    day: 4,
    coins: 100,
    label: '+100 монет',
    note: 'Половина пути',
    icon: 'cake',
  },
  {
    day: 5,
    coins: 130,
    boosters: { undo: 1 },
    label: '+130 монет и отмена',
    note: 'Можно и передумать',
    icon: 'flower',
  },
  {
    day: 6,
    coins: 160,
    boosters: { hammer: 1 },
    label: '+160 монет и молоток',
    note: 'Тяжёлый день',
    icon: 'robot',
  },
  {
    day: 7,
    coins: 220,
    boosters: { extraMove: 1, hammer: 1 },
    label: '+220 монет, +3 хода и молоток',
    note: 'Большой подарок',
    icon: 'perfume',
  },
];

/** The cell of the calendar the given streak day pays for. Cyclic: 8 → 1. */
export function giftCycleDay(streakDays: number): number {
  const days = Math.floor(Number(streakDays));
  if (!Number.isFinite(days) || days <= 0) return 1;
  return ((days - 1) % GIFT_CYCLE_DAYS) + 1;
}

/** The gift of a calendar cell; out-of-range days are clamped to the calendar. */
export function giftForDay(day: number): GiftDay {
  const requested = Math.floor(Number(day));
  const cell = Number.isFinite(requested) ? Math.min(GIFT_CYCLE_DAYS, Math.max(1, requested)) : 1;
  return DAILY_GIFTS[cell - 1] as GiftDay;
}

export interface GiftBoosterLine {
  id: BoosterId;
  title: string;
  icon: string;
  count: number;
}

/** Boosters of a cell, ready to be rendered (icon + title + count). */
export function giftBoosterLines(gift: GiftDay): GiftBoosterLine[] {
  if (!gift.boosters) return [];
  const lines: GiftBoosterLine[] = [];
  for (const [id, count] of Object.entries(gift.boosters) as Array<[BoosterId, number]>) {
    if (!count || count <= 0) continue;
    const definition = BOOSTERS[id];
    lines.push({ id, title: definition.title, icon: definition.icon, count: Math.floor(count) });
  }
  return lines;
}

export interface GiftCalendar {
  /** The day the calendar lives in, `YYYY-MM-DD`. */
  day: string;
  /** What the streak becomes once today's gift is collected. */
  streak: DailyStreak;
  /** Cell of the calendar paid for the current visit, 1..7. */
  cycleDay: number;
  /** The gift of that cell. */
  gift: GiftDay;
  /** `true` while today's gift is still waiting to be collected. */
  canClaim: boolean;
  /** Cell that will be paid tomorrow (wraps to 1 after the seventh day). */
  tomorrow: GiftDay;
}

/** What the calendar looks like right now for a given streak and day. */
export function giftCalendar(streak: DailyStreak, day: string): GiftCalendar {
  const projected = advanceStreak(streak, day);
  const cycleDay = giftCycleDay(projected.days);

  return {
    day,
    streak: projected,
    cycleDay,
    gift: giftForDay(cycleDay),
    canClaim: streak.lastDay !== day,
    tomorrow: giftForDay(cycleDay >= GIFT_CYCLE_DAYS ? 1 : cycleDay + 1),
  };
}

/** `true` when the daily gift of `day` has not been collected yet. */
export function giftAvailable(streak: DailyStreak, day: string): boolean {
  return streak.lastDay !== day;
}
