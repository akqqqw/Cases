import { useEffect, useState } from 'react';
import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';
import { HomeScreen } from './HomeScreen';
import { LevelMap } from './LevelMap';
import { ShopScreen } from './ShopScreen';
import { DailyScreen } from './DailyScreen';
import { GiftScreen } from './GiftScreen';
import { MasterScreen } from './MasterScreen';
import { EventScreen } from './EventScreen';
import { LeaderboardScreen } from './LeaderboardScreen';
import { PauseOverlay, ResultOverlay, Toasts } from './Overlays';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';
import { markGameReady } from '../platform/boot';

type Screen = 'menu' | 'map' | 'shop' | 'daily' | 'gift' | 'master' | 'event' | 'board';

export function App(): React.ReactElement {
  const phase = useGameStore((state) => state.phase);
  const hydrated = useGameStore((state) => state.hydrated);
  const settings = useGameStore((state) => state.settings);
  const [screen, setScreen] = useState<Screen>('menu');

  const playing = phase !== 'menu';

  // Restore progress from IndexedDB once, on the first paint.
  useEffect(() => {
    void useGameStore.getState().hydrate();
  }, []);

  // Browsers only allow audio after a gesture — unlock on the first touch.
  useEffect(() => {
    const unlock = (): void => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    audio.applySettings(settings);
  }, [settings]);

  // Music pauses while the tab is in the background.
  useEffect(() => {
    const onVisibility = (): void => {
      if (document.hidden) audio.stopMusic();
      else if (useGameStore.getState().settings.music) audio.startMusic();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // A level may start from the map / menu, so always leave those screens.
  useEffect(() => {
    if (playing) setScreen('menu');
  }, [playing]);

  // The menu is interactive and no loading screen is left — the moment the
  // platform docs ask for `LoadingAPI.ready()`.
  useEffect(() => {
    if (hydrated && !playing) markGameReady();
  }, [hydrated, playing]);

  useEffect(() => {
    const prevent = (event: Event): void => event.preventDefault();
    document.addEventListener('gesturestart', prevent);
    document.addEventListener('dblclick', prevent);
    return () => {
      document.removeEventListener('gesturestart', prevent);
      document.removeEventListener('dblclick', prevent);
    };
  }, []);

  if (!hydrated) {
    return (
      <div className="app">
        <div className="screen boot-screen">
          <div className="boot-card">
            <div className="boot-shelf">
              <span className="boot-item" />
              <span className="boot-item" />
              <span className="boot-item" />
            </div>
            <p className="boot-text">Разложи по полкам</p>
            <p className="boot-sub">Загружаем полки…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <GameCanvas active={playing} />
      {playing ? <Hud /> : null}
      {!playing && screen === 'menu' ? (
        <HomeScreen
          onOpenMap={() => setScreen('map')}
          onOpenShop={() => setScreen('shop')}
          onOpenDaily={() => setScreen('daily')}
          onOpenGift={() => setScreen('gift')}
          onOpenMaster={() => setScreen('master')}
          onOpenEvent={() => setScreen('event')}
          onOpenBoard={() => setScreen('board')}
        />
      ) : null}
      {!playing && screen === 'map' ? <LevelMap onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'shop' ? <ShopScreen onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'daily' ? <DailyScreen onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'gift' ? <GiftScreen onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'master' ? <MasterScreen onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'event' ? <EventScreen onBack={() => setScreen('menu')} /> : null}
      {!playing && screen === 'board' ? <LeaderboardScreen onBack={() => setScreen('menu')} /> : null}
      <PauseOverlay />
      <ResultOverlay />
      <Toasts />
    </div>
  );
}
