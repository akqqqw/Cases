import { CATEGORY_LABELS, ITEMS, getItem, type ItemCategory } from './items';
import { dayDiff } from './clock';
import type { BoosterInventory } from '../core/boosters';

/**
 * Temporary events. An event is a **config entry**: a schedule, a set of tasks
 * and a finale reward. The engine (store, HUD, level runtime) never mentions an
 * event by name — it asks this module what is active today and which counters to
 * bump, so a new event is one more object in `EVENTS`.
 */
export type EventMetricId =
  | 'matches'
  | 'sweets'
  | 'electronics'
  | 'flowers'
  | 'golden'
  | 'bombs'
  | 'stars'
  | 'levels'
  | 'combo'
  | 'boosters';

/**
 * Everything a metric may look at. The store fills it from the move it just
 * applied, so a metric is a pure function of one move — no engine edit needed to
 * add another one.
 */
export interface EventTick {
  /** Products cleared by the move (a bomb blast is already included). */
  cleared: Array<{ type: string; special: string | null }>;
  /** Collected triples of the move. */
  triples: number;
  golden: boolean;
  bomb: boolean;
  /** Combo streak after the move (0 when the run was broken). */
  combo: number;
  /** `true` when this move finished the level. */
  won: boolean;
  /** Stars of the finished level (0 when it is not finished). */
  stars: number;
  hintsUsed: number;
  boostersUsed: number;
}

export interface EventMetricDef {
  /** Word used in the task line («12 тройки сладостей»). */
  label: string;
  /** Counter increment for one move. */
  of: (tick: EventTick) => number;
}

/** Cleared products of one category, counted in triples. */
function categoryTriples(category: ItemCategory) {
  return (tick: EventTick): number => {
    let count = 0;
    for (const item of tick.cleared) if (getItem(item.type)?.category === category) count += 1;
    return Math.floor(count / 3);
  };
}

/**
 * Metric table. A new metric — including a new product category — is one row
 * here; nothing else in the game has to change.
 */
export const EVENT_METRICS: Record<EventMetricId, EventMetricDef> = {
  matches: { label: 'тройки', of: (tick) => tick.triples },
  sweets: { label: 'тройки сладкого', of: categoryTriples('sweets') },
  electronics: { label: 'тройки техники', of: categoryTriples('electronics') },
  flowers: { label: 'тройки цветов', of: categoryTriples('flowers') },
  golden: { label: 'золотые тройки', of: (tick) => (tick.golden ? 1 : 0) },
  bombs: { label: 'взрывы', of: (tick) => (tick.bomb ? 1 : 0) },
  stars: { label: 'звёзды', of: (tick) => (tick.won ? Math.max(0, tick.stars) : 0) },
  levels: { label: 'уровни', of: (tick) => (tick.won ? 1 : 0) },
  combo: { label: 'комбо ×3 и больше', of: (tick) => (tick.combo >= 3 ? 1 : 0) },
  boosters: { label: 'бустеры', of: (tick) => Math.max(0, tick.boostersUsed) },
};

export const EVENT_METRIC_IDS = Object.keys(EVENT_METRICS) as EventMetricId[];

/** Counter increments of one move, for every metric at once. */
export function eventDeltas(tick: EventTick): Record<EventMetricId, number> {
  const deltas = {} as Record<EventMetricId, number>;
  for (const id of EVENT_METRIC_IDS) deltas[id] = EVENT_METRICS[id].of(tick);
  return deltas;
}

// ------------------------------------------------------------------- config

export interface EventTaskDef {
  id: string;
  metric: EventMetricId;
  target: number;
  /** Coins paid for the task. */
  reward: number;
  title: string;
  /** Product icon shown on the card. */
  icon: string;
  /** Boosters handed over together with the coins. */
  boosters?: Partial<BoosterInventory>;
}

export interface EventFinale {
  title: string;
  /** One line prize description. */
  label: string;
  coins: number;
  boosters?: Partial<BoosterInventory>;
}

/** Either a fixed calendar window or the weekly rotation. */
export type EventSchedule =
  | { kind: 'window'; from: string; to: string }
  | { kind: 'rotation'; /** Rotation slot, `index % EVENTS.length` by default. */ slot?: number };

export interface GameEvent {
  id: string;
  name: string;
  /** Short line for the menu banner. */
  tagline: string;
  description: string;
  /** Emoji shown in the banner and on the button. */
  icon: string;
  /** Accent colour used by the event screen. */
  accent: string;
  /** Products the event celebrates (shown as a row of icons). */
  products: string[];
  schedule: EventSchedule;
  tasks: EventTaskDef[];
  finale: EventFinale;
}

/** Rotation week 0 starts here — a Monday, so an event always lasts Mon–Sun. */
export const EVENT_ROTATION_ANCHOR = '2026-01-05';
export const EVENT_LENGTH_DAYS = 7;

export const EVENTS: GameEvent[] = [
  {
    id: 'sweet-week',
    name: 'Неделя сладостей',
    tagline: 'Кондитерский отдел угощает',
    description:
      'Семь дней сладкого ажиотажа: собирайте тройки тортов, конфет и пончиков, держите комбо и получайте монеты с бустерами.',
    icon: '🧁',
    accent: '#e0688f',
    products: ['cake', 'candy', 'donut'],
    schedule: { kind: 'rotation', slot: 0 },
    tasks: [
      {
        id: 'sweets-6',
        metric: 'sweets',
        target: 6,
        reward: 90,
        title: 'Собери 6 троек сладостей',
        icon: 'cake',
      },
      {
        id: 'combo-3',
        metric: 'combo',
        target: 3,
        reward: 120,
        title: 'Собери 3 комбо по три тройки',
        icon: 'candy',
        boosters: { shuffle: 1 },
      },
      {
        id: 'sweets-12',
        metric: 'sweets',
        target: 12,
        reward: 170,
        title: 'Собери 12 троек сладостей',
        icon: 'donut',
      },
      {
        id: 'levels-4',
        metric: 'levels',
        target: 4,
        reward: 150,
        title: 'Пройди 4 уровня за неделю',
        icon: 'cake',
        boosters: { extraMove: 1 },
      },
    ],
    finale: {
      title: 'Сладкий финал',
      label: '+500 монет, молоток и перемешивание',
      coins: 500,
      boosters: { hammer: 1, shuffle: 1 },
    },
  },
  {
    id: 'tech-days',
    name: 'Дни техники',
    tagline: 'Витрина гаджетов',
    description:
      'Неделя электроники: тройки телефонов, наушников и фотоаппаратов, взрывы и щедрые награды за пройденные уровни.',
    icon: '📱',
    accent: '#4f8ce0',
    products: ['phone', 'headphones', 'camera'],
    schedule: { kind: 'rotation', slot: 1 },
    tasks: [
      {
        id: 'tech-6',
        metric: 'electronics',
        target: 6,
        reward: 90,
        title: 'Собери 6 троек техники',
        icon: 'phone',
      },
      {
        id: 'bombs-3',
        metric: 'bombs',
        target: 3,
        reward: 130,
        title: 'Взорви 3 бомбы',
        icon: 'camera',
        boosters: { hammer: 1 },
      },
      {
        id: 'golden-3',
        metric: 'golden',
        target: 3,
        reward: 150,
        title: 'Собери 3 золотые тройки',
        icon: 'headphones',
      },
      {
        id: 'levels-4',
        metric: 'levels',
        target: 4,
        reward: 150,
        title: 'Пройди 4 уровня за неделю',
        icon: 'phone',
        boosters: { extraMove: 1 },
      },
    ],
    finale: {
      title: 'Техно-финал',
      label: '+500 монет и +3 хода',
      coins: 500,
      boosters: { extraMove: 1 },
    },
  },
  {
    id: 'flower-festival',
    name: 'Фестиваль цветов',
    tagline: 'Оранжерея на полках',
    description:
      'Праздник цветов: тройки ромашек, кактусов и тюльпанов плюс награды за звёзды и подсказки, которых хватит на всю неделю.',
    icon: '🌷',
    accent: '#4caf7d',
    products: ['flower', 'cactus', 'tulip'],
    schedule: { kind: 'rotation', slot: 2 },
    tasks: [
      {
        id: 'flowers-6',
        metric: 'flowers',
        target: 6,
        reward: 90,
        title: 'Собери 6 троек цветов',
        icon: 'flower',
      },
      {
        id: 'stars-9',
        metric: 'stars',
        target: 9,
        reward: 160,
        title: 'Заработай 9 звёзд за неделю',
        icon: 'tulip',
        boosters: { hammer: 1 },
      },
      {
        id: 'flowers-12',
        metric: 'flowers',
        target: 12,
        reward: 170,
        title: 'Собери 12 троек цветов',
        icon: 'cactus',
      },
      {
        id: 'boosters-3',
        metric: 'boosters',
        target: 3,
        reward: 110,
        title: 'Используй 3 бустера',
        icon: 'flower',
        boosters: { undo: 1 },
      },
    ],
    finale: {
      title: 'Цветочный финал',
      label: '+500 монет и бесплатная отмена',
      coins: 500,
      boosters: { undo: 1 },
    },
  },
];

export const EVENT_BY_ID: Record<string, GameEvent> = Object.fromEntries(
  EVENTS.map((event) => [event.id, event]),
);

export function eventById(id: string): GameEvent | undefined {
  return EVENT_BY_ID[id];
}

// ---------------------------------------------------------------- scheduling

/** Rotation order: explicit slots first, then the remaining events in order. */
function rotationOrder(events: GameEvent[]): GameEvent[] {
  const rotated = events.filter((event) => event.schedule.kind === 'rotation');
  return rotated.sort((a, b) => {
    const slotA = a.schedule.kind === 'rotation' ? a.schedule.slot ?? events.indexOf(a) : 0;
    const slotB = b.schedule.kind === 'rotation' ? b.schedule.slot ?? events.indexOf(b) : 0;
    return slotA - slotB;
  });
}

/** Rotation week number of a day (`0` = the anchor week, negative before it). */
export function rotationWeek(day: string): number | null {
  const diff = dayDiff(EVENT_ROTATION_ANCHOR, day);
  if (diff === null) return null;
  return Math.floor(diff / EVENT_LENGTH_DAYS);
}

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

/** First and last day of the event that owns `day` (inclusive). */
export function eventWindow(day: string, event: GameEvent): { from: string; to: string } | null {
  if (event.schedule.kind === 'window') return { from: event.schedule.from, to: event.schedule.to };

  const diff = dayDiff(EVENT_ROTATION_ANCHOR, day);
  if (diff === null) return null;
  const weekStart = mod(diff, EVENT_LENGTH_DAYS);
  const from = shiftDay(day, -weekStart);
  return { from, to: shiftDay(from, EVENT_LENGTH_DAYS - 1) };
}

/** `YYYY-MM-DD` shifted by whole days. */
export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  const y = shifted.getUTCFullYear();
  const m = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${shifted.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The event of the day: a fixed window wins over the rotation, so a holiday
 * event can be pinned to exact dates.
 */
export function eventForDay(day: string, events: GameEvent[] = EVENTS): GameEvent | null {
  if (dayDiff(day, day) === null) return null;

  for (const event of events) {
    const schedule = event.schedule;
    if (schedule.kind !== 'window') continue;
    if (dayDiff(schedule.from, day) !== null && day >= schedule.from && day <= schedule.to) return event;
  }

  const order = rotationOrder(events);
  if (order.length === 0) return null;
  const week = rotationWeek(day);
  if (week === null) return null;
  return order[mod(week, order.length)] ?? null;
}

/** Days left of the event of the day, counting today (`0` when idle). */
export function eventDaysLeft(day: string, events: GameEvent[] = EVENTS): number {
  const event = eventForDay(day, events);
  if (!event) return 0;
  const window = eventWindow(day, event);
  if (!window) return 0;
  const left = dayDiff(day, window.to);
  return left === null ? 0 : Math.max(0, left + 1);
}

/** Event tasks with their progress, ready to be rendered. */
export interface EventTaskView {
  task: EventTaskDef;
  value: number;
  done: boolean;
  claimed: boolean;
  ratio: number;
}

export interface EventProgressState {
  id: string;
  day: string;
  counts: Record<string, number>;
  claimed: string[];
  finaleClaimed: boolean;
}

export const EMPTY_EVENT_STATE: EventProgressState = {
  id: '',
  day: '',
  counts: {},
  claimed: [],
  finaleClaimed: false,
};

export function emptyEventState(id = '', day = ''): EventProgressState {
  return { id, day, counts: {}, claimed: [], finaleClaimed: false };
}

/** The event state after the active event and/or the day changed. */
export function ensureEventState(state: EventProgressState, day: string, events: GameEvent[] = EVENTS): EventProgressState {
  const event = eventForDay(day, events);
  if (!event) return state.id === '' ? state : emptyEventState('', day);
  if (state.id !== event.id) return emptyEventState(event.id, day);
  return state.day === day ? state : { ...state, day };
}

export function eventTaskViews(
  state: EventProgressState,
  event: GameEvent | null,
): EventTaskView[] {
  if (!event || state.id !== event.id) return [];
  return event.tasks.map((task) => {
    const value = Math.max(0, Math.floor(state.counts[task.metric] ?? 0));
    const done = value >= task.target;
    const claimed = state.claimed.includes(task.id);
    return { task, value, done, claimed, ratio: Math.min(1, value / task.target) };
  });
}

/** Tasks whose reward is ready to be collected right now. */
export function claimableEventTasks(state: EventProgressState, event: GameEvent | null): number {
  return eventTaskViews(state, event).filter((view) => view.done && !view.claimed).length;
}

/** `true` when every task is done and the finale is still waiting. */
export function eventFinaleReady(state: EventProgressState, event: GameEvent | null): boolean {
  if (!event || state.id !== event.id || state.finaleClaimed) return false;
  const views = eventTaskViews(state, event);
  return views.length > 0 && views.every((view) => view.done);
}

/** Products celebrated by an event, with their display names. */
export function eventProductNames(event: GameEvent): string[] {
  return event.products.map((id) => ITEMS[id]?.name ?? id);
}

/** Category label an event metric belongs to, for the description line. */
export function eventCategoryLabel(metric: EventMetricId): string {
  if (metric === 'sweets') return CATEGORY_LABELS.sweets;
  if (metric === 'electronics') return CATEGORY_LABELS.electronics;
  if (metric === 'flowers') return CATEGORY_LABELS.flowers;
  return EVENT_METRICS[metric].label;
}
