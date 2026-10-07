import { useEffect, useMemo, useState } from 'react';
import { Button, CoinPill, IconButton } from './components';
import { ItemIcon } from './ItemIcon';
import { currentDayKey, resolveDay } from '../data/clock';
import {
  EMPTY_EVENT_STATE,
  claimableEventTasks,
  ensureEventState,
  eventDaysLeft,
  eventFinaleReady,
  eventForDay,
  eventProductNames,
  eventTaskViews,
  eventWindow,
  type GameEvent,
} from '../data/events';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';

export interface EventScreenProps {
  onBack: () => void;
}

const PLURALS: Array<[number, string]> = [
  [1, 'день'],
  [2, 'дня'],
  [3, 'дня'],
  [4, 'дня'],
];

/** «осталось 3 дня» — the event is a week long, so simple plural forms suffice. */
export function daysLeftLabel(days: number): string {
  const value = Math.max(0, Math.floor(days));
  if (value === 0) return 'событие закончилось';
  if (value === 1) return 'последний день';
  const tail = value % 10;
  const form = PLURALS.find(([key]) => key === tail)?.[1] ?? 'дней';
  return `осталось ${value} ${form}`;
}

/** Temporary event screen: tasks, progress and the finale prize. */
export function EventScreen({ onBack }: EventScreenProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const events = useGameStore((state) => state.events);
  const claimEventTask = useGameStore((state) => state.claimEventTask);
  const claimEventFinale = useGameStore((state) => state.claimEventFinale);
  const [tick, setTick] = useState(() => currentDayKey());

  // The event can end while the screen is open (or at midnight).
  useEffect(() => {
    const timer = window.setInterval(() => setTick(currentDayKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const day = resolveDay(progress.lastSeenDay, tick);
  const event = useMemo<GameEvent | null>(() => eventForDay(day), [day]);
  const state = useMemo(() => ensureEventState(events, day), [events, day]);
  const views = useMemo(() => eventTaskViews(state, event), [state, event]);
  const period = event ? eventWindow(day, event) : null;
  const left = eventDaysLeft(day);
  const finaleReady = eventFinaleReady(state, event);

  if (!event) {
    return (
      <div className="screen event-screen event-screen-idle">
        <header className="screen-header">
          <IconButton title="В меню" onClick={() => {
          audio.unlock();
          audio.uiClose();
          onBack();
        }} className="back-btn">
            <span className="back-glyph" aria-hidden="true">
              ‹
            </span>
          </IconButton>
          <h2 className="screen-title">Событие</h2>
          <div className="screen-header-right">
            <CoinPill coins={progress.coins} compact />
          </div>
        </header>
        <div className="event-idle">
          <div className="event-idle-art" aria-hidden="true">
            🗓
          </div>
          <h3>Сейчас события нет</h3>
          <p>
            События идут неделю и сменяют друг друга: «Неделя сладостей», «Дни техники»,
            «Фестиваль цветов» — и дальше по кругу. Заходите в игру, чтобы не пропустить.
          </p>
          <Button tone="secondary" onClick={onBack}>
            Играть
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen event-screen" data-event={event.id} style={{ ['--event-accent' as string]: event.accent }}>
      <header className="screen-header">
        <IconButton title="В меню" onClick={onBack} className="back-btn">
          <span className="back-glyph" aria-hidden="true">
            ‹
          </span>
        </IconButton>
        <h2 className="screen-title">
          Событие
          <span className="event-name">
            {event.icon} {event.name}
          </span>
        </h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <div className="event-banner">
        <div className="event-banner-head">
          <span className="event-tagline">{event.tagline}</span>
          <span className={`event-timer${left <= 1 ? ' event-timer-last' : ''}`}>{daysLeftLabel(left)}</span>
        </div>
        <p className="event-description">{event.description}</p>
        <div className="event-products">
          {event.products.map((id) => (
            <span className="event-product" key={id} title={eventProductNames(event).join(', ')}>
              <ItemIcon id={id} size={30} tile />
            </span>
          ))}
          <span className="event-window">
            {period ? `${period.from} — ${period.to}` : ''}
          </span>
        </div>
      </div>

      <div className="event-scroll">
        <h3 className="event-section">Задания события</h3>
        <div className="event-tasks">
          {views.map(({ task, value, done, claimed, ratio }) => (
            <article
              className={`daily-card event-card${done ? ' daily-card-done' : ''}${claimed ? ' daily-card-claimed' : ''}`}
              key={task.id}
            >
              <div className="daily-icon">
                <ItemIcon id={task.icon} size={52} tile />
              </div>

              <div className="daily-body">
                <h3 className="daily-title">{task.title}</h3>
                <div className="daily-progress">
                  <div className="daily-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                  <span className="daily-progress-label">
                    {Math.min(value, task.target)}/{task.target}
                  </span>
                </div>
                {task.boosters ? (
                  <span className="event-bonus">
                    {Object.entries(task.boosters).map(([id, count]) => (
                      <span className="event-bonus-line" key={id}>
                        бонус: {id} ×{count}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>

              <div className="daily-action">
                {claimed ? (
                  <span className="owned-badge">Получено</span>
                ) : (
                  <Button
                    tone={done ? 'primary' : 'secondary'}
                    size="sm"
                    disabled={!done}
                    onClick={() => {
                      audio.tap();
                      claimEventTask(task.id);
                    }}
                  >
                    <span className="price-tag">
                      <span className="coin-icon" aria-hidden="true" />
                      {task.reward}
                    </span>
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className={`event-finale${finaleReady ? ' event-finale-ready' : ''}`}>
          <div className="event-finale-head">
            <span className="event-finale-icon" aria-hidden="true">
              🏆
            </span>
            <div>
              <h3 className="event-finale-title">{event.finale.title}</h3>
              <p className="event-finale-label">{event.finale.label}</p>
            </div>
          </div>
          {state.finaleClaimed ? (
            <span className="owned-badge">Получено</span>
          ) : (
            <Button
              tone={finaleReady ? 'primary' : 'secondary'}
              disabled={!finaleReady}
              onClick={() => {
                audio.tap();
                claimEventFinale();
              }}
            >
              {finaleReady ? '🏆 Забрать финал' : 'Выполните все задания'}
            </Button>
          )}
        </div>

        <footer className="map-footer">
          Событие идёт неделю, затем его сменяет следующее. Прогресс события не переносится:
          новая неделя — новые задания.
        </footer>
      </div>
    </div>
  );
}

/** `true` when the running event still has an uncollected reward. */
export function eventReadyToClaim(
  state: typeof EMPTY_EVENT_STATE,
  day: string,
): boolean {
  const event = eventForDay(day);
  if (!event) return false;
  const fresh = ensureEventState(state, day);
  return claimableEventTasks(fresh, event) > 0 || eventFinaleReady(fresh, event);
}
