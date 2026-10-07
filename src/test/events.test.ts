import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_EVENT_STATE,
  EVENTS,
  EVENT_LENGTH_DAYS,
  EVENT_METRICS,
  EVENT_METRIC_IDS,
  EVENT_ROTATION_ANCHOR,
  claimableEventTasks,
  emptyEventState,
  ensureEventState,
  eventById,
  eventDaysLeft,
  eventDeltas,
  eventFinaleReady,
  eventForDay,
  eventProductNames,
  eventTaskViews,
  eventWindow,
  rotationWeek,
  shiftDay,
  type EventTick,
  type GameEvent,
} from '../data/events';
import { ITEM_IDS } from '../data/items';
import { dailyKey } from '../data/dailies';
import { findHint } from '../core/solver';
import { useGameStore } from '../store/gameStore';
import { migrateEvents } from '../store/persistence';

const tick = (patch: Partial<EventTick> = {}): EventTick => ({
  cleared: [],
  triples: 0,
  golden: false,
  bomb: false,
  combo: 0,
  won: false,
  stars: 0,
  hintsUsed: 0,
  boostersUsed: 0,
  ...patch,
});

const cleared = (types: string[]): EventTick['cleared'] => types.map((type) => ({ type, special: null }));

describe('event config', () => {
  it('describes every event with a name, schedule, tasks and a finale', () => {
    expect(EVENTS.length).toBeGreaterThanOrEqual(3);

    const ids = EVENTS.map((event) => event.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const event of EVENTS) {
      expect(event.name.length).toBeGreaterThan(0);
      expect(event.tagline.length).toBeGreaterThan(0);
      expect(event.description.length).toBeGreaterThan(0);
      expect(event.icon.length).toBeGreaterThan(0);
      expect(event.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(event.tasks.length).toBeGreaterThanOrEqual(3);
      expect(event.finale.coins).toBeGreaterThanOrEqual(200);

      for (const product of event.products) expect(ITEM_IDS).toContain(product);
      for (const task of event.tasks) {
        expect(event.tasks.filter((entry) => entry.id === task.id)).toHaveLength(1);
        expect(task.target).toBeGreaterThan(0);
        expect(task.reward).toBeGreaterThan(0);
        expect(task.title.length).toBeGreaterThan(0);
        expect(ITEM_IDS).toContain(task.icon);
        expect(EVENT_METRIC_IDS).toContain(task.metric);
        expect(EVENT_METRICS[task.metric].label.length).toBeGreaterThan(0);
      }

      expect(eventById(event.id)).toBe(event);
      expect(eventProductNames(event)).toHaveLength(event.products.length);
    }
    expect(eventById('nope')).toBeUndefined();
  });

  it('only schedules events through data, not through the engine', () => {
    // a config that never existed in the code base becomes playable as is
    const holiday: GameEvent = {
      ...(EVENTS[0] as GameEvent),
      id: 'test-holiday',
      name: 'Тестовый праздник',
      schedule: { kind: 'window', from: '2030-03-01', to: '2030-03-03' },
    };

    expect(eventForDay('2030-03-01', [holiday])?.id).toBe('test-holiday');
    expect(eventForDay('2030-03-03', [holiday])?.id).toBe('test-holiday');
    expect(eventForDay('2030-03-04', [holiday])).toBeNull();
    expect(eventDaysLeft('2030-03-01', [holiday])).toBe(3);
    expect(eventDaysLeft('2030-03-03', [holiday])).toBe(1);
    expect(eventWindow('2030-03-02', holiday)).toEqual({ from: '2030-03-01', to: '2030-03-03' });
  });
});

describe('event rotation', () => {
  it('counts weeks from the anchor', () => {
    expect(rotationWeek(EVENT_ROTATION_ANCHOR)).toBe(0);
    expect(rotationWeek(shiftDay(EVENT_ROTATION_ANCHOR, 6))).toBe(0);
    expect(rotationWeek(shiftDay(EVENT_ROTATION_ANCHOR, 7))).toBe(1);
    expect(rotationWeek(shiftDay(EVENT_ROTATION_ANCHOR, -1))).toBe(-1);
    expect(rotationWeek('не день')).toBeNull();
  });

  it('shifts day keys across month and year borders', () => {
    expect(shiftDay('2026-10-06', 1)).toBe('2026-10-07');
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('runs an event Mon–Sun and rotates weekly', () => {
    const seen: string[] = [];
    for (let week = 0; week < EVENTS.length * 2; week += 1) {
      const day = shiftDay(EVENT_ROTATION_ANCHOR, week * EVENT_LENGTH_DAYS + 3);
      const event = eventForDay(day);
      expect(event, `event on ${day}`).toBeTruthy();
      seen.push(event?.id ?? '');
    }

    // a full cycle in the same order, then it repeats
    expect(seen.slice(0, EVENTS.length)).toEqual(seen.slice(EVENTS.length));
    expect(new Set(seen).size).toBe(EVENTS.length);

    // every day of one week belongs to the same event, and the next week starts a new one
    const monday = shiftDay(EVENT_ROTATION_ANCHOR, 7);
    const sunday = shiftDay(monday, 6);
    expect(eventForDay(monday)?.id).toBe(eventForDay(sunday)?.id);
    // the next Monday belongs to the following event of the rotation
    expect(eventForDay(shiftDay(sunday, 1))?.id).not.toBe(eventForDay(sunday)?.id);
  });

  it('reports the window and the days left', () => {
    const monday = shiftDay(EVENT_ROTATION_ANCHOR, 14);
    const sunday = shiftDay(monday, 6);

    expect(eventWindow(monday, eventForDay(monday) as GameEvent)).toEqual({ from: monday, to: sunday });
    expect(eventDaysLeft(monday)).toBe(7);
    expect(eventDaysLeft(sunday)).toBe(1);
    expect(eventDaysLeft(shiftDay(sunday, 1))).toBe(7);
    expect(eventDaysLeft('не день')).toBe(0);
  });

  it('prefers a pinned window over the rotation', () => {
    const pinned: GameEvent = {
      ...(EVENTS[0] as GameEvent),
      id: 'pinned',
      schedule: { kind: 'window', from: '2031-05-01', to: '2031-05-07' },
    };
    const list = [pinned, ...EVENTS];

    expect(eventForDay('2031-05-03', list)?.id).toBe('pinned');
    expect(eventForDay('2031-05-08', list)?.id).not.toBe('pinned');
    expect(eventForDay('broken day', list)).toBeNull();
    expect(eventForDay(EVENT_ROTATION_ANCHOR, [])).toBeNull();
  });
});

describe('event metrics', () => {
  it('counts triples, categories and specials from the metric table', () => {
    const deltas = eventDeltas(
      tick({
        cleared: cleared(['cake', 'cake', 'cake', 'phone', 'phone', 'phone', 'apple', 'apple', 'apple']),
        triples: 3,
        golden: true,
        bomb: true,
        combo: 4,
        won: true,
        stars: 3,
        boostersUsed: 1,
      }),
    );

    expect(EVENT_METRIC_IDS).toHaveLength(Object.keys(EVENT_METRICS).length);
    expect(deltas.matches).toBe(3);
    expect(deltas.sweets).toBe(1);
    expect(deltas.electronics).toBe(1);
    expect(deltas.flowers).toBe(0);
    expect(deltas.golden).toBe(1);
    expect(deltas.bombs).toBe(1);
    expect(deltas.combo).toBe(1);
    expect(deltas.levels).toBe(1);
    expect(deltas.stars).toBe(3);
    expect(deltas.boosters).toBe(1);
  });

  it('counts partial groups and quiet moves as nothing', () => {
    const partial = eventDeltas(tick({ cleared: cleared(['candy', 'candy']), triples: 0 }));
    expect(partial.sweets).toBe(0);
    expect(partial.matches).toBe(0);
    expect(partial.combo).toBe(0);

    const quiet = eventDeltas(tick({ combo: 2, hintsUsed: 2 }));
    expect(Object.values(quiet).every((value) => value === 0)).toBe(true);

    const weakCombo = eventDeltas(tick({ combo: 2 }));
    expect(weakCombo.combo).toBe(0);
    expect(eventDeltas(tick({ combo: 3 })).combo).toBe(1);
  });
});

describe('event progress state', () => {
  it('starts a fresh state for the running event and drops the old one', () => {
    const monday = shiftDay(EVENT_ROTATION_ANCHOR, 21);
    const event = eventForDay(monday) as GameEvent;

    const fresh = ensureEventState(EMPTY_EVENT_STATE, monday);
    expect(fresh.id).toBe(event.id);
    expect(fresh.counts).toEqual({});
    expect(fresh.claimed).toEqual([]);

    const stale = { id: 'other-event', day: '2020-01-01', counts: { matches: 5 }, claimed: ['x'], finaleClaimed: true };
    expect(ensureEventState(stale, monday)).toEqual(fresh);

    const same = { ...fresh, counts: { matches: 2 } };
    expect(ensureEventState(same, monday)).toBe(same);
  });

  it('clears everything when no event is running', () => {
    const state = { id: 'sweet-week', day: '2026-01-05', counts: { matches: 3 }, claimed: [], finaleClaimed: false };
    const idle = ensureEventState(state, 'not a day');
    expect(idle.id).toBe('');
    expect(idle.counts).toEqual({});
    expect(ensureEventState(EMPTY_EVENT_STATE, 'not a day')).toBe(EMPTY_EVENT_STATE);
  });

  it('walks tasks from empty to done to claimed', () => {
    const day = shiftDay(EVENT_ROTATION_ANCHOR, 0);
    const event = eventForDay(day) as GameEvent;
    const state = emptyEventState(event.id, day);

    const empty = eventTaskViews(state, event);
    expect(empty).toHaveLength(event.tasks.length);
    expect(empty.every((view) => !view.done && !view.claimed)).toBe(true);
    expect(claimableEventTasks(state, event)).toBe(0);
    expect(eventFinaleReady(state, event)).toBe(false);

    const first = event.tasks[0] as (typeof event.tasks)[number];
    const partial = { ...state, counts: { [first.metric]: first.target - 1 } };
    expect(eventTaskViews(partial, event)[0]?.done).toBe(false);

    const done = { ...state, counts: { [first.metric]: first.target } };
    expect(eventTaskViews(done, event)[0]?.done).toBe(true);
    expect(eventTaskViews(done, event)[0]?.ratio).toBe(1);
    expect(claimableEventTasks(done, event)).toBe(1);

    const claimed = { ...done, claimed: [first.id] };
    expect(claimableEventTasks(claimed, event)).toBe(0);

    // a mismatching event id never renders progress of another event
    expect(eventTaskViews({ ...done, id: 'other' }, event)).toEqual([]);
    expect(eventTaskViews(done, null)).toEqual([]);
  });

  it('unlocks the finale only when every task is done', () => {
    const day = shiftDay(EVENT_ROTATION_ANCHOR, 0);
    const event = eventForDay(day) as GameEvent;
    const counts = Object.fromEntries(event.tasks.map((task) => [task.metric, task.target]));
    const state = { ...emptyEventState(event.id, day), counts };

    expect(eventFinaleReady(state, event)).toBe(true);
    expect(eventFinaleReady({ ...state, finaleClaimed: true }, event)).toBe(false);
    // one unfinished task is enough to lock the finale
    const first = event.tasks[0] as (typeof event.tasks)[number];
    expect(eventFinaleReady({ ...state, counts: { ...counts, [first.metric]: 0 } }, event)).toBe(false);
    expect(eventFinaleReady({ ...state, id: 'other' }, event)).toBe(false);
    expect(eventFinaleReady(state, null)).toBe(false);
  });
});

describe('events in the store', () => {
  const today = (): string => dailyKey(new Date());
  const running = (): GameEvent => {
    const event = eventForDay(today());
    if (!event) throw new Error('the suite expects an event to run today');
    return event;
  };

  const setEventState = (patch: Partial<ReturnType<typeof useGameStore.getState>['events']>): void => {
    const event = eventForDay(today());
    useGameStore.setState({
      phase: 'menu',
      runtime: null,
      events: { ...emptyEventState(event?.id ?? '', today()), counts: {}, claimed: [], ...patch },
      progress: { ...useGameStore.getState().progress, coins: 0, boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 } },
    });
  };

  beforeEach(() => {
    useGameStore.setState({ toast: null });
    setEventState({});
  });

  it('claims a finished task once and pays the reward with its booster', () => {
    const event = running();
    const task = event.tasks.find((entry) => entry.boosters) ?? (event.tasks[0] as (typeof event.tasks)[number]);
    setEventState({ counts: { [task.metric]: task.target } });

    expect(useGameStore.getState().claimEventTask(task.id)).toBe(true);
    const after = useGameStore.getState();

    expect(after.progress.coins).toBe(task.reward);
    expect(after.events.claimed).toContain(task.id);
    expect(after.toast?.text).toContain(event.name);
    if (task.boosters) {
      for (const [id, count] of Object.entries(task.boosters)) {
        expect(after.progress.boosters[id as 'hammer']).toBe(count);
      }
    }

    expect(useGameStore.getState().claimEventTask(task.id)).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(task.reward);
    expect(useGameStore.getState().toast?.text).toContain('уже получена');
  });

  it('refuses a task that is not finished', () => {
    const event = running();
    const task = event.tasks[0] as (typeof event.tasks)[number];

    expect(useGameStore.getState().claimEventTask(task.id)).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(0);
    expect(useGameStore.getState().toast?.text).toContain('не выполнено');
  });

  it('pays the finale only after every task and only once', () => {
    const event = running();
    const counts = Object.fromEntries(event.tasks.map((task) => [task.metric, task.target]));

    setEventState({ counts: { [event.tasks[0]?.metric ?? 'matches']: 1 } });
    expect(useGameStore.getState().claimEventFinale()).toBe(false);
    expect(useGameStore.getState().toast?.text).toContain('Сначала выполните');

    setEventState({ counts });
    expect(useGameStore.getState().claimEventFinale()).toBe(true);

    const after = useGameStore.getState();
    expect(after.progress.coins).toBe(event.finale.coins);
    expect(after.events.finaleClaimed).toBe(true);
    expect(after.progress.eventWins).toContain(event.id);
    for (const [id, count] of Object.entries(event.finale.boosters ?? {})) {
      expect(after.progress.boosters[id as 'hammer']).toBe(count);
    }

    expect(useGameStore.getState().claimEventFinale()).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(event.finale.coins);
  });

  it('counts a real move into the event progress', () => {
    const event = running();
    setEventState({});
    useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 0 } });

    useGameStore.getState().startLevel(2);
    for (let guard = 0; guard < 200; guard += 1) {
      const state = useGameStore.getState();
      if (state.phase !== 'playing' || !state.runtime) break;
      const hint = findHint(state.runtime.board, { goal: state.runtime.goal });
      if (!hint) break;
      state.requestMove(hint.from, hint.to);
    }

    const after = useGameStore.getState();
    expect(after.events.id).toBe(event.id);
    expect(after.events.counts.matches ?? 0).toBeGreaterThan(0);
    expect(after.events.counts.levels ?? 0).toBeGreaterThan(0);
    expect(after.events.counts.stars ?? 0).toBeGreaterThan(0);
  });

  it('counts a used booster', () => {
    // the running event is the one the store counts into
    expect(running().id).toBe(useGameStore.getState().events.id || running().id);
    setEventState({});
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, boosters: { hammer: 2, shuffle: 0, extraMove: 0, undo: 0 } },
    });

    useGameStore.getState().startLevel(2);
    const board = useGameStore.getState().runtime?.board;
    const index = board?.cells.findIndex((cell) => cell.type !== null) ?? -1;
    expect(useGameStore.getState().useBooster('hammer', index)).toBe(true);

    expect(useGameStore.getState().events.counts.boosters).toBe(1);
  });
});

describe('event migration', () => {
  it('keeps only the progress of the running event', () => {
    const day = shiftDay(EVENT_ROTATION_ANCHOR, 0);
    const event = eventForDay(day) as GameEvent;
    const first = event.tasks[0] as (typeof event.tasks)[number];

    const kept = migrateEvents(
      { id: event.id, day, counts: { [first.metric]: 5, matches: 3 }, claimed: [first.id, 'ghost'], finaleClaimed: false },
      day,
    );
    expect(kept.id).toBe(event.id);
    expect(kept.counts[first.metric]).toBe(5);
    expect(kept.claimed).toEqual([first.id]);

    const foreign = migrateEvents(
      { id: 'sweet-week', day, counts: { matches: 9 }, claimed: [], finaleClaimed: false },
      event.id === 'sweet-week' ? shiftDay(day, 7) : day,
    );
    expect(foreign.id).toBe(eventForDay(shiftDay(day, 7))?.id ?? '');
  });

  it('drops broken data and starts the running event from zero', () => {
    const running = eventForDay(EVENT_ROTATION_ANCHOR) as GameEvent;
    for (const bad of [null, undefined, 42, 'nope', [], {}]) {
      const migrated = migrateEvents(bad, EVENT_ROTATION_ANCHOR);
      expect(migrated.id).toBe(running.id);
      expect(migrated.counts).toEqual({});
      expect(migrated.claimed).toEqual([]);
    }

    // no event at all → a fully empty state
    expect(migrateEvents({ id: running.id }, 'не день')).toEqual(EMPTY_EVENT_STATE);

    const negative = migrateEvents(
      { id: running.id, day: '', counts: { matches: -5 }, claimed: 'nope' },
      EVENT_ROTATION_ANCHOR,
    );
    expect(negative.counts.matches).toBeUndefined();
    expect(negative.claimed).toEqual([]);
  });
});
