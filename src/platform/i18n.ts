/**
 * Interface language, driven by the platform.
 *
 * The Yandex Games requirement 2.14 is that a game picks up the interface
 * language of the portal (`ysdk.environment.i18n.lang`). The full text of the
 * game is Russian, so the rule here is explicit and documented:
 *
 *   ru, be, kk, uk, uz, …  → Russian (the game is written in Russian and these
 *                            locales read it natively)
 *   anything else           → English (menu, HUD, pause and results)
 *
 * The language never changes mid-game: it is detected during boot, before the
 * first render. Local previews may force it with `?lang=en`.
 */
export type Lang = 'ru' | 'en';

export type LangSource = 'platform' | 'query' | 'default';

/** Language codes that fall back to the Russian interface. */
export const RU_LANGS = new Set([
  'ru', 'be', 'kk', 'uk', 'uz', 'ky', 'tg', 'hy', 'az', 'ka', 'mo',
  'ab', 'av', 'ba', 'ce', 'cv', 'os', 'tt', 'udm', 'sah', 'ceb',
]);

/** Yandex Games `lang` code, or a plain browser code → our two locales. */
export function langFromCode(code: string | null | undefined): Lang | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  const normalized = code.trim().toLowerCase().replace(/_/g, '-');
  const primary = normalized.split('-')[0] ?? '';
  const secondary = normalized.split('-')[1] ?? '';
  // zh-Hans / zh-Hant are Simplified / Traditional: only Hans is English-friendly.
  if (primary === 'zh') return secondary === 'hans' ? 'en' : 'ru';
  if (primary === 'en') return 'en';
  if (RU_LANGS.has(primary)) return 'ru';
  return 'en';
}

/** Reads `?lang=` — the local-preview switch documented for developers. */
export function langFromQuery(search: string): Lang | null {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (query.length === 0) return null;
  const value = new URLSearchParams(query).get('lang');
  return langFromCode(value);
}

/**
 * Picks the interface language. A query parameter wins (a dev preview may need
 * to check English while the portal says Russian), then the platform, then the
 * default `ru`.
 */
export function detectLang(input: {
  query?: string;
  platform?: string | null;
  fallback?: Lang;
} = {}): { lang: Lang; source: LangSource } {
  const fromQuery = input.query === undefined ? null : langFromQuery(input.query);
  if (fromQuery) return { lang: fromQuery, source: 'query' };
  const fromPlatform = langFromCode(input.platform);
  if (fromPlatform) return { lang: fromPlatform, source: 'platform' };
  return { lang: input.fallback ?? 'ru', source: 'default' };
}

export interface StringVars {
  [key: string]: string | number;
}

type Dict = Record<string, string>;

const RU: Dict = {
  'common.on': 'Вкл',
  'common.off': 'Выкл',
  'common.coins': 'Монеты',
  'menu.title1': 'Разложи',
  'menu.title2': 'по полкам',
  'menu.subtitle': 'Собирай тройки одинаковых товаров и освобождай полки',
  'menu.footer': 'Перетаскивай товары мышью или пальцем. Три одинаковых рядом — и они исчезают!',
  'menu.play': '▶ Играть',
  'menu.map': '🗺 Карта уровней',
  'menu.shop': '🛍 Магазин',
  'menu.gift': '🎁 Подарок',
  'menu.daily': '🎯 Задания',
  'menu.master': '👑 Мастер',
  'menu.levelInfo': 'Уровень {id} из {total} · {world} · пройдено {done}',
  'menu.stars': 'Собрано звёзд',
  'menu.eventLastDay': 'последний день',
  'menu.eventDays': 'ещё {n} дн.',
  'hud.pause': 'Пауза',
  'hud.restart': 'Начать уровень заново',
  'hud.soundOn': 'Выключить звук',
  'hud.soundOff': 'Включить звук',
  'hud.musicOn': 'Выключить музыку',
  'hud.musicOff': 'Включить музыку',
  'hud.moves': 'ходов',
  'hud.level': 'Уровень',
  'hud.masterLevel': '👑 МАСТЕР · уровень {id}',
  'hud.hint': 'Подсказка',
  'hud.undo': 'Отмена',
  'hud.boosters': 'Бустеры',
  'hud.bombTitle': 'Бомбы: тройка убирает ещё три товара',
  'hud.iceTitle': 'Замороженные товары: собери тройку прямо на полке',
  'pause.title': 'Пауза',
  'pause.text': 'Передохни — полки никуда не убегут.',
  'pause.sound': 'Звук',
  'pause.music': 'Музыка',
  'pause.volume': 'Громкость',
  'pause.continue': 'Продолжить',
  'pause.restart': 'Заново',
  'pause.menu': 'В меню',
  'pause.fullscreen': 'Во весь экран',
  'cloud.title': 'Облачное сохранение',
  'cloud.syncing': 'Синхронизация…',
  'cloud.synced': 'Прогресс сохранён в облаке',
  'cloud.syncedAt': 'Сохранено в облаке: {time}',
  'cloud.dirty': 'Есть несохранённые изменения',
  'cloud.pulled': 'Прогресс загружен из облака',
  'cloud.pushed': 'Прогресс отправлен в облако',
  'cloud.offline': 'Облако недоступно — играем локально',
  'cloud.disabled': 'Облако только в Яндекс Играх',
  'cloud.error': 'Облако ответило ошибкой',
  'cloud.guest': 'Гостевая запись — прогресс в облаке, но не привязан к аккаунту',
  'cloud.sync': 'Синхронизировать',
  'ads.revive': '📺 Ещё {n} хода за рекламу',
  'ads.reviveDone': 'Оживление в этом заходе уже использовано',
  'ads.title': 'За просмотр рекламы',
  'ads.hint': 'Ролик смотрим добровольно: награда приходит только после полного просмотра.',
  'ads.coins': '+{n} монет',
  'ads.coinsLeft': 'осталось сегодня: {n} из {total}',
  'ads.booster': 'Случайный бустер',
  'ads.boosterLeft': 'осталось сегодня: {n} из {total}',
  'ads.watch': 'Смотреть',
  'ads.done': 'На сегодня всё',
  'ads.unavailable': 'Реклама недоступна',
  'ads.double': '📺 Удвоить награду: +{n} монет',
  'ads.doubleLeft': 'осталось сегодня: {n} из {total}',
  'ads.doubleDone': 'Удвоение уже использовано',
  'ads.doubleGet': 'Награда удвоена: +{n} монет',
  'ads.doubleLimit': 'На сегодня лимит рекламных монет исчерпан',
  'ads.off': 'Реклама отключена покупкой',
  'shop.premium': '💎 Премиум',
  'shop.premiumHint': 'Покупки приходят на аккаунт Яндекс Игр: их видно на другом устройстве.',
  'shop.premiumOffline': 'Покупки доступны в Яндекс Играх — здесь можно играть и зарабатывать монеты.',
  'shop.premiumEmpty': 'Товары временно недоступны — загляните чуть позже.',
  'purchase.buy': 'Купить',
  'purchase.price': 'Цена',
  'purchase.processing': 'Открываем оплату…',
  'purchase.owned': 'Куплено',
  'purchase.restored': 'Возвращены покупки: {n}',
  'purchase.done': 'Покупка зачислена: {name}',
  'purchase.cancelled': 'Оплата не завершена',
  'purchase.failed': 'Платёж не прошёл — попробуйте ещё раз',
  'purchase.noAdsDone': 'Реклама отключена — спасибо!',
  'purchase.coins': '+{n} монет',
  'shop.buyCoinsSmall': 'Горсть монет',
  'shop.buyCoinsSmallHint': '1 200 монет на бустеры и оформление полок.',
  'shop.buyCoinsBig': 'Мешок монет',
  'shop.buyCoinsBigHint': '4 000 монет — самый выгодный курс.',
  'shop.buyBoosters': 'Набор бустеров',
  'shop.buyBoostersHint': 'По 5 молотков, перемешиваний и отмен плюс 3 дополнительных хода.',
  'shop.buyStarter': 'Стартовый набор',
  'shop.buyStarterHint': '2 500 монет и по 3 бустера каждого вида — быстрый разгон.',
  'shop.buyNoAds': 'Без рекламы',
  'shop.buyNoAdsHint': 'Межстраничная реклама и баннер выключаются навсегда. Ролики за награду остаются — их смотрят только по желанию.',
  'lb.menu': '🏆 Рейтинг',
  'lb.title': 'Рейтинг',
  'lb.back': 'В меню',
  'lb.refresh': 'Обновить',
  'lb.board.mastery': 'Мастерство',
  'lb.board.stars3': 'Три звезды',
  'lb.board.week': 'Неделя',
  'lb.board.masteryHint': 'Сумма лучших очков мастерства по всем уровням — короны режима МАСТЕР.',
  'lb.board.stars3Hint': 'Сколько уровней кампании пройдено на три звезды.',
  'lb.board.weekHint': 'Рекорд по звёздам за одну неделю — с понедельника по воскресенье.',
  'lb.myScore': 'Мой результат',
  'lb.scorePoints': '{n} очк.',
  'lb.scoreStars3': '{n} ур.',
  'lb.scoreWeek': '{n} ⭐',
  'lb.thisWeek': 'на этой неделе: {n} ⭐',
  'lb.rank': '{n} место',
  'lb.noRank': 'пока без места',
  'lb.loading': 'Загружаем таблицу…',
  'lb.empty': 'В таблице пока пусто — стань первым!',
  'lb.hidden': 'Игрок',
  'lb.disabled': 'Рейтинг доступен в Яндекс Играх — здесь только пустая таблица.',
  'lb.unavailable': 'Таблицы рейтинга ещё не подключены к площадке.',
  'lb.unauthorized': 'В таблицу попадают только игроки, вошедшие в Яндекс.',
  'lb.authorize': 'Войти в Яндекс',
  'lb.error': 'Рейтинг не ответил — попробуйте обновить позже.',
  'lb.tooOften': 'Слишком часто обновляем — таблица пока из кэша, попробуйте через пару минут.',
  'lb.noBoard': 'Такой таблицы нет в Консоли разработчика:',
  'lb.sent': 'Отправлено в рейтинг: {n}',
  'lb.footer': 'Очки мастерства и звёзды считаются по лучшим заходам и не уменьшаются.',
  'cloud.authorize': 'Войти в Яндекс',
  'cloud.justNow': 'только что',
  'cloud.minutesAgo': '{n} мин назад',
  'pause.fullscreenOn': 'Во весь экран: вкл',
  'pause.fullscreenOff': 'Во весь экран: выкл',
  'result.win': 'Уровень пройден!',
  'result.lose': 'Ходы закончились',
  'result.reward': 'награда',
  'result.bestCombo': 'Лучшее комбо: ×{n}',
  'result.boostersUsed': 'Бустеров использовано: {n}',
  'result.leftovers': 'На полке осталось {n} — пару уже не собрать, цель засчитана',
  'result.golden': 'Золотых троек: {n} · +{coins} монет',
  'result.bombs': 'Взрывов: {n} · убрано {removed} товаров',
  'result.masterPoints': '+{points} очков мастерства',
  'result.masterNotBetter': ' · результат не лучше',
  'result.masterTotal': 'всего {total} · ранг «{rank}»',
  'result.newRank': 'Новый ранг: {rank}!',
  'result.next': 'Дальше ▶',
  'result.masterDone': 'Мастер-уровни пройдены',
  'result.toMaster': 'Режим МАСТЕР 👑',
  'result.tryAgain': 'Попробовать снова',
  'result.replay': 'Сыграть заново',
  'result.loseText': 'Попробуй ещё раз — на полках всегда есть удачный ход.',
  'result.masterWaiting': 'Режим МАСТЕР ждёт в меню',
  'result.backToMap': 'К карте',
};

/**
 * English is a real translation of the menu, the HUD, the pause screen and the
 * result screen. Screens that are still Russian-only fall back to `ru` below —
 * that is deliberate, not a bug: a half-translated shop would be worse than a
 * consistent Russian one.
 */
const EN: Dict = {
  'common.on': 'On',
  'common.off': 'Off',
  'common.coins': 'Coins',
  'menu.title1': 'Sort',
  'menu.title2': 'the shelves',
  'menu.subtitle': 'Match three identical products and clear the shelves',
  'menu.footer': 'Drag products with a mouse or a finger. Three identical ones in a row — and they are gone!',
  'menu.play': '▶ Play',
  'menu.map': '🗺 Level map',
  'menu.shop': '🛍 Shop',
  'menu.gift': '🎁 Gift',
  'menu.daily': '🎯 Tasks',
  'menu.master': '👑 Master',
  'menu.levelInfo': 'Level {id} of {total} · {world} · cleared {done}',
  'menu.stars': 'Stars collected',
  'menu.eventLastDay': 'last day',
  'menu.eventDays': '{n} days left',
  'hud.pause': 'Pause',
  'hud.restart': 'Restart level',
  'hud.soundOn': 'Mute',
  'hud.soundOff': 'Unmute',
  'hud.musicOn': 'Turn music off',
  'hud.musicOff': 'Turn music on',
  'hud.moves': 'moves',
  'hud.level': 'Level',
  'hud.masterLevel': '👑 MASTER · level {id}',
  'hud.hint': 'Hint',
  'hud.undo': 'Undo',
  'hud.boosters': 'Boosters',
  'hud.bombTitle': 'Bombs: a triple removes three more products',
  'hud.iceTitle': 'Frozen products: match three right on the shelf',
  'pause.title': 'Pause',
  'pause.text': 'Take a break — the shelves are not going anywhere.',
  'pause.sound': 'Sound',
  'pause.music': 'Music',
  'pause.volume': 'Volume',
  'pause.continue': 'Resume',
  'pause.restart': 'Restart',
  'pause.menu': 'Menu',
  'pause.fullscreen': 'Fullscreen',
  'cloud.title': 'Cloud save',
  'cloud.syncing': 'Syncing…',
  'cloud.synced': 'Progress is saved in the cloud',
  'cloud.syncedAt': 'Saved in the cloud: {time}',
  'cloud.dirty': 'There are unsaved changes',
  'cloud.pulled': 'Progress loaded from the cloud',
  'cloud.pushed': 'Progress sent to the cloud',
  'cloud.offline': 'Cloud is unavailable — playing locally',
  'cloud.disabled': 'Cloud works in Yandex Games only',
  'cloud.error': 'The cloud responded with an error',
  'cloud.guest': 'Guest profile — progress is in the cloud but not linked to an account',
  'cloud.sync': 'Sync now',
  'ads.revive': '📺 {n} more moves for an ad',
  'ads.reviveDone': 'The revive was already used in this run',
  'ads.title': 'Watch an ad',
  'ads.hint': 'The video is voluntary: the reward arrives only after it is watched to the end.',
  'ads.coins': '+{n} coins',
  'ads.coinsLeft': '{n} of {total} left today',
  'ads.booster': 'A random booster',
  'ads.boosterLeft': '{n} of {total} left today',
  'ads.watch': 'Watch',
  'ads.done': 'Nothing left today',
  'ads.unavailable': 'Ads are unavailable',
  'ads.double': '📺 Double the reward: +{n} coins',
  'ads.doubleLeft': '{n} of {total} left today',
  'ads.doubleDone': 'The doubling was already used',
  'ads.doubleGet': 'Reward doubled: +{n} coins',
  'ads.doubleLimit': 'The daily limit of ad coins is over',
  'ads.off': 'Ads are switched off by a purchase',
  'shop.premium': '💎 Premium',
  'shop.premiumHint': 'Purchases go to the Yandex Games account: they are visible on another device.',
  'shop.premiumOffline': 'Purchases work in Yandex Games — here you can play and earn coins.',
  'shop.premiumEmpty': 'The products are temporarily unavailable — please look in a bit later.',
  'purchase.buy': 'Buy',
  'purchase.price': 'Price',
  'purchase.processing': 'Opening the payment…',
  'purchase.owned': 'Owned',
  'purchase.restored': 'Purchases restored: {n}',
  'purchase.done': 'Purchase credited: {name}',
  'purchase.cancelled': 'The payment was not completed',
  'purchase.failed': 'The payment failed — please try again',
  'purchase.noAdsDone': 'Ads are off — thank you!',
  'purchase.coins': '+{n} coins',
  'shop.buyCoinsSmall': 'A handful of coins',
  'shop.buyCoinsSmallHint': '1 200 coins for boosters and shelf decorations.',
  'shop.buyCoinsBig': 'A bag of coins',
  'shop.buyCoinsBigHint': '4 000 coins — the best rate.',
  'shop.buyBoosters': 'Booster set',
  'shop.buyBoostersHint': 'Five hammers, shuffles and undos plus three extra moves.',
  'shop.buyStarter': 'Starter pack',
  'shop.buyStarterHint': '2 500 coins and three boosters of each kind — a quick start.',
  'shop.buyNoAds': 'No ads',
  'shop.buyNoAdsHint': 'Interstitials and the banner are switched off for good. Rewarded videos stay — they are watched on demand only.',
  'lb.menu': '🏆 Rating',
  'lb.title': 'Rating',
  'lb.back': 'To menu',
  'lb.refresh': 'Refresh',
  'lb.board.mastery': 'Mastery',
  'lb.board.stars3': 'Three stars',
  'lb.board.week': 'Week',
  'lb.board.masteryHint': 'Total of the best mastery points across every level — crowns of the MASTER mode.',
  'lb.board.stars3Hint': 'How many campaign levels were cleared with three stars.',
  'lb.board.weekHint': 'Record of stars collected within one week — Monday to Sunday.',
  'lb.myScore': 'My result',
  'lb.scorePoints': '{n} pts',
  'lb.scoreStars3': '{n} lvl',
  'lb.scoreWeek': '{n} ⭐',
  'lb.thisWeek': 'this week: {n} ⭐',
  'lb.rank': 'place {n}',
  'lb.noRank': 'no place yet',
  'lb.loading': 'Loading the table…',
  'lb.empty': 'The table is empty — be the first!',
  'lb.hidden': 'Player',
  'lb.disabled': 'The rating lives in Yandex Games — this table stays empty here.',
  'lb.unavailable': 'The rating tables are not connected to the platform yet.',
  'lb.unauthorized': 'Only players signed in to Yandex get into the table.',
  'lb.authorize': 'Sign in to Yandex',
  'lb.error': 'The rating did not answer — try refreshing later.',
  'lb.tooOften': 'Too many refreshes — this table stays cached for a couple of minutes.',
  'lb.noBoard': 'This table does not exist in the Developer Console:',
  'lb.sent': 'Sent to the rating: {n}',
  'lb.footer': 'Mastery points and stars come from your best runs and never go down.',
  'cloud.authorize': 'Sign in to Yandex',
  'cloud.justNow': 'just now',
  'cloud.minutesAgo': '{n} min ago',
  'pause.fullscreenOn': 'Fullscreen: on',
  'pause.fullscreenOff': 'Fullscreen: off',
  'result.win': 'Level cleared!',
  'result.lose': 'Out of moves',
  'result.reward': 'reward',
  'result.bestCombo': 'Best combo: ×{n}',
  'result.boostersUsed': 'Boosters used: {n}',
  'result.leftovers': '{n} left on the shelf — no pair left, the goal still counts',
  'result.golden': 'Golden triples: {n} · +{coins} coins',
  'result.bombs': 'Explosions: {n} · {removed} products removed',
  'result.masterPoints': '+{points} mastery points',
  'result.masterNotBetter': ' · not better than before',
  'result.masterTotal': '{total} total · rank “{rank}”',
  'result.newRank': 'New rank: {rank}!',
  'result.next': 'Next ▶',
  'result.masterDone': 'All master levels cleared',
  'result.toMaster': 'MASTER mode 👑',
  'result.tryAgain': 'Try again',
  'result.replay': 'Play again',
  'result.loseText': 'Try once more — there is always a lucky move on the shelves.',
  'result.masterWaiting': 'MASTER mode is waiting in the menu',
  'result.backToMap': 'To the map',
};

const DICTS: Record<Lang, Dict> = { ru: RU, en: EN };

/** World (theme) names shown in the header of the menu. */
const WORLD_EN: Record<string, string> = {
  Продукты: 'Groceries',
  Сладкое: 'Sweets',
  Книги: 'Books',
  Игрушки: 'Toys',
  Техника: 'Tech',
  Цветы: 'Flowers',
  Красота: 'Beauty',
  Универмаг: 'Department store',
};

/** Ranks of the master mode (see `data/master.ts`). */
const RANK_EN: Record<string, string> = {
  Стажёр: 'Trainee',
  Продавец: 'Shop assistant',
  'Старший продавец': 'Senior assistant',
  Управляющий: 'Manager',
  'Мастер полок': 'Shelf master',
};

let current: Lang = 'ru';
let source: LangSource = 'default';

export function getLang(): Lang {
  return current;
}

export function langSource(): LangSource {
  return source;
}

export function setLang(lang: Lang, from: LangSource = 'default'): void {
  current = lang;
  source = from;
}

/** English name of a world / of a master rank, `null` when there is none. */
export function translateWorld(name: string): string {
  if (current !== 'en') return name;
  return WORLD_EN[name] ?? name;
}

export function translateRank(name: string): string {
  if (current !== 'en') return name;
  return RANK_EN[name] ?? name;
}

/**
 * Looks a key up in the current language and falls back to Russian, so a
 * missing English string shows Russian text instead of a raw key.
 */
export function t(key: string, vars?: StringVars): string {
  const template = DICTS[current][key] ?? RU[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}
