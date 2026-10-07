import { useEffect, useMemo, useState } from 'react';
import { Button, CoinPill, IconButton } from './components';
import { ItemIcon } from './ItemIcon';
import { formatCountdown } from '../data/dailies';
import { currentDayKey, msUntilTomorrow, resolveDay } from '../data/clock';
import { DAILY_GIFTS, GIFT_CYCLE_DAYS, giftBoosterLines, giftCalendar } from '../data/gift';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';

export interface GiftScreenProps {
  onBack: () => void;
}

/**
 * Daily gift: a seven day calendar. Coming back every day collects the next
 * cell, the reward grows with the streak, a missed day restarts the calendar.
 * The day itself comes from the game clock, so the screen also follows a
 * server time source once the SDK provides one.
 */
export function GiftScreen({ onBack }: GiftScreenProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const claimDailyGift = useGameStore((state) => state.claimDailyGift);
  const [remaining, setRemaining] = useState(() => msUntilTomorrow());
  const [tick, setTick] = useState(() => currentDayKey());

  // The screen can stay open across midnight — refresh the countdown and the day.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemaining(msUntilTomorrow());
      setTick(currentDayKey());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const day = useMemo(() => resolveDay(progress.lastSeenDay, tick), [progress.lastSeenDay, tick]);
  const calendar = useMemo(() => giftCalendar(progress.dailyStreak, day), [progress.dailyStreak, day]);
  const { canClaim, cycleDay, gift, streak, tomorrow } = calendar;

  return (
    <div className="screen gift-screen">
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
        <h2 className="screen-title">Подарок дня</h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <p className="gift-hint">
        Заходи каждый день — подарок растёт. Пропустишь день, и календарь начнётся заново.
      </p>

      <div className={`gift-streak${canClaim ? ' gift-streak-ready' : ''}`}>
        <span className="streak-flame" aria-hidden="true">
          🔥
        </span>
        {streak.days > 0 ? (
          <span>
            Серия: <b>{streak.days}</b> {streak.days === 1 ? 'день' : 'дн.'} подряд · день{' '}
            <b>
              {cycleDay}/{GIFT_CYCLE_DAYS}
            </b>{' '}
            календаря
          </span>
        ) : (
          <span>Забери первый подарок — и серия начнётся</span>
        )}
      </div>

      <div className="gift-scroll">
        <div className="gift-grid">
          {DAILY_GIFTS.map((cell) => {
            const taken = cell.day < cycleDay || (cell.day === cycleDay && !canClaim);
            const today = cell.day === cycleDay;
            const lines = giftBoosterLines(cell);
            const state = today ? (canClaim ? 'today' : 'taken') : taken ? 'taken' : 'future';

            return (
              <article className={`gift-cell gift-cell-${state}`} key={cell.day} data-day={cell.day}>
                <span className="gift-day">День {cell.day}</span>
                <div className="gift-icon">
                  <ItemIcon id={cell.icon} size={40} tile />
                </div>
                <span className="gift-coins">
                  <span className="coin-icon" aria-hidden="true" />
                  {cell.coins}
                </span>
                {lines.length > 0 ? (
                  <span className="gift-boosters" title={lines.map((line) => line.title).join(', ')}>
                    {lines.map((line) => (
                      <span className="gift-booster" key={line.id}>
                        {line.icon}
                        {line.count > 1 ? <b>{line.count}</b> : null}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="gift-note">{state === 'taken' ? 'Получено' : cell.note}</span>
              </article>
            );
          })}
        </div>

        <div className="gift-claim">
          {canClaim ? (
            <>
              <div className="gift-claim-prize">
                День {cycleDay}: <b>{gift.label}</b>
              </div>
              <Button size="lg" onClick={() => claimDailyGift()}>
                🎁 Забрать подарок
              </Button>
            </>
          ) : (
            <>
              <div className="gift-claim-prize">
                Подарок получен · следующий через <b>{formatCountdown(remaining)}</b>
              </div>
              <Button size="lg" tone="secondary" disabled>
                🎁 Забрать подарок
              </Button>
              <div className="gift-claim-next">
                {cycleDay >= GIFT_CYCLE_DAYS ? (
                  <>Завтра календарь начнётся заново — снова день 1: {tomorrow.label}.</>
                ) : (
                  <>Завтра вас ждёт день {cycleDay + 1}: {tomorrow.label}.</>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="map-footer">
          Серия не сгорает, пока вы заходите каждый день. Полный круг — {GIFT_CYCLE_DAYS} дней, дальше
          календарь повторяется с растущей наградой.
        </footer>
      </div>
    </div>
  );
}
