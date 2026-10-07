/**
 * Level themes: a shelf world with its own product pool and level names.
 * Themes drive the automatic level configuration (see `levels/campaign.ts`).
 */
export interface ThemeDef {
  id: string;
  name: string;
  /** Product types used by generated levels of this theme. */
  items: string[];
  /** Level names, picked deterministically by level id. */
  names: string[];
}

export const THEMES: Record<string, ThemeDef> = {
  grocery: {
    id: 'grocery',
    name: 'Продукты',
    items: ['apple', 'bread', 'cheese', 'milk', 'juice'],
    names: ['Свежий прилавок', 'Хлебный ряд', 'Молочная витрина', 'Фруктовая полка'],
  },
  sweets: {
    id: 'sweets',
    name: 'Сладкое',
    items: ['cake', 'donut', 'candy', 'milk', 'coffee'],
    names: ['Витрина сладостей', 'Пончиковый ряд', 'Конфетная полка', 'Чайный уголок'],
  },
  books: {
    id: 'books',
    name: 'Книги',
    items: ['book', 'magazine', 'notebook', 'coffee', 'cactus'],
    names: ['Книжный развал', 'Журнальная стойка', 'Полка канцелярии', 'Читальный уголок'],
  },
  toys: {
    id: 'toys',
    name: 'Игрушки',
    items: ['bear', 'robot', 'ball', 'candy', 'magazine'],
    names: ['Мягкая полка', 'Роботы и мячи', 'Детский ряд', 'Игровая витрина'],
  },
  tech: {
    id: 'tech',
    name: 'Техника',
    items: ['phone', 'headphones', 'camera', 'notebook', 'juice'],
    names: ['Витрина гаджетов', 'Аудио-ряд', 'Фотоуголок', 'Техно-полка'],
  },
  florist: {
    id: 'florist',
    name: 'Цветы',
    items: ['flower', 'cactus', 'tulip', 'perfume', 'candle'],
    names: ['Цветочная лавка', 'Кактусовый ряд', 'Тюльпанная витрина', 'Весенняя полка'],
  },
  beauty: {
    id: 'beauty',
    name: 'Красота',
    items: ['perfume', 'candle', 'soap', 'flower', 'tulip'],
    names: ['Полка ароматов', 'Свечной уголок', 'Спа-витрина', 'Уютный ряд'],
  },
  market: {
    id: 'market',
    name: 'Универмаг',
    items: [
      'apple', 'bread', 'cheese', 'milk', 'juice', 'coffee',
      'cake', 'donut', 'candy',
      'bear', 'robot', 'ball',
      'phone', 'headphones', 'camera',
      'book', 'magazine', 'notebook',
      'flower', 'cactus', 'tulip',
      'perfume', 'candle', 'soap',
    ],
    names: ['Универмаг: первый этаж', 'Универмаг: витрины', 'Универмаг: вечерняя смена', 'Универмаг: всё сразу'],
  },
};

export const THEME_IDS = Object.keys(THEMES);

/** Theme that owns a level id (campaign layout: 8 levels per theme). */
export const THEMES_PER_LEVELS = 8;

export function themeForLevel(levelId: number): ThemeDef {
  const order = ['grocery', 'sweets', 'books', 'toys', 'tech', 'florist', 'beauty', 'market'];
  const index = Math.min(order.length - 1, Math.max(0, Math.floor((levelId - 1) / THEMES_PER_LEVELS)));
  return THEMES[order[index] as string] as ThemeDef;
}
