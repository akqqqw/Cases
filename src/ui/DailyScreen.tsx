import { useEffect, useMemo, useState } from 'react';
import { Button, CoinPill, IconButton } from './components';
import { ItemIcon } from './ItemIcon';
import { METRIC_LABELS, formatCountdown, pickDailyTasks, type DailyMetric } from '../data/dailies';
import { currentDayKey, msUntilTomorrow, resolveDay } from '../data/clock';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';

export interface DailyScreenProps {
  onBack: () => void;
}

/** Daily tasks: three goals that refresh every day and pay coins. */
export function DailyScreen({ onBack }: DailyScreenProps): React.ReactElement {
  const daily = useGameStore((state) => state.daily);
  const progress = useGameStore((state) => state.progress);
  const streak = progress.dailyStreak;
  const claimDaily = useGameStore((state) => state.claimDaily);
  const [remaining, setRemaining] = useState(() => msUntilTomorrow());
  const [tick, setTick] = useState(() => currentDayKey());

  // The day comes from the game clock and can never move backwards, so the
  // tasks match the ones the store counts (see `resolveDay`).
  const today = useMemo(() => resolveDay(progress.lastSeenDay, tick), [progress.lastSeenDay, tick]);
  const tasks = useMemo(() => pickDailyTasks(today), [today]);

  // The app can stay open across midnight: once the day flips, yesterday's
  // counters are shown as empty (the store itself rolls over on the next move).
  const counts: Record<DailyMetric, number> =
    daily.date === today ? daily.counts : { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 };
  const claimed = daily.date === today ? daily.claimed : [];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(msUntilTomorrow());
      setTick(currentDayKey());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="screen daily-screen">
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
        <h2 className="screen-title">Задания дня</h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <p className="daily-hint">
        Три задания каждый день, награда — монеты. Обновятся через {formatCountdown(remaining)}.
      </p>

      <div className="daily-streak">
        <span className="streak-flame" aria-hidden="true">
          🔥
        </span>
        {streak.days > 0 ? (
          <span>
            Серия: <b>{streak.days}</b> {streak.days === 1 ? 'день' : 'дн.'} подряд · бонус за серию до +50 монет
          </span>
        ) : (
          <span>Забери первую награду сегодня — и серия начнётся</span>
        )}
      </div>

      <div className="daily-scroll">
        {tasks.map((task) => {
          const value = counts[task.metric] ?? 0;
          const done = value >= task.target;
          const prizeTaken = claimed.includes(task.id);
          const ratio = Math.min(1, value / task.target);

          return (
            <article className={`daily-card${done ? ' daily-card-done' : ''}${prizeTaken ? ' daily-card-claimed' : ''}`} key={task.id}>
              <div className="daily-icon">
                <ItemIcon id={task.icon} size={52} tile />
              </div>

              <div className="daily-body">
                <h3 className="daily-title">{task.title}</h3>
                <div className="daily-progress">
                  <div className="daily-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
                  <span className="daily-progress-label">
                    {Math.min(value, task.target)}/{task.target} {METRIC_LABELS[task.metric]}
                  </span>
                </div>
              </div>

              <div className="daily-action">
                {prizeTaken ? (
                  <span className="owned-badge">Получено</span>
                ) : (
                  <Button tone={done ? 'primary' : 'secondary'} size="sm" disabled={!done} onClick={() => claimDaily(task.id)}>
                    <span className="price-tag">
                      <span className="coin-icon" aria-hidden="true" />
                      {task.reward}
                    </span>
                  </Button>
                )}
              </div>
            </article>
          );
        })}

        <footer className="map-footer">
          Задания общие для всех игроков и меняются каждый день.
        </footer>
      </div>
    </div>
  );
}

/** How many rewards are ready to collect right now. */
export function claimableDailyCount(
  date: string,
  counts: Record<string, number>,
  claimed: string[],
  today: string = currentDayKey(),
): number {
  const fresh = date === today;
  return pickDailyTasks(today).filter(
    (task) => fresh && (counts[task.metric] ?? 0) >= task.target && !claimed.includes(task.id),
  ).length;
}
