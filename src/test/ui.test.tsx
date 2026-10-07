// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeScreen } from '../ui/HomeScreen';
import { LevelMap } from '../ui/LevelMap';
import { ShopScreen } from '../ui/ShopScreen';
import { DailyScreen } from '../ui/DailyScreen';
import { GiftScreen } from '../ui/GiftScreen';
import { MasterScreen } from '../ui/MasterScreen';
import { EventScreen, daysLeftLabel, eventReadyToClaim } from '../ui/EventScreen';
import { Hud } from '../ui/Hud';
import { PauseOverlay, ResultOverlay, Toasts } from '../ui/Overlays';
import { ItemIcon, ItemTile } from '../ui/ItemIcon';
import { ITEM_IDS } from '../data/items';
import { dailyKey, pickDailyTasks, todayKey } from '../data/dailies';
import { DAILY_GIFTS, GIFT_CYCLE_DAYS, giftForDay } from '../data/gift';
import { currentDayKey } from '../data/clock';
import { LEVELS } from '../data/levels';
import { findHint } from '../core/solver';
import { createLevelRuntime } from '../game/levelRuntime';
import { MAX_UPGRADE_LEVEL, UPGRADE_TRACKS } from '../data/upgrades';
import { CAMPAIGN_SIZE } from '../data/levels/campaign';
import { MASTER_LEVEL_IDS, MASTER_RANKS, masterIdFor, masterModifiersFor } from '../data/master';
import {
  EMPTY_EVENT_STATE,
  emptyEventState,
  eventForDay,
  eventTaskViews,
  type GameEvent,
} from '../data/events';
import { useGameStore } from '../store/gameStore';
import { setLang } from '../platform/i18n';
import { audio } from '../game/audio';
import { LeaderboardScreen } from '../ui/LeaderboardScreen';
import { initLeaderboards, resetLeaderboards, publishScores } from '../platform/leaderboards';
import { MOCK_PREVIEW_PRODUCTS, createMockSdk, type MockSdk } from '../platform/mock';
import { initPurchases, resetPurchases } from '../platform/purchases';
import { initPlatform, resetPlatform } from '../platform/yandex';
import { weekKeyFor } from '../data/weeks';

declare global {
  // React needs this flag to allow `act()` outside of its own test renderer.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const noop = (): void => undefined;

/** A win result of the shape the store builds (used by the ad tests). */
function wonOutcome(coins: number) {
  return {
    status: 'won' as const,
    stars: 3,
    coins,
    base: coins,
    movesUsed: 8,
    matches: 8,
    comboCoins: 0,
    goldenCoins: 0,
    clean: true,
    movesLeft: 4,
    rewards: [],
    comboBest: 0,
    boostersUsed: 0,
    leftovers: 0,
    golden: 0,
    bombs: 0,
    starTitle: '',
    mastery: undefined,
  };
}

/** Puts a given amount into the wallet of the current fixture. */
function setCoins(coins: number): void {
  useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins } });
}

let container: HTMLDivElement;
let root: Root;

/**
 * Real DOM render of a screen. This is the browser-less integration test for the
 * React layer: it mounts the component, so store subscriptions, effects and
 * click handlers behave exactly like in the game.
 */
function mount(element: ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(element);
  });
  return container;
}

function click(element: Element | null): void {
  if (!element) throw new Error('cannot click a missing element');
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(text)) ?? null
  ) as HTMLButtonElement | null;
}

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

beforeEach(() => {
  useGameStore.setState({
    phase: 'menu',
    runtime: null,
    hint: null,
    outcome: null,
    toast: null,
    hydrated: true,
    progress: {
      coins: 120,
      levelStars: {},
      unlockedLevel: 1,
      owned: ['decor-cozy'],
      activeDecor: 'decor-cozy',
      dailyStreak: { days: 0, lastDay: '' },
      lastSeenDay: '',
      boosters: { hammer: 2, shuffle: 2, extraMove: 1, undo: 2 },
      upgrades: {},
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: '', coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
    },
  });
});

describe('product icons', () => {
  it('render every product as valid svg', () => {
    for (const id of ITEM_IDS) {
      const host = mount(<ItemIcon id={id} size={40} />);
      const svg = host.querySelector('svg');
      expect(svg, `${id} renders an svg`).toBeTruthy();
      expect(svg?.innerHTML.length).toBeGreaterThan(40);
      expect(host.innerHTML).not.toContain('NaN');
      expect(host.innerHTML).not.toContain('undefined');
    }
  });

  it('draw a tile background and ignore unknown products', () => {
    expect(mount(<ItemTile id="apple" />).querySelectorAll('rect').length).toBeGreaterThan(1);
    expect(mount(<ItemIcon id="not-a-product" />).innerHTML).toBe('');
  });
});

describe('menu screen', () => {
  it('shows coins, progress and both navigation buttons', () => {
    const host = mount(<HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />);
    const text = host.textContent ?? '';

    expect(text).toContain('Разложи');
    expect(text).toContain('Играть');
    expect(text).toContain('Карта уровней');
    expect(text).toContain('Магазин');
    expect(text).toContain('120'); // coins
    expect(text).toContain(`Уровень 1 из ${LEVELS.length}`);
  });

  it('announces the sections and the level with their own sounds', () => {
    // Sound is synthesised, so the check is that the gesture is routed: the
    // menu buttons play the opening cue before they navigate.
    const calls: string[] = [];
    const original = { uiOpen: audio.uiOpen, levelStart: audio.levelStart };
    act(() => {
      audio.uiOpen = () => calls.push('open');
      audio.levelStart = () => calls.push('level');
    });

    try {
      let opened = '';
      const host = mount(
        <HomeScreen
          onOpenMap={() => (opened = 'map')}
          onOpenShop={noop}
          onOpenDaily={noop}
          onOpenGift={noop}
          onOpenMaster={noop}
          onOpenEvent={noop}
          onOpenBoard={noop}
        />,
      );
      click(buttonByText(host, 'Карта уровней'));
      expect(opened).toBe('map');
      expect(calls).toEqual(['open']);

      // «Играть» goes through the level-start cue.
      act(() => useGameStore.getState().startLevel(1));
      expect(calls).toContain('level');
      expect(useGameStore.getState().phase).toBe('playing');
    } finally {
      act(() => {
        audio.uiOpen = original.uiOpen;
        audio.levelStart = original.levelStart;
      });
    }
  });

  it('starts the current level when "Играть" is pressed', () => {
    const host = mount(<HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />);
    click(buttonByText(host, 'Играть'));

    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    expect(state.runtime?.config.id).toBe(1);
  });

  it('points at the next unplayed level of the right theme', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, unlockedLevel: 27, levelStars: { 1: 3, 2: 2 } },
    });
    const host = mount(<HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />);
    expect(host.textContent).toContain('Уровень 27 из 60');
    expect(host.textContent).toContain('Игрушки');
  });

  it('switches the background music from the menu', () => {
    const host = mount(<HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />);
    expect(useGameStore.getState().settings.music).toBe(true);

    const toggle = host.querySelector('button[title="Выключить музыку"]');
    click(toggle);
    expect(useGameStore.getState().settings.music).toBe(false);

    click(host.querySelector('button[title="Включить музыку"]'));
    expect(useGameStore.getState().settings.music).toBe(true);
  });

  it('opens the daily tasks through the callback', () => {
    let opened = '';
    const host = mount(
      <HomeScreen
        onOpenMap={noop}
        onOpenShop={noop}
        onOpenDaily={() => (opened = 'daily')}
        onOpenGift={() => (opened = 'gift')}
        onOpenMaster={() => (opened = 'master')}
        onOpenEvent={() => (opened = 'event')}
        onOpenBoard={() => {}}
      />,
    );
    click(buttonByText(host, 'Задания'));
    expect(opened).toBe('daily');
    click(buttonByText(host, 'Подарок'));
    expect(opened).toBe('gift');
  });

  it('badges the gift button while the gift is uncollected', () => {
    const host = mount(
      <HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />,
    );
    const giftButton = () => buttonByText(host, 'Подарок');
    expect(giftButton()?.querySelector('.btn-badge')?.textContent).toBe('!');

    act(() => {
      useGameStore.setState({
        progress: {
          ...useGameStore.getState().progress,
          dailyStreak: { days: 2, lastDay: currentDayKey() },
        },
      });
    });
    expect(giftButton()?.querySelector('.btn-badge')).toBeNull();
  });

  it('opens the map and the shop through the callbacks', () => {
    let opened = '';
    const host = mount(
      <HomeScreen
        onOpenMap={() => (opened = 'map')}
        onOpenShop={() => (opened = 'shop')}
        onOpenDaily={() => (opened = 'daily')}
        onOpenGift={() => (opened = 'gift')}
        onOpenMaster={() => (opened = 'master')}
        onOpenEvent={() => (opened = 'event')}
        onOpenBoard={() => {}}
      />,
    );
    click(buttonByText(host, 'Карта уровней'));
    expect(opened).toBe('map');
    click(buttonByText(host, 'Магазин'));
    expect(opened).toBe('shop');
  });
});

describe('level map', () => {
  it('lists the worlds, the stars and the locks', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, unlockedLevel: 10, levelStars: { 1: 3, 2: 2 } },
    });
    const host = mount(<LevelMap onBack={noop} />);
    const text = host.textContent ?? '';

    expect(text).toContain('Карта уровней');
    expect(text).toContain('Пройдено');
    expect(text).toContain('Продукты');
    expect(text).toContain('Сладкое');
    expect(host.querySelectorAll('.star-filled')).toHaveLength(5); // 3 + 2 stars
    expect(host.querySelectorAll('.level-tile-locked').length).toBeGreaterThan(40);
    expect(host.querySelectorAll('.level-tile-current')).toHaveLength(1);
    expect(host.querySelectorAll('.level-tile')).toHaveLength(LEVELS.length);
  });

  it('starts a level from its tile', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, unlockedLevel: 12, levelStars: { 1: 3 } },
    });
    const host = mount(<LevelMap onBack={noop} />);
    const tiles = [...host.querySelectorAll<HTMLButtonElement>('.level-tile')];
    const tile = tiles.find((element) => element.textContent?.includes('12'));

    click(tile ?? null);
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState().runtime?.config.id).toBe(12);
  });

  it('keeps locked levels unplayable', () => {
    const host = mount(<LevelMap onBack={noop} />);
    const locked = [...host.querySelectorAll<HTMLButtonElement>('.level-tile-locked')];
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((element) => element.disabled)).toBe(true);

    click(locked[0] ?? null);
    expect(useGameStore.getState().phase).toBe('menu');
    expect(useGameStore.getState().runtime).toBeNull();
  });

  it('marks the levels that bring bombs, ice or golden triples', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, unlockedLevel: 60, levelStars: {} },
    });
    const host = mount(<LevelMap onBack={noop} />);
    const marked = [...host.querySelectorAll('.level-tile-marks')].map((element) => element.textContent);
    expect(marked.filter((text) => text?.includes('💥')).length).toBeGreaterThan(0);
    expect(marked.filter((text) => text?.includes('❄')).length).toBeGreaterThan(0);
    expect(marked.filter((text) => text?.includes('★')).length).toBeGreaterThan(0);
  });

  it('celebrates a finished campaign', () => {
    const allStars = Object.fromEntries(LEVELS.map((level) => [level.id, 3]));
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, unlockedLevel: 60, levelStars: allStars },
    });
    expect(mount(<LevelMap onBack={noop} />).textContent).toContain('Все уровни пройдены');
  });
});

describe('shop screen', () => {
  it('offers the voluntary rewarded videos with their daily quota', () => {
    const calls: string[] = [];
    const original = {
      watchAdForCoins: useGameStore.getState().watchAdForCoins,
      watchAdForBooster: useGameStore.getState().watchAdForBooster,
    };
    act(() => {
      useGameStore.setState({
        watchAdForCoins: () => calls.push('coins'),
        watchAdForBooster: () => calls.push('booster'),
        ads: {
          available: true,
          showing: false,
          kind: null,
          placement: null,
          interstitials: 0,
          rewarded: 0,
          lastInterstitialAt: null,
          levelsSinceInterstitial: 0,
          banner: { managed: false, showing: false, reason: null, supported: false },
          last: null,
        },
        progress: {
          ...useGameStore.getState().progress,
          adReward: { day: currentDayKey(), coins: 1, boosters: 0 },
          weeks: { key: '', stars: 0, best: 0 },
        },
      });
    });

    try {
      const host = mount(<ShopScreen onBack={noop} />);
      click(buttonByText(host, 'Развитие'));
      const text = host.textContent ?? '';

      expect(text).toContain('За просмотр рекламы');
      expect(text).toContain('+60 монет');
      expect(text).toContain('осталось сегодня: 2 из 3');
      expect(text).toContain('Случайный бустер');
      expect(text).toContain('осталось сегодня: 1 из 1');

      const watchButtons = [...host.querySelectorAll('.ad-card .ad-watch')];
      expect(watchButtons).toHaveLength(2);
      click(watchButtons[0] ?? null);
      expect(calls).toEqual(['coins']);

      // When the quota is spent the button says so and does nothing.
      act(() =>
        useGameStore.setState({
          progress: {
            ...useGameStore.getState().progress,
            adReward: { day: currentDayKey(), coins: 3, boosters: 1 },
            weeks: { key: '', stars: 0, best: 0 },
          },
        }),
      );
      const spent = mount(<ShopScreen onBack={noop} />);
      click(buttonByText(spent, 'Развитие'));
      expect(spent.textContent).toContain('На сегодня всё');
      click(spent.querySelector('.ad-card .ad-watch'));
      expect(calls).toEqual(['coins']);
    } finally {
      act(() => useGameStore.setState(original));
    }
  });

  it('lists departments with prices and level requirements', () => {
    const host = mount(<ShopScreen onBack={noop} />);
    const text = host.textContent ?? '';

    expect(text).toContain('Магазин');
    expect(text).toContain('Отдел «Сладкое»');
    expect(text).toContain('220');
    expect(text).toContain('Откроется на уровне'); // locked purchases stay visible
    expect(text).toContain('Бонусы');
  });

  it('switches tabs and shows the other catalogues', () => {
    const host = mount(<ShopScreen onBack={noop} />);
    click(buttonByText(host, 'Оформление'));
    expect(host.textContent).toContain('Оформление «Мята»');

    click(buttonByText(host, 'Наборы'));
    expect(host.textContent).toContain('Набор «Пекарня»');
    expect(host.textContent).not.toContain('Отдел «Сладкое»');
  });

  it('buys an item and reflects it in the shop and the wallet', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 500, unlockedLevel: 20 },
    });
    const host = mount(<ShopScreen onBack={noop} />);

    const card = [...host.querySelectorAll('.shop-card')].find((element) =>
      element.textContent?.includes('Отдел «Сладкое»'),
    );
    click(card?.querySelector('button') ?? null);

    const state = useGameStore.getState();
    expect(state.progress.owned).toContain('dept-sweets');
    expect(state.progress.coins).toBe(280);
    expect(host.textContent).toContain('Куплено');
    expect(host.textContent).toContain('+1 подсказка');
  });

  it('refuses to buy without enough coins', () => {
    const host = mount(<ShopScreen onBack={noop} />);
    click(buttonByText(host, 'Наборы'));

    // 120 coins in the wallet, the "Пекарня" set costs 140
    const card = [...host.querySelectorAll('.shop-card')].find((element) =>
      element.textContent?.includes('Набор «Пекарня»'),
    );
    expect(card).toBeTruthy();

    const buyButton = card?.querySelector('button') ?? null;
    expect(buyButton?.disabled).toBe(true);
    click(buyButton);

    expect(useGameStore.getState().progress.owned).not.toContain('set-bakery');
    expect(useGameStore.getState().progress.coins).toBe(120);
  });

  it('applies an owned interior', () => {
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        coins: 500,
        unlockedLevel: 20,
        owned: ['decor-cozy', 'decor-mint'],
      },
    });
    const host = mount(<ShopScreen onBack={noop} />);
    click(buttonByText(host, 'Оформление'));

    const card = [...host.querySelectorAll('.shop-card')].find((element) =>
      element.textContent?.includes('Оформление «Мята»'),
    );
    click(card?.querySelector('button') ?? null);

    expect(useGameStore.getState().progress.activeDecor).toBe('decor-mint');
    expect(card?.textContent).toContain('Активно');
  });
});

describe('in-game HUD', () => {
  it('shows the level, the moves, the goal chips and the action buttons', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);
    const text = host.textContent ?? '';

    expect(text).toContain('Уровень 1');
    expect(text).toContain('ходов');
    expect(text).toContain('Подсказка');
    expect(text).toContain('Отмена');
    expect(host.querySelectorAll('.goal-chip').length).toBe(Object.keys(useGameStore.getState().runtime!.goal.targets).length);
    expect(host.querySelector('.moves-value')?.textContent).toBe(String(useGameStore.getState().runtime?.moveLimit));
  });

  it('renders nothing without an active level', () => {
    expect(mount(<Hud />).innerHTML).toBe('');
  });

  it('spends a hint and marks the tiles on the board', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);
    click(buttonByText(host, 'Подсказка'));

    const state = useGameStore.getState();
    expect(state.hint).not.toBeNull();
    expect(state.runtime?.hintsLeft).toBe(2);
    expect(state.runtime?.movesLeft).toBe(state.runtime?.moveLimit);
  });

  it('undisables undo once a move was played', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);
    const undo = buttonByText(host, 'Отмена');
    expect(undo?.disabled).toBe(true);

    const runtime = useGameStore.getState().runtime!;
    const from = runtime.board.cells.findIndex((cell) => cell.uid !== null && !cell.locked);
    const to = runtime.board.cells.findIndex((cell) => cell.uid === null && !cell.locked);
    act(() => {
      useGameStore.getState().requestMove(from, to);
    });

    expect(buttonByText(host, 'Отмена')?.disabled).toBe(false);
    click(buttonByText(host, 'Отмена'));
    expect(useGameStore.getState().runtime?.undosLeft).toBe(2);
    expect(useGameStore.getState().runtime?.history).toHaveLength(0);
  });

  it('shows only the target products on goal levels', () => {
    const goalLevel = LEVELS.find((level) => level.goal.kind === 'clearTypes')!;
    act(() => useGameStore.getState().startLevel(goalLevel.id));
    const runtime = useGameStore.getState().runtime!;
    const host = mount(<Hud />);

    expect(host.textContent).toContain(`Уровень ${goalLevel.id}`);
    expect(host.querySelectorAll('.goal-chip').length).toBe(Object.keys(runtime.goal.targets).length);
    expect(host.querySelectorAll('.goal-chip').length).toBeLessThan(
      new Set(runtime.board.cells.map((cell) => cell.type).filter(Boolean)).size,
    );
  });

  it('switches the sound from the HUD', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);
    click(host.querySelector('button[title*="звук"]'));
    expect(useGameStore.getState().settings.sound).toBe(false);
  });
});

describe('overlays', () => {
  it('shows the cloud save status and syncs on demand', () => {
    const calls: string[] = [];
    const original = {
      syncCloud: useGameStore.getState().syncCloud,
      authorizeCloud: useGameStore.getState().authorizeCloud,
    };
    act(() => {
      useGameStore.setState({
        syncCloud: () => calls.push('sync'),
        authorizeCloud: () => calls.push('authorize'),
      });
    });

    try {
      // A plain web build: the cloud is simply not there.
      act(() => useGameStore.getState().startLevel(1));
      act(() => useGameStore.getState().pause());
      act(() =>
        useGameStore.setState({
          cloud: {
            available: false,
            phase: 'disabled',
            authorized: false,
            guest: true,
            playerId: null,
            playerName: null,
            lastSyncAt: null,
            dirty: false,
            reason: null,
            cloudSavedAt: null,
          },
        }),
      );

      let host = mount(<PauseOverlay />);
      expect(host.textContent).toContain('Облачное сохранение');
      expect(host.textContent).toContain('Облако только в Яндекс Играх');
      expect(host.querySelector('.cloud-dot-off')).toBeTruthy();
      expect(buttonByText(host, 'Синхронизировать')).toBeNull();
      expect(buttonByText(host, 'Войти в Яндекс')).toBeNull();

      // Inside Yandex Games as a guest: both actions are offered.
      act(() =>
        useGameStore.setState({
          cloud: {
            available: true,
            phase: 'synced',
            authorized: false,
            guest: true,
            playerId: 'guest-1',
            playerName: null,
            lastSyncAt: Date.now(),
            dirty: false,
            reason: 'no-cloud',
            cloudSavedAt: Date.now(),
          },
        }),
      );
      host = mount(<PauseOverlay />);
      expect(host.querySelector('.cloud-dot-ok')).toBeTruthy();
      click(buttonByText(host, 'Синхронизировать'));
      click(buttonByText(host, 'Войти в Яндекс'));
      expect(calls).toEqual(['sync', 'authorize']);

      // Pending changes turn the dot yellow.
      act(() => useGameStore.setState({ cloud: { ...useGameStore.getState().cloud, dirty: true } }));
      host = mount(<PauseOverlay />);
      expect(host.querySelector('.cloud-dot-wait')).toBeTruthy();
      expect(host.textContent).toContain('Есть несохранённые изменения');
    } finally {
      act(() => useGameStore.setState(original));
    }
  });

  it('translates the cloud card in the English interface', () => {
    setLang('en', 'platform');
    try {
      act(() => useGameStore.getState().startLevel(1));
      act(() => useGameStore.getState().pause());
      act(() =>
        useGameStore.setState({
          cloud: {
            available: true,
            phase: 'pushed',
            authorized: true,
            guest: false,
            playerId: 'p1',
            playerName: 'Игрок',
            lastSyncAt: Date.now(),
            dirty: false,
            reason: 'no-cloud',
            cloudSavedAt: Date.now(),
          },
        }),
      );
      const host = mount(<PauseOverlay />);
      expect(host.textContent).toContain('Cloud save');
      expect(host.textContent).toContain('Sync now');
      expect(host.textContent).toContain('just now');
      expect(buttonByText(host, 'Sign in to Yandex')).toBeNull();
    } finally {
      setLang('ru', 'default');
    }
  });

  it('hides the pause and result panels while playing', () => {
    act(() => useGameStore.getState().startLevel(1));
    expect(mount(<PauseOverlay />).innerHTML).toBe('');
    expect(mount(<ResultOverlay />).innerHTML).toBe('');
  });

  it('greets the player with the level tip when the level starts', () => {
    act(() => useGameStore.getState().startLevel(1));
    const tip = mount(<Toasts />);
    expect(tip.textContent).toContain('три одинаковых');

    act(() => useGameStore.getState().dismissToast());
    expect(mount(<Toasts />).innerHTML).toBe('');
  });

  it('pauses and resumes from the pause panel', () => {
    act(() => useGameStore.getState().startLevel(1));
    act(() => useGameStore.getState().pause());
    const host = mount(<PauseOverlay />);
    expect(host.textContent).toContain('Пауза');
    expect(host.textContent).toContain('Громкость');

    click(buttonByText(host, 'Продолжить'));
    expect(useGameStore.getState().phase).toBe('playing');
  });

  it('explains the leftovers of a boosted run', () => {
    act(() => useGameStore.getState().startLevel(1));
    const runtime = useGameStore.getState().runtime!;
    const index = runtime.board.cells.findIndex((cell) => cell.uid !== null);
    act(() => {
      useGameStore.getState().useBooster('hammer', index);
    });

    // hammer the level to the end so the leftovers survive into the result
    let guard = 0;
    while (useGameStore.getState().phase === 'playing' && guard < 60) {
      guard += 1;
      const current = useGameStore.getState().runtime!;
      const hint = findHint(current.board, { goal: current.goal });
      if (!hint) break;
      act(() => {
        useGameStore.getState().requestMove(hint.from, hint.to);
      });
    }

    const outcome = useGameStore.getState().outcome!;
    expect(outcome.status).toBe('won');
    expect(outcome.leftovers).toBeGreaterThan(0);
    expect(outcome.boostersUsed).toBe(1);
    expect(outcome.clean).toBe(false);

    const host = mount(<ResultOverlay />);
    expect(host.textContent).toContain('Бустеров использовано: 1');
    expect(host.textContent).toContain('цель засчитана');
  });

  it('restarts the level from the pause panel', () => {
    act(() => useGameStore.getState().startLevel(1));
    const runtime = useGameStore.getState().runtime!;
    const from = runtime.board.cells.findIndex((cell) => cell.uid !== null && !cell.locked);
    const to = runtime.board.cells.findIndex((cell) => cell.uid === null && !cell.locked);
    act(() => useGameStore.getState().requestMove(from, to));
    act(() => useGameStore.getState().pause());

    const host = mount(<PauseOverlay />);
    click(buttonByText(host, 'Заново'));
    expect(useGameStore.getState().runtime?.movesLeft).toBe(useGameStore.getState().runtime?.moveLimit);
    expect(useGameStore.getState().runtime?.history).toHaveLength(0);
  });

  it('shows the win panel with stars, reward and golden note', () => {
    act(() => useGameStore.getState().startLevel(1));
    act(() =>
      useGameStore.setState({
        phase: 'won',
        outcome: {
        status: 'won',
        stars: 3,
        starTitle: 'Идеальное прохождение',
        coins: 90,
        movesUsed: 8,
        matches: 5,
        golden: 1,
        bombs: 0,
        comboBest: 4,
        comboCoins: 10,
        boostersUsed: 0,
        leftovers: 0,
        clean: true,
        rewards: [
          { id: 'base', label: 'Награда за уровень', coins: 40 },
          { id: 'stars', label: 'Бонус за звёзды', coins: 20 },
          { id: 'combo', label: 'Комбо', coins: 10 },
          { id: 'golden', label: 'Золотые тройки', coins: 2 },
          { id: 'clean', label: 'Без подсказок, отмен и бустеров', coins: 15 },
        ],
      },
      }),
    );

    const host = mount(<ResultOverlay />);
    expect(host.textContent).toContain('Уровень пройден');
    expect(host.textContent).toContain('награда');
    expect(host.textContent).toContain('90');
    expect(host.textContent).toContain('Золотых троек: 1');
    expect(host.querySelectorAll('.star')).toHaveLength(3);

    // perfect run wording and the full coin breakdown
    expect(host.textContent).toContain('Идеальное прохождение');
    const lines = [...host.querySelectorAll('.reward-line')].map((line) => line.textContent ?? '');
    expect(lines.some((line) => line.includes('Комбо'))).toBe(true);
    expect(lines.some((line) => line.includes('Без подсказок, отмен и бустеров'))).toBe(true);
    expect(host.textContent).toContain('Лучшее комбо: ×4');

    click(buttonByText(host, 'Сыграть заново'));
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState().runtime?.config.id).toBe(1);
  });

  it('moves to the next level from the win panel', () => {
    act(() => useGameStore.getState().startLevel(1));
    act(() =>
      useGameStore.setState({
        phase: 'won',
        outcome: {
        status: 'won',
        stars: 2,
        starTitle: 'Хорошее прохождение',
        coins: 50,
        movesUsed: 12,
        matches: 5,
        golden: 0,
        bombs: 0,
        comboBest: 2,
        comboCoins: 2,
        boostersUsed: 1,
        leftovers: 2,
        clean: false,
        rewards: [
          { id: 'base', label: 'Награда за уровень', coins: 30 },
          { id: 'combo', label: 'Комбо', coins: 2 },
        ],
      },
        progress: { ...useGameStore.getState().progress, unlockedLevel: 2 },
      }),
    );

    const host = mount(<ResultOverlay />);
    click(buttonByText(host, 'Дальше'));
    expect(useGameStore.getState().phase).toBe('playing');
    expect(useGameStore.getState().runtime?.config.id).toBe(2);
  });

  it('offers a rewarded revive on the lose screen', () => {
    const calls: string[] = [];
    const original = { reviveWithAd: useGameStore.getState().reviveWithAd };
    act(() => {
      useGameStore.setState({ reviveWithAd: () => calls.push('revive') });
    });

    try {
      act(() => useGameStore.getState().startLevel(1));
      const runtime = useGameStore.getState().runtime;
      if (!runtime) throw new Error('the level did not start');
      act(() =>
        useGameStore.setState({
          runtime: { ...runtime, movesLeft: 0, status: 'lost' },
          phase: 'lost',
          reviveUsed: false,
          ads: {
            available: true,
            showing: false,
            kind: null,
            placement: null,
            interstitials: 0,
            rewarded: 0,
            lastInterstitialAt: null,
            levelsSinceInterstitial: 0,
            banner: { managed: false, showing: false, reason: null, supported: false },
            last: null,
          },
        }),
      );

      const host = mount(<ResultOverlay />);
      expect(host.textContent).toContain('Ходы закончились');
      click(buttonByText(host, 'Ещё 3 хода за рекламу'));
      expect(calls).toEqual(['revive']);

      // Once used, the offer is replaced by an explanation.
      act(() => useGameStore.setState({ reviveUsed: true }));
      const used = mount(<ResultOverlay />);
      expect(used.textContent).toContain('Оживление в этом заходе уже использовано');
      expect(buttonByText(used, 'Ещё 3 хода за рекламу')).toBeNull();
    } finally {
      act(() => useGameStore.setState(original));
    }
  });

  it('shows the lose panel with a retry button', () => {
    act(() => useGameStore.getState().startLevel(1));
    act(() =>
      useGameStore.setState({
        phase: 'lost',
        outcome: {
        status: 'lost',
        stars: 0,
        starTitle: '',
        coins: 0,
        movesUsed: 17,
        matches: 2,
        golden: 0,
        bombs: 0,
        comboBest: 1,
        comboCoins: 0,
        boostersUsed: 0,
        leftovers: 0,
        clean: false,
        rewards: [],
      },
      }),
    );

    const host = mount(<ResultOverlay />);
    expect(host.textContent).toContain('Ходы закончились');
    expect(host.textContent).toContain('Попробовать снова');
    expect(host.textContent).not.toContain('Уровень пройден');

    click(buttonByText(host, 'Попробовать снова'));
    expect(useGameStore.getState().phase).toBe('playing');
  });

  it('shows a toast and hides it again', async () => {
    act(() => useGameStore.getState().showToast('Золотая тройка! +1 ход', 'good'));
    const host = mount(<Toasts />);
    expect(host.textContent).toContain('Золотая тройка!');
    expect(host.querySelector('.toast-good')).toBeTruthy();

    // the toast auto-dismisses after its timer
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2600));
    });
    expect(useGameStore.getState().toast).toBeNull();
  });
});

describe('shop development tab', () => {
  function openUpgrades(): HTMLDivElement {
    const host = mount(<ShopScreen onBack={noop} />);
    click(buttonByText(host, 'Развитие'));
    return host;
  }

  it('lists a development track for every department', () => {
    const host = openUpgrades();
    const text = host.textContent ?? '';
    for (const track of UPGRADE_TRACKS) expect(text).toContain(track.name);
    expect(text).toContain('Бустеры поштучно');
    expect(host.querySelectorAll('.upgrade-card')).toHaveLength(UPGRADE_TRACKS.length);
    expect(host.querySelectorAll('.booster-shop-card')).toHaveLength(4);
  });

  it('shows the shop tier and its progress', () => {
    const host = mount(<ShopScreen onBack={noop} />);
    expect(host.querySelector('.shop-tier-name')?.textContent).toBe('Лавка');
    expect(host.querySelectorAll('.shop-tier-pip-on')).toHaveLength(1);

    act(() => {
      useGameStore.setState({
        progress: { ...useGameStore.getState().progress, upgrades: { 'dept-sweets': 4 } },
      });
    });

    const grown = mount(<ShopScreen onBack={noop} />);
    expect(grown.querySelector('.shop-tier-name')?.textContent).toBe('Магазин');
    expect(grown.querySelectorAll('.shop-tier-pip-on')).toHaveLength(2);
    expect(grown.querySelector('.shop-screen')?.getAttribute('data-tier')).toBe('2');
  });

  it('locks a track whose department is not bought yet', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 1000, owned: ['decor-cozy'] },
    });

    const host = openUpgrades();
    expect(host.querySelectorAll('.upgrade-card-locked')).toHaveLength(UPGRADE_TRACKS.length);

    const button = host.querySelector<HTMLButtonElement>('.upgrade-card .shop-card-action button');
    expect(button?.disabled).toBe(true);
  });

  it('buys a level, spends the coins and fills a pip', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 500, owned: ['decor-cozy', 'dept-sweets'] },
    });

    const host = openUpgrades();
    const card = host.querySelector('.upgrade-card')!;
    const button = card.querySelector<HTMLButtonElement>('.shop-card-action button')!;
    expect(button.disabled).toBe(false);

    click(button);

    const state = useGameStore.getState();
    expect(state.progress.upgrades['dept-sweets']).toBe(1);
    expect(state.progress.coins).toBe(500 - 70);

    const after = openUpgrades();
    expect(after.querySelectorAll('.upgrade-pip-on').length).toBeGreaterThan(0);
    expect(after.querySelectorAll('.upgrade-pip-on')[0]).toBeTruthy();
  });

  it('shows a maxed department as fully developed', () => {
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        coins: 10_000,
        owned: ['decor-cozy', 'dept-sweets'],
        upgrades: { 'dept-sweets': MAX_UPGRADE_LEVEL },
      mastery: { crowns: {}, best: {} },
      eventWins: [],
      adReward: { day: '', coins: 0, boosters: 0 },
      weeks: { key: '', stars: 0, best: 0 },
      },
    });

    const host = openUpgrades();
    expect(host.querySelectorAll('.upgrade-card-max')).toHaveLength(1);
    expect(host.textContent).toContain('Максимум');
  });

  it('buys single boosters for coins', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 300 },
    });

    const host = openUpgrades();
    const cards = [...host.querySelectorAll<HTMLButtonElement>('.booster-shop-card button')];
    expect(cards).toHaveLength(4);

    click(cards[0]!);
    expect(useGameStore.getState().progress.boosters.hammer).toBe(3); // started with 2
    expect(useGameStore.getState().progress.coins).toBe(300 - 70);

    act(() => {
      useGameStore.setState({ progress: { ...useGameStore.getState().progress, coins: 0 } });
    });
    const poor = openUpgrades();
    const button = poor.querySelector<HTMLButtonElement>('.booster-shop-card button')!;
    expect(button.disabled).toBe(true);
  });
});

describe('event screen', () => {
  const running = (): GameEvent => eventForDay(currentDayKey()) as GameEvent;

  const setEvent = (patch: Partial<ReturnType<typeof useGameStore.getState>['events']> = {}): void => {
    const event = eventForDay(currentDayKey());
    useGameStore.setState({
      phase: 'menu',
      runtime: null,
      events: { ...emptyEventState(event?.id ?? '', currentDayKey()), counts: {}, claimed: [], ...patch },
      progress: {
        ...useGameStore.getState().progress,
        coins: 100,
        boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 },
      },
    });
  };

  beforeEach(() => setEvent());

  it('shows the running event with its tasks and the finale', () => {
    const event = running();
    const host = mount(<EventScreen onBack={noop} />);
    const text = host.textContent ?? '';

    expect(host.querySelector('.event-screen-idle')).toBeNull();
    expect(text).toContain(event.name);
    expect(text).toContain(event.tagline);
    expect(host.querySelectorAll('.event-card')).toHaveLength(event.tasks.length);
    expect(host.querySelectorAll('.event-finale')).toHaveLength(1);
    expect(text).toContain(event.finale.title);

    const first = event.tasks[0] as (typeof event.tasks)[number];
    expect(text).toContain(first.title);
    expect(text).toContain(String(first.reward));

    // nothing is finished yet: every claim button is locked
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.event-card button')];
    expect(buttons).toHaveLength(event.tasks.length);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });

  it('collects a finished task from the screen', () => {
    const event = running();
    const first = event.tasks[0] as (typeof event.tasks)[number];
    setEvent({ counts: { [first.metric]: first.target } });

    const host = mount(<EventScreen onBack={noop} />);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.event-card button')];
    expect(buttons[0]?.disabled).toBe(false);

    click(buttons[0] ?? null);

    expect(useGameStore.getState().progress.coins).toBe(100 + first.reward);
    expect(useGameStore.getState().events.claimed).toContain(first.id);
    expect(host.textContent).toContain('Получено');
  });

  it('unlocks the finale when every task is done', () => {
    const event = running();
    setEvent({
      counts: Object.fromEntries(event.tasks.map((task) => [task.metric, task.target])),
    });

    const host = mount(<EventScreen onBack={noop} />);
    const finale = buttonByText(host, 'Забрать финал');
    expect(finale?.disabled).toBe(false);

    click(finale);
    expect(useGameStore.getState().progress.coins).toBe(100 + event.finale.coins);
    expect(useGameStore.getState().events.finaleClaimed).toBe(true);
    expect(host.textContent).toContain('Получено');
  });

  it('tells the player when nothing is running', () => {
    useGameStore.setState({ events: { ...EMPTY_EVENT_STATE } });
    const idle = mount(<EventScreen onBack={noop} />);

    // an empty state only happens when the clock points at a day without an event,
    // so the screen either shows the idle card or the running event — never nothing
    const idleText = idle.textContent ?? '';
    expect(idleText.includes('Сейчас события нет') || idleText.includes(running().name)).toBe(true);
  });

  it('counts claimable rewards of the running event', () => {
    const event = running();
    const first = event.tasks[0] as (typeof event.tasks)[number];

    expect(eventReadyToClaim({ ...EMPTY_EVENT_STATE }, currentDayKey())).toBe(false);
    expect(eventReadyToClaim(emptyEventState(event.id, currentDayKey()), currentDayKey())).toBe(false);

    const done = {
      ...emptyEventState(event.id, currentDayKey()),
      counts: { [first.metric]: first.target },
    };
    expect(eventReadyToClaim(done, currentDayKey())).toBe(true);

    const claimed = { ...done, claimed: [first.id] };
    expect(eventReadyToClaim(claimed, currentDayKey())).toBe(false);

    const all = {
      ...emptyEventState(event.id, currentDayKey()),
      counts: Object.fromEntries(event.tasks.map((task) => [task.metric, task.target])),
    };
    expect(eventReadyToClaim(all, currentDayKey())).toBe(true);

    // everything collected — tasks and the finale — leaves nothing to claim
    const collected = { ...all, claimed: event.tasks.map((task) => task.id), finaleClaimed: true };
    expect(eventReadyToClaim(collected, currentDayKey())).toBe(false);
    expect(eventReadyToClaim({ ...collected, finaleClaimed: false }, currentDayKey())).toBe(true);

    // the views of the screen and of the helper agree
    expect(eventTaskViews(all, event).every((view) => view.done)).toBe(true);
  });

  it('formats the days left', () => {
    expect(daysLeftLabel(0)).toBe('событие закончилось');
    expect(daysLeftLabel(1)).toBe('последний день');
    expect(daysLeftLabel(2)).toBe('осталось 2 дня');
    expect(daysLeftLabel(5)).toBe('осталось 5 дней');
    expect(daysLeftLabel(7)).toBe('осталось 7 дней');
  });

  it('shows the event strip in the menu and opens the screen', () => {
    let opened = '';
    const host = mount(
      <HomeScreen
        onOpenMap={noop}
        onOpenShop={noop}
        onOpenDaily={noop}
        onOpenGift={noop}
        onOpenMaster={noop}
        onOpenEvent={() => (opened = 'event')}
        onOpenBoard={() => {}}
      />,
    );

    const event = running();
    const strip = host.querySelector('.menu-event');
    expect(strip?.textContent).toContain(event.name);
    expect(strip?.textContent).toContain('ещё');

    click(strip);
    expect(opened).toBe('event');

    // a pending reward puts a badge on the strip
    const first = event.tasks[0] as (typeof event.tasks)[number];
    act(() => setEvent({ counts: { [first.metric]: first.target } }));
    expect(host.querySelector('.menu-event-badge')?.textContent).toBe('!');
  });
});

describe('master screen', () => {
  const finishCampaign = (): void => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, levelStars: { [CAMPAIGN_SIZE]: 3 } },
    });
  };

  it('stays locked until the last campaign level is cleared', () => {
    const host = mount(<MasterScreen onBack={noop} />);

    expect(host.querySelector('.master-screen-locked')).toBeTruthy();
    expect(host.textContent).toContain('откроется после 60-го уровня');
    expect(host.querySelectorAll('.master-card')).toHaveLength(0);
  });

  it('lists every campaign level as a master challenge', () => {
    finishCampaign();
    const host = mount(<MasterScreen onBack={noop} />);

    expect(host.querySelector('.master-screen-locked')).toBeNull();
    expect(host.querySelectorAll('.master-card')).toHaveLength(MASTER_LEVEL_IDS.length);

    const text = host.textContent ?? '';
    expect(text).toContain('Стажёр');
    expect(text).toContain('0 очков мастерства');
    expect(text).toContain(`До ранга «${MASTER_RANKS[1]!.name}»`);

    // the icons of a level's modifiers are on its card
    const icons = masterModifiersFor(2).map((modifier) => modifier.icon);
    const firstCard = host.querySelector('.master-card');
    for (const icon of icons) expect(firstCard?.textContent).toContain(icon);
  });

  it('shows the modifier list and starts the level', () => {
    finishCampaign();
    const host = mount(<MasterScreen onBack={noop} />);

    click(host.querySelectorAll('.master-card')[0] ?? null);

    const detail = host.querySelector('.master-detail');
    expect(detail).toBeTruthy();
    expect(detail?.textContent).toContain('Мало ходов');
    expect(detail?.textContent).toContain('Без подсказок');
    expect(detail?.textContent).toContain('очков мастерства');

    click(buttonByText(host, 'Играть МАСТЕР'));

    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    expect(state.runtime?.config.id).toBe(masterIdFor(2));
    expect(state.runtime?.hintsLeft).toBe(0);
  });

  it('shows crowns and points of finished master levels', () => {
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        levelStars: { [CAMPAIGN_SIZE]: 3 },
        mastery: { crowns: { 2: 2 }, best: { 2: 38 } },
      },
    });

    const host = mount(<MasterScreen onBack={noop} />);
    const text = host.textContent ?? '';

    expect(text).toContain('38 очков мастерства');
    expect(text).toContain('лучший результат: 38');
    expect(host.querySelectorAll('.master-card-won')).toHaveLength(1);
    expect(host.querySelector('.master-card-won')?.textContent).toContain('👑👑·');
  });

  it('opens the master screen from the menu', () => {
    let opened = '';
    const host = mount(
      <HomeScreen
        onOpenMap={noop}
        onOpenShop={noop}
        onOpenDaily={noop}
        onOpenGift={noop}
        onOpenMaster={() => (opened = 'master')}
        onOpenEvent={() => (opened = 'event')}
        onOpenBoard={() => {}}
      />,
    );

    const button = buttonByText(host, 'Мастер');
    expect(button?.querySelector('.btn-badge')?.textContent).toBe('🔒');

    click(button);
    expect(opened).toBe('master');

    // once the campaign is over the lock badge disappears
    act(() => finishCampaign());
    const unlocked = mount(
      <HomeScreen
        onOpenMap={noop}
        onOpenShop={noop}
        onOpenDaily={noop}
        onOpenGift={noop}
        onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop}
      />,
    );
    expect(buttonByText(unlocked, 'Мастер')?.querySelector('.btn-badge')).toBeNull();
  });
});

describe('daily gift screen', () => {
  const dayBefore = (days: number): string => {
    const now = new Date();
    return dailyKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
  };

  const setStreak = (days: number, lastDay: string): void => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, dailyStreak: { days, lastDay }, lastSeenDay: lastDay },
    });
  };

  it('shows the seven day calendar with the first day ready', () => {
    const host = mount(<GiftScreen onBack={noop} />);
    const text = host.textContent ?? '';

    expect(host.querySelectorAll('.gift-cell')).toHaveLength(GIFT_CYCLE_DAYS);
    expect(host.querySelectorAll('.gift-cell-taken')).toHaveLength(0);
    expect(host.querySelector('.gift-cell-today')?.getAttribute('data-day')).toBe('1');
    expect(host.querySelectorAll('.gift-cell-future')).toHaveLength(GIFT_CYCLE_DAYS - 1);

    expect(text).toContain('День 1');
    expect(text).toContain(DAILY_GIFTS[0]!.label);
    expect(text).toContain(String(DAILY_GIFTS[0]!.coins));
    expect(text).toContain(String(giftForDay(GIFT_CYCLE_DAYS).coins));

    const claim = buttonByText(host, 'Забрать подарок');
    expect(claim?.disabled).toBe(false);
  });

  it('collects the gift and locks it until tomorrow', () => {
    const host = mount(<GiftScreen onBack={noop} />);
    const before = useGameStore.getState().progress.coins;

    click(buttonByText(host, 'Забрать подарок'));

    const after = useGameStore.getState();
    expect(after.progress.coins).toBe(before + giftForDay(1).coins);
    expect(after.progress.dailyStreak).toEqual({ days: 1, lastDay: currentDayKey() });
    expect(after.progress.lastSeenDay).toBe(currentDayKey());

    // the same screen repaints as collected…
    expect(host.querySelectorAll('.gift-cell-taken')).toHaveLength(1);
    expect(buttonByText(host, 'Забрать подарок')?.disabled).toBe(true);
    expect(host.textContent).toContain('Подарок получен');

    // …and a fresh one shows the same state
    const reopened = mount(<GiftScreen onBack={noop} />);
    expect(reopened.querySelectorAll('.gift-cell-taken')).toHaveLength(1);
    expect(buttonByText(reopened, 'Забрать подарок')?.disabled).toBe(true);

    // a second press pays nothing
    const coins = useGameStore.getState().progress.coins;
    click(buttonByText(reopened, 'Забрать подарок'));
    expect(useGameStore.getState().progress.coins).toBe(coins);
  });

  it('highlights the cell of the current streak', () => {
    setStreak(3, dayBefore(1));
    const host = mount(<GiftScreen onBack={noop} />);

    expect(host.querySelector('.gift-cell-today')?.getAttribute('data-day')).toBe('4');
    expect(host.querySelectorAll('.gift-cell-taken')).toHaveLength(3);
    expect(host.querySelectorAll('.gift-cell-future')).toHaveLength(GIFT_CYCLE_DAYS - 4);
    expect(host.textContent).toContain('день 4/7 календаря');
    expect(host.textContent).toContain(DAILY_GIFTS[3]!.label);

    click(buttonByText(host, 'Забрать подарок'));
    expect(host.querySelectorAll('.gift-cell-taken')).toHaveLength(4);
    expect(useGameStore.getState().progress.dailyStreak.days).toBe(4);
    expect(buttonByText(host, 'Забрать подарок')?.disabled).toBe(true);
  });

  it('shows the boosters of the final day', () => {
    setStreak(6, dayBefore(1));
    const host = mount(<GiftScreen onBack={noop} />);
    const text = host.textContent ?? '';

    expect(host.querySelector('.gift-cell-today')?.getAttribute('data-day')).toBe('7');
    expect(host.querySelectorAll('.gift-cell-today .gift-booster')).toHaveLength(2);
    expect(text).toContain('День 7');
    expect(text).toContain('молоток');

    click(buttonByText(host, 'Забрать подарок'));
    expect(useGameStore.getState().progress.boosters.hammer).toBe(3);
    expect(useGameStore.getState().progress.boosters.extraMove).toBe(2);
    expect(host.textContent).toContain('календарь начнётся заново');
  });

  it('starts the calendar over after a missed day', () => {
    setStreak(6, dayBefore(4));
    const host = mount(<GiftScreen onBack={noop} />);

    expect(host.querySelector('.gift-cell-today')?.getAttribute('data-day')).toBe('1');
    expect(host.querySelectorAll('.gift-cell-taken')).toHaveLength(0);

    click(buttonByText(host, 'Забрать подарок'));
    expect(useGameStore.getState().progress.dailyStreak.days).toBe(1);
  });
});

describe('daily tasks screen', () => {
  it('shows the three tasks of the day with their progress', () => {
    const tasks = pickDailyTasks(todayKey());
    const host = mount(<DailyScreen onBack={noop} />);
    const text = host.textContent ?? '';

    for (const task of tasks) expect(text).toContain(task.title);
    expect(text).toContain('Задания дня');
    expect(text).toContain('Обновятся через');
  });

  it('blocks the reward until the task is finished, then pays it once', () => {
    const task = pickDailyTasks(todayKey())[0]!;

    useGameStore.setState({
      daily: {
        date: todayKey(),
        counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 },
        claimed: [],
      },
    });

    const host = mount(<DailyScreen onBack={noop} />);
    const locked = buttonByText(host, String(task.reward));
    expect(locked?.disabled).toBe(true);

    click(locked);
    expect(useGameStore.getState().progress.coins).toBe(120);
    expect(useGameStore.getState().daily.claimed).toEqual([]);

    // finish the task and try again
    act(() => {
      useGameStore.setState({
        daily: { ...useGameStore.getState().daily, counts: { ...useGameStore.getState().daily.counts, matches: 999, levels: 9, stars: 9, golden: 9, bombs: 9 } },
      });
    });

    act(() => {
      root.render(<DailyScreen onBack={noop} />);
    });

    const claim = buttonByText(host, String(task.reward));
    expect(claim?.disabled).toBe(false);
    click(claim);

    expect(useGameStore.getState().progress.coins).toBe(120 + task.reward);
    expect(useGameStore.getState().daily.claimed).toContain(task.id);
    expect(host.textContent).toContain('Получено');

    // claiming twice must not pay twice
    expect(useGameStore.getState().claimDaily(task.id)).toBe(false);
    expect(useGameStore.getState().progress.coins).toBe(120 + task.reward);
  });

  it('shows the streak and pays the streak bonus once a day', () => {
    useGameStore.setState({
      progress: { ...useGameStore.getState().progress, coins: 0, dailyStreak: { days: 7, lastDay: '2001-01-01' } },
      daily: {
        date: todayKey(),
        counts: { matches: 99, levels: 9, golden: 9, bombs: 9, stars: 9 },
        claimed: [],
      },
    });

    const host = mount(<DailyScreen onBack={noop} />);
    expect(host.textContent).toContain('Серия');

    const task = pickDailyTasks(todayKey())[0]!;
    click(buttonByText(host, String(task.reward)));

    const progress = useGameStore.getState().progress;
    expect(progress.dailyStreak.days).toBe(1); // the streak restarted after the gap
    expect(progress.coins).toBe(task.reward); // day one pays no bonus
  });

  it('ignores the counters of a previous day', () => {
    useGameStore.setState({
      daily: {
        date: '2001-01-01',
        counts: { matches: 99, levels: 99, golden: 99, bombs: 99, stars: 99 },
        claimed: [],
      },
    });

    const host = mount(<DailyScreen onBack={noop} />);
    // yesterday's progress must not unlock today's rewards
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.daily-card button')];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(host.textContent).not.toContain('Получено');
  });

  it('counts the moves played on a level into the daily counters', () => {
    useGameStore.setState({
      daily: { date: todayKey(), counts: { matches: 0, levels: 0, golden: 0, bombs: 0, stars: 0 }, claimed: [] },
    });
    useGameStore.getState().startLevel(1);

    // play the level with the very same hint a player would follow
    let guard = 0;
    while (useGameStore.getState().phase === 'playing' && guard < 60) {
      guard += 1;
      const runtime = useGameStore.getState().runtime;
      if (!runtime) break;
      const hint = findHint(runtime.board, { goal: runtime.goal });
      if (!hint) break;
      useGameStore.getState().requestMove(hint.from, hint.to);
    }

    const daily = useGameStore.getState().daily;
    expect(daily.counts.matches).toBeGreaterThan(0);
    expect(daily.counts.levels).toBe(1);
    expect(daily.counts.stars).toBeGreaterThan(0);
    expect(daily.date).toBe(todayKey());
  });
});

describe('booster bar in the HUD', () => {
  it('shows all four boosters with their counts', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.booster-btn')];
    expect(buttons).toHaveLength(4);
    for (const icon of ['🔨', '🔀', '➕', '↩']) {
      expect(host.textContent).toContain(icon);
    }

    const counts = buttons.map((button) => button.querySelector('.booster-count')?.textContent);
    expect(counts).toEqual(['2', '2', '1', '2']);
  });

  it('arms the hammer and punches a hole in the shelf', () => {
    act(() => useGameStore.getState().startLevel(1));
    const host = mount(<Hud />);

    const hammer = host.querySelector<HTMLButtonElement>('.booster-btn')!;
    click(hammer);
    expect(useGameStore.getState().boosterMode).toBe('hammer');
    expect(hammer.className).toContain('booster-btn-armed');

    const index = useGameStore.getState().runtime!.board.cells.findIndex((cell) => cell.uid !== null);
    act(() => {
      useGameStore.getState().useBooster('hammer', index);
    });

    const after = mount(<Hud />);
    expect(useGameStore.getState().boosterMode).toBeNull();
    expect(after.querySelectorAll('.booster-btn')[0]?.querySelector('.booster-count')?.textContent).toBe('1');
    expect(useGameStore.getState().runtime?.boostersUsed).toBe(1);
  });

  it('spends extra moves, shuffles and the free undo from the bar', () => {
    act(() => useGameStore.getState().startLevel(1));
    const moves = useGameStore.getState().runtime!.movesLeft;
    const undos = useGameStore.getState().runtime!.undosLeft;
    const board = useGameStore.getState().runtime!.board;

    const buttons = [...mount(<Hud />).querySelectorAll<HTMLButtonElement>('.booster-btn')];
    click(buttons[2]!); // +3 хода
    click(buttons[1]!); // перемешать
    click(buttons[3]!); // бесплатная отмена

    const state = useGameStore.getState();
    expect(state.runtime?.movesLeft).toBe(moves + 3);
    expect(state.runtime?.board).not.toBe(board);
    expect(state.runtime?.undosLeft).toBe(undos + 1);
    expect(state.runtime?.boostersUsed).toBe(3);
    expect(state.progress.boosters.extraMove).toBe(0);
  });

  it('greys out the boosters that ran out', () => {
    act(() => useGameStore.getState().startLevel(1));
    act(() => {
      useGameStore.setState({
        progress: { ...useGameStore.getState().progress, boosters: { hammer: 0, shuffle: 1, extraMove: 0, undo: 5 } },
      });
    });

    const buttons = [...mount(<Hud />).querySelectorAll<HTMLButtonElement>('.booster-btn')];
    expect(buttons[0]?.disabled).toBe(true);
    expect(buttons[2]?.disabled).toBe(true);
    expect(buttons[1]?.disabled).toBe(false);
    expect(buttons[3]?.disabled).toBe(false);
  });
});

describe('combo in the HUD', () => {
  /** Small shelf used to make two clearing moves in a row through the store. */
  function startComboLevel(maxMoves = 10): void {
    act(() => {
      useGameStore.setState({
        phase: 'playing',
        runtime: createLevelRuntime({
          id: 9001,
          name: 'Комбо',
          rows: 3,
          cols: 4,
          goal: { kind: 'clearAll' },
          generator: {
            kind: 'layout',
            rows: ['a a .. a', 'c c .. c', 'b b .. b'],
            palette: { a: 'apple', b: 'cake', c: 'milk' },
          },
          moveLimit: maxMoves,
          hints: 2,
          undos: 2,
          coins: 40,
        }),
      });
    });
  }

  it('stays hidden until the second triple in a row', () => {
    startComboLevel();
    expect(mount(<Hud />).querySelector('.combo-chip')).toBeNull();

    act(() => {
      useGameStore.getState().requestMove(3, 2);
    });
    expect(mount(<Hud />).querySelector('.combo-chip')).toBeNull();
  });

  it('shows the running combo and its coins after the second triple', () => {
    startComboLevel();
    act(() => {
      useGameStore.getState().requestMove(3, 2);
    });
    act(() => {
      useGameStore.getState().requestMove(7, 6);
    });

    const host = mount(<Hud />);
    expect(host.querySelector('.combo-chip')?.textContent).toContain('Комбо ×2');
    expect(host.textContent).toContain('+2 монет за комбо');
  });

  it('drops back to silence when the chain is broken', () => {
    startComboLevel();
    act(() => {
      useGameStore.getState().requestMove(3, 2);
    });
    act(() => {
      useGameStore.getState().requestMove(7, 6);
    });
    act(() => {
      useGameStore.getState().requestMove(9, 10); // clears nothing
    });

    expect(mount(<Hud />).querySelector('.combo-chip')).toBeNull();
    expect(useGameStore.getState().runtime?.combo.best).toBe(2);
  });
});

describe('end to end through the UI', () => {
  it('plays level 1 from the menu to the win screen', () => {
    const host = mount(<HomeScreen onOpenMap={noop} onOpenShop={noop} onOpenDaily={noop} onOpenGift={noop} onOpenMaster={noop} onOpenEvent={noop} onOpenBoard={noop} />);
    click(buttonByText(host, 'Играть'));
    expect(useGameStore.getState().phase).toBe('playing');

    // play the level move by move, exactly like a player would
    let guard = 0;
    while (useGameStore.getState().phase === 'playing' && guard < 60) {
      guard += 1;
      const runtime = useGameStore.getState().runtime;
      const step = runtime ? findHint(runtime.board, {}) : null;
      if (!step) break;
      act(() => {
        useGameStore.getState().requestMove(step.from, step.to);
      });
    }

    const state = useGameStore.getState();
    expect(state.phase).toBe('won');
    expect(state.outcome?.stars).toBeGreaterThanOrEqual(1);
    expect(state.progress.coins).toBeGreaterThan(0);
    expect(state.progress.levelStars[1]).toBeGreaterThanOrEqual(1);
    expect(state.progress.unlockedLevel).toBeGreaterThanOrEqual(2);

    // the outcome carries the star wording and the reward breakdown
    expect(state.outcome?.starTitle.length).toBeGreaterThan(0);
    expect(state.outcome?.rewards.length).toBeGreaterThan(0);

    const winScreen = mount(<ResultOverlay />);
    expect(winScreen.textContent).toContain('Уровень пройден');
    expect(winScreen.textContent).toContain(state.outcome?.starTitle ?? '—');
    click(buttonByText(winScreen, 'Дальше'));
    expect(useGameStore.getState().runtime?.config.id).toBe(2);
  });
});

describe('rating screen', () => {
  let mock: MockSdk | null = null;

  const session = (authorized: boolean): void => {
    useGameStore.setState({
      cloud: {
        ...useGameStore.getState().cloud,
        available: true,
        authorized,
        guest: !authorized,
        playerId: authorized ? 'mock-player-1' : null,
      },
    });
  };

  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    useGameStore.setState({ leaderboard: { ...useGameStore.getState().leaderboard, boards: {
      mastery: { id: 'mastery', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
      stars3: { id: 'stars3', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
      week: { id: 'week', phase: 'idle', entries: [], userRank: 0, loadedAt: null },
    } } });
  });

  afterEach(async () => {
    resetLeaderboards();
    resetPlatform();
    (window as unknown as { YaGames?: unknown }).YaGames = undefined;
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
    mock = null;
  });

  it('shows my result, my place and the top of the table', async () => {
    mock = createMockSdk({
      player: { authorized: true, name: 'Игрок' },
      leaderboards: { seeded: { shelf_mastery: [['Аня', 300], ['Борис', 120]] } },
    });
    mock.install(window);
    await initPlatform({ windowRef: window });
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        levelStars: { 1: 3, 2: 3 },
        mastery: { crowns: {}, best: { 1: 40, 2: 11 } },
        weeks: { key: weekKeyFor(todayKey()), stars: 4, best: 27 },
      },
    });
    session(true);
    await initLeaderboards();
    await publishScores();

    const host = mount(<LeaderboardScreen onBack={noop} />);
    await flush();
    const text = host.textContent ?? '';

    expect(text).toContain('Рейтинг');
    expect(text).toContain('Мастерство');
    expect(text).toContain('Три звезды');
    expect(text).toContain('Неделя');
    expect(text).toContain('Мой результат');
    expect(text).toContain('51 очк.');
    expect(text).toContain('3 место');
    expect(text).toContain('Аня');
    expect(text).toContain('Борис');
    expect(text).toContain('300');
    expect(text).toContain('Отправлено в рейтинг: 51');
    expect(host.querySelectorAll('.board-row')).toHaveLength(3);
    expect(host.querySelector('.board-row-self')?.textContent).toContain('Игрок');

    // The other two tabs read their own tables.
    click(buttonByText(host, 'Три звезды'));
    await flush();
    expect(host.textContent).toContain('2 ур.');
  });

  it('explains the state without a platform', async () => {
    await initLeaderboards();
    const host = mount(<LeaderboardScreen onBack={noop} />);
    await flush();

    expect(host.textContent).toContain('Рейтинг доступен в Яндекс Играх');
    expect(host.querySelectorAll('.board-row')).toHaveLength(0);
  });

  it('invites a guest to sign in and shows the place right after the login', async () => {
    mock = createMockSdk({
      player: { authorized: false, name: 'Игрок' },
      leaderboards: { seeded: { shelf_mastery: [['Аня', 300]] } },
    });
    mock.install(window);
    await initPlatform({ windowRef: window });
    useGameStore.setState({
      progress: {
        ...useGameStore.getState().progress,
        mastery: { crowns: {}, best: { 1: 20 } },
      },
    });
    session(false);
    await initLeaderboards();

    const host = mount(<LeaderboardScreen onBack={noop} />);
    await flush();
    expect(host.textContent).toContain('В таблицу попадают только игроки, вошедшие в Яндекс');
    expect(host.textContent).toContain('пока без места');

    await act(async () => {
      click(buttonByText(host, 'Войти в Яндекс'));
    });
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await flush();
    expect(mock.calls.authDialogs).toBe(1);
    // The score went up with the login and the table now knows the player.
    expect(host.textContent).toContain('2 место');
    expect(host.querySelector('.board-row-self')?.textContent).toContain('20');
  });

  it('opens from the menu', () => {
    let opened = '';
    const host = mount(
      <HomeScreen
        onOpenMap={noop}
        onOpenShop={noop}
        onOpenDaily={noop}
        onOpenGift={noop}
        onOpenMaster={noop}
        onOpenEvent={noop}
        onOpenBoard={() => (opened = 'board')}
      />,
    );

    click(buttonByText(host, '🏆 Рейтинг'));
    expect(opened).toBe('board');
  });
});

describe('premium block (in-app purchases)', () => {
  let mock: MockSdk | null = null;

  const flush = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  /** A session with the payments of the fake Console. */
  const startPayments = async (options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> => {
    mock = createMockSdk({
      payments: { enabled: true, catalog: MOCK_PREVIEW_PRODUCTS, ...options.payments },
      ...options,
    });
    mock.install(window);
    await initPlatform({ windowRef: window });
    await initPurchases();
    await flush();
    return mock;
  };

  afterEach(async () => {
    act(() => useGameStore.setState({ rewardDoubled: false, phase: 'menu', outcome: null, runtime: null }));
    resetPurchases();
    resetPlatform();
    delete (window as unknown as { YaGames?: unknown }).YaGames;
    window.localStorage.clear();
  });

  it('lists the products of the Console with their real prices', async () => {
    await startPayments();
    const host = mount(<ShopScreen onBack={noop} />);

    const block = host.querySelector('.premium-block');
    expect(block).toBeTruthy();
    expect(block?.textContent).toContain('Горсть монет');
    expect(block?.textContent).toContain('75 YAN');
    expect(block?.textContent).toContain('Без рекламы');
    expect(block?.textContent).toContain('249 YAN');
    // The currency is never invented by the game: it is printed as delivered.
    expect(block?.textContent).not.toContain('руб');
    expect(block?.querySelectorAll('.premium-card')).toHaveLength(MOCK_PREVIEW_PRODUCTS.length);
  });

  it('credits the purchase of a pack into the wallet', async () => {
    const session = await startPayments();
    act(() => setCoins(100));
    const host = mount(<ShopScreen onBack={noop} />);

    click(host.querySelector('[data-product="coins_small"] button'));
    await flush();

    expect(useGameStore.getState().progress.coins).toBe(100 + 1_200);
    expect(session.pay.consumed).toEqual(['coins_small']);
    // The player is told what arrived (the toast is rendered by `Toasts`).
    expect(useGameStore.getState().toast?.text).toContain('Покупка зачислена');
    expect(useGameStore.getState().toast?.text).toContain('Горсть монет');
  });

  it('marks an owned product and hides what the Console does not have', async () => {
    const session = await startPayments();
    // The player paid for the ad-free product in an earlier session: the
    // platform returns it as a non-consumable, the game keeps it in the ledger.
    session.pay.addPending('remove_ads');
    await initPurchases();
    await flush();

    const host = mount(<ShopScreen onBack={noop} />);
    const owned = host.querySelector('[data-product="remove_ads"]');
    expect(owned?.textContent).toContain('Куплено');
    expect(owned?.querySelector('button')?.hasAttribute('disabled')).toBe(true);
    // Only the catalog of the portal is listed — nothing is invented locally.
    expect(host.querySelector('[data-product="unknown_product"]')).toBeNull();
    expect(host.querySelectorAll('.premium-card')).toHaveLength(MOCK_PREVIEW_PRODUCTS.length);
  });

  it('explains itself when the platform has no purchases at all', () => {
    const host = mount(<ShopScreen onBack={noop} />);
    expect(host.querySelector('.premium-empty')?.textContent).toContain('Яндекс Играх');
    expect(host.querySelectorAll('.premium-card')).toHaveLength(0);
  });

  it('offers the doubling of the reward on the win panel', async () => {
    await startPayments();
    act(() =>
      useGameStore.setState({
        ads: { ...useGameStore.getState().ads, available: true, showing: false },
      }),
    );
    act(() => useGameStore.getState().startLevel(1));
    act(() => useGameStore.setState({ phase: 'won', outcome: wonOutcome(40) }));

    const host = mount(<ResultOverlay />);
    const button = buttonByText(host, 'Удвоить награду');
    expect(button?.textContent).toContain('+40 монет');
    expect(host.textContent).toContain('осталось сегодня');

    // Once the reward of this run is doubled, the offer disappears.
    act(() => useGameStore.setState({ rewardDoubled: true }));
    const doubled = mount(<ResultOverlay />);
    expect(buttonByText(doubled, 'Удвоить награду')).toBeNull();
    expect(doubled.textContent).toContain('Удвоение уже использовано');
  });

  it('keeps the offer away from the players who paid for «no ads»', async () => {
    await startPayments();
    mock?.pay.addPending('remove_ads');
    await initPurchases();
    await flush();
    expect(useGameStore.getState().purchases.owned).toContain('remove_ads');

    act(() =>
      useGameStore.setState({
        ads: { ...useGameStore.getState().ads, available: true, showing: false },
      }),
    );
    act(() => useGameStore.getState().startLevel(1));
    act(() => useGameStore.setState({ phase: 'won', outcome: wonOutcome(40) }));

    const host = mount(<ResultOverlay />);
    expect(buttonByText(host, 'Удвоить награду')).toBeNull();

    // The shop still offers the voluntary videos, with an explanation.
    const shop = mount(<ShopScreen onBack={noop} />);
    click(buttonByText(shop, 'Развитие'));
    expect(shop.textContent).toContain('Реклама отключена покупкой');
  });
});