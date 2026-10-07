/**
 * Shop catalogue: departments, product sets and interior presets.
 * The shop *develops the store* — every purchase is used by the game:
 *
 * - departments & sets widen the product assortment of generated levels;
 * - departments also give permanent bonuses (moves, hints, undos, coins);
 * - interior presets change the look of the shelves.
 */
export interface DecorPreset {
  id: string;
  /** Wall gradient. */
  wallTop: string;
  wallBottom: string;
  /** Shelf planks. */
  plank: string;
  plankLight: string;
  /** Bookcase body and its edges. */
  caseColor: string;
  caseLight: string;
  /** Cell wells and blocked cells. */
  well: string;
  blocked: string;
}

export interface ShopBonus {
  /** Extra moves added to every level budget. */
  bonusMoves?: number;
  /** Extra hints per level. */
  bonusHints?: number;
  /** Extra undos per level. */
  bonusUndos?: number;
  /** Coin reward multiplier, 0.15 = +15%. */
  coinBonus?: number;
}

export type ShopKind = 'department' | 'set' | 'decor';

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  description: string;
  price: number;
  /** Product shown as the shop card icon. */
  icon: string;
  /** Product types this purchase adds to the assortment. */
  items?: string[];
  bonus?: ShopBonus;
  decor?: DecorPreset;
  /** Becomes visible in the shop from this level (default: right away). */
  unlockLevel?: number;
}

const cozy: DecorPreset = {
  id: 'cozy',
  wallTop: '#f7e6c9',
  wallBottom: '#efd3ad',
  plank: '#b9814f',
  plankLight: '#d8a978',
  caseColor: '#b0794a',
  caseLight: '#d8a978',
  well: '#8a5a34',
  blocked: '#6b4a2e',
};

const mint: DecorPreset = {
  id: 'mint',
  wallTop: '#e4f6ee',
  wallBottom: '#c9e9dc',
  plank: '#79b39a',
  plankLight: '#a5d3c0',
  caseColor: '#4f8d76',
  caseLight: '#8dc4ae',
  well: '#3f7561',
  blocked: '#2f5b4a',
};

const night: DecorPreset = {
  id: 'night',
  wallTop: '#3b3560',
  wallBottom: '#2b2647',
  plank: '#6d64a8',
  plankLight: '#918ac9',
  caseColor: '#4a4377',
  caseLight: '#7a72b5',
  well: '#221d3d',
  blocked: '#171331',
};

const marble: DecorPreset = {
  id: 'marble',
  wallTop: '#f4f6fa',
  wallBottom: '#e2e7f0',
  plank: '#a9b6c9',
  plankLight: '#c9d4e2',
  caseColor: '#8b98ad',
  caseLight: '#b8c4d4',
  well: '#6c7a92',
  blocked: '#55617a',
};

const candyShop: DecorPreset = {
  id: 'candy',
  wallTop: '#ffe6f2',
  wallBottom: '#ffd0e4',
  plank: '#f291bd',
  plankLight: '#ffb8d8',
  caseColor: '#dc6fa0',
  caseLight: '#ffa8cd',
  well: '#b8507e',
  blocked: '#953f68',
};

const forest: DecorPreset = {
  id: 'forest',
  wallTop: '#eaf4dc',
  wallBottom: '#cfe6b6',
  plank: '#8fae63',
  plankLight: '#b6cf8f',
  caseColor: '#6c8a45',
  caseLight: '#a3bd7c',
  well: '#4f6a31',
  blocked: '#3c5225',
};

export const DECOR_PRESETS: Record<string, DecorPreset> = {
  cozy,
  mint,
  night,
  marble,
  candy: candyShop,
  forest,
};

export function decorPreset(id: string): DecorPreset {
  return DECOR_PRESETS[id] ?? cozy;
}

export const SHOP_ITEMS: ShopItem[] = [
  // ------------------------------------------------------------- отделы
  {
    id: 'dept-sweets',
    kind: 'department',
    name: 'Отдел «Сладкое»',
    description: 'Торты, пончики и конфеты на полках. +1 подсказка на уровень.',
    price: 220,
    icon: 'cake',
    items: ['cake', 'donut', 'candy'],
    bonus: { bonusHints: 1 },
    unlockLevel: 6,
  },
  {
    id: 'dept-books',
    kind: 'department',
    name: 'Отдел «Книги»',
    description: 'Книги, журналы и блокноты. +1 отмена на уровень.',
    price: 260,
    icon: 'book',
    items: ['book', 'magazine', 'notebook'],
    bonus: { bonusUndos: 1 },
    unlockLevel: 10,
  },
  {
    id: 'dept-toys',
    kind: 'department',
    name: 'Отдел «Игрушки»',
    description: 'Мишки, роботы и мячи. +2 хода на каждый уровень.',
    price: 320,
    icon: 'robot',
    items: ['bear', 'robot', 'ball'],
    bonus: { bonusMoves: 2 },
    unlockLevel: 14,
  },
  {
    id: 'dept-tech',
    kind: 'department',
    name: 'Отдел «Техника»',
    description: 'Гаджеты на витрине. +15% монет за уровень.',
    price: 380,
    icon: 'phone',
    items: ['phone', 'headphones', 'camera'],
    bonus: { coinBonus: 0.15 },
    unlockLevel: 20,
  },
  {
    id: 'dept-flowers',
    kind: 'department',
    name: 'Отдел «Цветы»',
    description: 'Живые цветы и кактусы. +1 подсказка и +1 отмена.',
    price: 420,
    icon: 'flower',
    items: ['flower', 'cactus', 'tulip'],
    bonus: { bonusHints: 1, bonusUndos: 1 },
    unlockLevel: 28,
  },
  {
    id: 'dept-beauty',
    kind: 'department',
    name: 'Отдел «Красота»',
    description: 'Ароматы, свечи и мыло. +20% монет за уровень.',
    price: 460,
    icon: 'perfume',
    items: ['perfume', 'candle', 'soap'],
    bonus: { coinBonus: 0.2 },
    unlockLevel: 34,
  },

  // -------------------------------------------------- тематические наборы
  {
    id: 'set-bakery',
    kind: 'set',
    name: 'Набор «Пекарня»',
    description: 'Свежая выпечка и напитки в ассортименте.',
    price: 140,
    icon: 'bread',
    items: ['bread', 'cheese', 'coffee'],
    unlockLevel: 4,
  },
  {
    id: 'set-drinks',
    kind: 'set',
    name: 'Набор «Напитки»',
    description: 'Молоко, сок и кофе — всегда рядом.',
    price: 180,
    icon: 'juice',
    items: ['milk', 'juice', 'coffee'],
    unlockLevel: 8,
  },
  {
    id: 'set-stationery',
    kind: 'set',
    name: 'Набор «Канцелярия»',
    description: 'Блокноты и журналы для офисной полки.',
    price: 200,
    icon: 'notebook',
    items: ['notebook', 'magazine', 'book'],
    unlockLevel: 12,
  },
  {
    id: 'set-kids',
    kind: 'set',
    name: 'Набор «Детский»',
    description: 'Игрушки и сладости в одном наборе.',
    price: 240,
    icon: 'bear',
    items: ['bear', 'ball', 'candy'],
    unlockLevel: 18,
  },
  {
    id: 'set-garden',
    kind: 'set',
    name: 'Набор «Сад»',
    description: 'Растения и ароматы для уютной полки.',
    price: 280,
    icon: 'tulip',
    items: ['tulip', 'cactus', 'flower'],
    unlockLevel: 26,
  },
  {
    id: 'set-home',
    kind: 'set',
    name: 'Набор «Дом»',
    description: 'Свечи, мыло и духи в ассортименте.',
    price: 300,
    icon: 'candle',
    items: ['candle', 'soap', 'perfume'],
    unlockLevel: 32,
  },

  // ------------------------------------------------------------ оформление
  {
    id: 'decor-cozy',
    kind: 'decor',
    name: 'Оформление «Уют»',
    description: 'Тёплое дерево и кремовые стены.',
    price: 0,
    icon: 'apple',
    decor: cozy,
  },
  {
    id: 'decor-mint',
    kind: 'decor',
    name: 'Оформление «Мята»',
    description: 'Свежий зелёный зал.',
    price: 120,
    icon: 'cactus',
    decor: mint,
    unlockLevel: 3,
  },
  {
    id: 'decor-marble',
    kind: 'decor',
    name: 'Оформление «Мрамор»',
    description: 'Светлый торговый центр.',
    price: 180,
    icon: 'soap',
    decor: marble,
    unlockLevel: 9,
  },
  {
    id: 'decor-candy',
    kind: 'decor',
    name: 'Оформление «Карамель»',
    description: 'Розовый зал со сладкими полками.',
    price: 240,
    icon: 'donut',
    decor: candyShop,
    unlockLevel: 16,
  },
  {
    id: 'decor-forest',
    kind: 'decor',
    name: 'Оформление «Лес»',
    description: 'Деревянные полки и зелёные стены.',
    price: 300,
    icon: 'tulip',
    decor: forest,
    unlockLevel: 24,
  },
  {
    id: 'decor-night',
    kind: 'decor',
    name: 'Оформление «Ночь»',
    description: 'Вечерняя смена при мягком свете.',
    price: 360,
    icon: 'candle',
    decor: night,
    unlockLevel: 38,
  },
];

export const SHOP_BY_ID: Record<string, ShopItem> = Object.fromEntries(
  SHOP_ITEMS.map((item) => [item.id, item]),
);

export const FREE_DECOR_ID = 'decor-cozy';

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_BY_ID[id];
}

export function shopItemsOfKind(kind: ShopKind, unlockedLevel: number): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.kind === kind && (item.unlockLevel ?? 0) <= unlockedLevel);
}

export const EMPTY_BONUS: Required<ShopBonus> = {
  bonusMoves: 0,
  bonusHints: 0,
  bonusUndos: 0,
  coinBonus: 0,
};

/** Sums the bonuses of everything the player owns. */
export function ownedBonus(owned: string[]): Required<ShopBonus> {
  const total = { ...EMPTY_BONUS };
  for (const id of owned) {
    const bonus = SHOP_BY_ID[id]?.bonus;
    if (!bonus) continue;
    total.bonusMoves += bonus.bonusMoves ?? 0;
    total.bonusHints += bonus.bonusHints ?? 0;
    total.bonusUndos += bonus.bonusUndos ?? 0;
    total.coinBonus += bonus.coinBonus ?? 0;
  }
  return total;
}

/** Product types unlocked by the shops the player bought. */
export function ownedItemTypes(owned: string[]): string[] {
  const types = new Set<string>();
  for (const id of owned) for (const item of SHOP_BY_ID[id]?.items ?? []) types.add(item);
  return [...types];
}

/** Purchases that make sense to show for the current progress. */
export function availableShopItems(owned: string[], unlockedLevel: number): ShopItem[] {
  const ownedSet = new Set(owned);
  return SHOP_ITEMS.filter(
    (item) => !ownedSet.has(item.id) && (item.unlockLevel ?? 0) <= unlockedLevel,
  );
}

export function totalShopPrice(): number {
  return SHOP_ITEMS.reduce((sum, item) => sum + item.price, 0);
}
