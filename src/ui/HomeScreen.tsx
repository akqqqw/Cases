import { ItemTile } from './ItemIcon';
import { Button, CoinPill, IconButton, SoundIcon } from './components';
import { LEVELS, getLevel } from '../data/levels';
import { themeForLevel } from '../data/themes';
import { useGameStore } from '../store/gameStore';
import { claimableDailyCount } from './DailyScreen';
import { currentDayKey, resolveDay } from '../data/clock';
import { giftAvailable } from '../data/gift';
import { masterUnlocked } from '../data/master';
import { eventForDay, eventDaysLeft } from '../data/events';
import { eventReadyToClaim } from './EventScreen';
import { audio } from '../game/audio';
import { t, translateWorld } from '../platform/i18n';

const SHOWCASE = ['apple', 'bread', 'milk', 'cake', 'flower', 'robot', 'book', 'coffee'];

export interface HomeScreenProps {
  onOpenMap: () => void;
  onOpenShop: () => void;
  onOpenDaily: () => void;
  onOpenGift: () => void;
  onOpenMaster: () => void;
  onOpenEvent: () => void;
  onOpenBoard: () => void;
}

/** Main menu — play, current level, coins, level map and shop. */
export function HomeScreen({
  onOpenMap,
  onOpenShop,
  onOpenDaily,
  onOpenGift,
  onOpenMaster,
  onOpenEvent,
  onOpenBoard,
}: HomeScreenProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const settings = useGameStore((state) => state.settings);
  const daily = useGameStore((state) => state.daily);
  const events = useGameStore((state) => state.events);
  const setSettings = useGameStore((state) => state.setSettings);
  const startLevel = useGameStore((state) => state.startLevel);

  const current = getLevel(progress.unlockedLevel) ?? LEVELS[0];
  const totalStars = Object.values(progress.levelStars).reduce((sum, stars) => sum + stars, 0);
  const levelId = current?.id ?? 1;
  const cleared = Object.keys(progress.levelStars).length;
  const world = themeForLevel(levelId);
  // The game clock decides the day; it never moves backwards (see `resolveDay`).
  const today = resolveDay(progress.lastSeenDay, currentDayKey());
  const claimable = claimableDailyCount(daily.date, daily.counts, daily.claimed, today);
  const giftReady = giftAvailable(progress.dailyStreak, today);
  const masterReady = masterUnlocked(progress.levelStars);
  const event = eventForDay(today);
  const eventLeft = eventDaysLeft(today);
  const eventClaimable = eventReadyToClaim(events, today);

  const play = (): void => {
    audio.unlock();
    audio.tap();
    startLevel(levelId);
  };

  /** Opening a section: the same gesture as the menu, one note lower. */
  const open = (go: () => void) => (): void => {
    audio.unlock();
    audio.uiOpen();
    go();
  };

  return (
    <div className="screen menu-screen">
      <div className="menu-glow" aria-hidden="true" />

      <header className="menu-header">
        <div className="menu-stats">
          <CoinPill coins={progress.coins} />
          <div className="stat-pill" title={t('menu.stars')}>
            <span className="stat-star" aria-hidden="true">
              ★
            </span>
            <span>{totalStars}</span>
          </div>
          <IconButton
            title={settings.music ? t('hud.musicOn') : t('hud.musicOff')}
            onClick={() => {
              audio.unlock();
              setSettings({ music: !settings.music });
            }}
          >
            <span className="music-glyph" aria-hidden="true">
              {settings.music ? '♫' : '♪̶'}
            </span>
          </IconButton>
          <IconButton
            title={settings.sound ? t('hud.soundOn') : t('hud.soundOff')}
            onClick={() => {
              audio.unlock();
              setSettings({ sound: !settings.sound });
            }}
          >
            <SoundIcon on={settings.sound} />
          </IconButton>
        </div>
      </header>

      <div className="menu-body">
        {event ? (
          <button
            type="button"
            className={`menu-event${eventClaimable ? ' menu-event-ready' : ''}`}
            style={{ ['--event-accent' as string]: event.accent }}
            onClick={onOpenEvent}
          >
            <span className="menu-event-icon" aria-hidden="true">
              {event.icon}
            </span>
            <span className="menu-event-body">
              <b>{event.name}</b>
              <span>
                {event.tagline} ·{' '}
                {eventLeft === 1 ? t('menu.eventLastDay') : t('menu.eventDays', { n: eventLeft })}
              </span>
            </span>
            {eventClaimable ? <span className="menu-event-badge">!</span> : null}
          </button>
        ) : null}

        <h1 className="menu-title">
          {t('menu.title1')}
          <span>{t('menu.title2')}</span>
        </h1>
        <p className="menu-subtitle">{t('menu.subtitle')}</p>

        <div className="menu-shelf" aria-hidden="true">
          <div className="menu-shelf-items">
            {SHOWCASE.map((id, index) => (
              <div className="menu-shelf-item" key={id} style={{ animationDelay: `${index * 90}ms` }}>
                <ItemTile id={id} size={54} />
              </div>
            ))}
          </div>
          <div className="menu-shelf-plank" />
        </div>

        <div className="menu-actions">
          <Button size="lg" onClick={play}>
            {t('menu.play')}
          </Button>
          <div className="menu-level-hint">
            {t('menu.levelInfo', {
              id: levelId,
              total: LEVELS.length,
              world: translateWorld(world.name),
              done: cleared,
            })}
          </div>
        </div>

        <div className="menu-secondary">
          <Button tone="ghost" onClick={open(onOpenMap)}>
            {t('menu.map')}
          </Button>
          <Button tone="ghost" onClick={open(onOpenShop)}>
            {t('menu.shop')}
          </Button>
          <Button tone="ghost" onClick={open(onOpenGift)} badge={giftReady ? '!' : undefined}>
            {t('menu.gift')}
          </Button>
          <Button tone="ghost" onClick={open(onOpenDaily)} badge={claimable > 0 ? claimable : undefined}>
            {t('menu.daily')}
          </Button>
          <Button tone="ghost" onClick={open(onOpenMaster)} badge={masterReady ? undefined : '🔒'}>
            {t('menu.master')}
          </Button>
          <Button tone="ghost" onClick={open(onOpenBoard)}>
            {t('lb.menu')}
          </Button>
        </div>
      </div>

      <footer className="menu-footer">{t('menu.footer')}</footer>
    </div>
  );
}
