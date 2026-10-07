import { ICONS } from './iconShapes';

export type ItemCategory = 'food' | 'drinks' | 'sweets' | 'toys' | 'electronics' | 'books' | 'flowers' | 'home';

export interface ItemDef {
  id: string;
  /** Russian display name used in tooltips and the shop. */
  name: string;
  category: ItemCategory;
  /** Colour of the product tile behind the icon. */
  tile: string;
  /** Colour used by particles and highlights. */
  accent: string;
}

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  food: 'Еда',
  drinks: 'Напитки',
  sweets: 'Сладкое',
  toys: 'Игрушки',
  electronics: 'Электроника',
  books: 'Книги',
  flowers: 'Цветы',
  home: 'Дом и красота',
};

export const ITEMS: Record<string, ItemDef> = {
  apple: { id: 'apple', name: 'Яблоко', category: 'food', tile: '#fff1e0', accent: '#e5484d' },
  bread: { id: 'bread', name: 'Батон', category: 'food', tile: '#fff1e0', accent: '#d9a05b' },
  cheese: { id: 'cheese', name: 'Сыр', category: 'food', tile: '#fff1e0', accent: '#f6c445' },

  milk: { id: 'milk', name: 'Молоко', category: 'drinks', tile: '#e8f3ff', accent: '#4a90e2' },
  juice: { id: 'juice', name: 'Сок', category: 'drinks', tile: '#e8f3ff', accent: '#f28c28' },
  coffee: { id: 'coffee', name: 'Кофе', category: 'drinks', tile: '#e8f3ff', accent: '#6b4226' },

  cake: { id: 'cake', name: 'Тортик', category: 'sweets', tile: '#ffe9f3', accent: '#f06292' },
  donut: { id: 'donut', name: 'Пончик', category: 'sweets', tile: '#ffe9f3', accent: '#f7a1c4' },
  candy: { id: 'candy', name: 'Конфета', category: 'sweets', tile: '#ffe9f3', accent: '#7e57c2' },

  bear: { id: 'bear', name: 'Мишка', category: 'toys', tile: '#fff6d9', accent: '#c08a4a' },
  robot: { id: 'robot', name: 'Робот', category: 'toys', tile: '#fff6d9', accent: '#8a94a6' },
  ball: { id: 'ball', name: 'Мяч', category: 'toys', tile: '#fff6d9', accent: '#6ec1e4' },

  phone: { id: 'phone', name: 'Смартфон', category: 'electronics', tile: '#eaeff5', accent: '#6ec1e4' },
  headphones: { id: 'headphones', name: 'Наушники', category: 'electronics', tile: '#eaeff5', accent: '#4a90e2' },
  camera: { id: 'camera', name: 'Фотоаппарат', category: 'electronics', tile: '#eaeff5', accent: '#3a4552' },

  book: { id: 'book', name: 'Книга', category: 'books', tile: '#f3ece0', accent: '#2f7d5d' },
  magazine: { id: 'magazine', name: 'Журнал', category: 'books', tile: '#f3ece0', accent: '#f2c14e' },
  notebook: { id: 'notebook', name: 'Блокнот', category: 'books', tile: '#f3ece0', accent: '#e5484d' },

  flower: { id: 'flower', name: 'Цветок', category: 'flowers', tile: '#eef7e6', accent: '#f48fb1' },
  cactus: { id: 'cactus', name: 'Кактус', category: 'flowers', tile: '#eef7e6', accent: '#4caf50' },
  tulip: { id: 'tulip', name: 'Тюльпан', category: 'flowers', tile: '#eef7e6', accent: '#ef5350' },

  perfume: { id: 'perfume', name: 'Духи', category: 'home', tile: '#f1e9fb', accent: '#c8a2f0' },
  candle: { id: 'candle', name: 'Свеча', category: 'home', tile: '#f1e9fb', accent: '#ffb648' },
  soap: { id: 'soap', name: 'Мыло', category: 'home', tile: '#f1e9fb', accent: '#8fd6d0' },
};

export const ITEM_IDS = Object.keys(ITEMS);
export const ITEM_COUNT = ITEM_IDS.length;

export function getItem(id: string): ItemDef {
  const item = ITEMS[id];
  if (!item) throw new Error(`unknown item type "${id}"`);
  return item;
}

export function itemAccent(id: string): string {
  return ITEMS[id]?.accent ?? ICONS[id]?.accent ?? '#ffffff';
}

export function itemsByCategory(category: ItemCategory): ItemDef[] {
  return Object.values(ITEMS).filter((item) => item.category === category);
}
