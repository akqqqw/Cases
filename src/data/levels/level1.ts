import type { LevelConfig } from './types';

/**
 * Level 1 — five shelves, four familiar products, a short and forgiving first
 * win. The board is generated and verified to be solvable (par 7, budget 17).
 */
export const level1: LevelConfig = {
  id: 1,
  name: 'Первые полки',
  rows: 5,
  cols: 6,
  generator: {
    kind: 'scramble',
    seed: 1027,
    groups: [
      { type: 'apple', count: 6 },
      { type: 'bread', count: 3 },
      { type: 'milk', count: 3 },
      { type: 'cake', count: 3 },
    ],
    scrambleMoves: 7,
  },
  goal: { kind: 'clearAll' },
  moveLimit: 'auto',
  moveSlack: 1.3,
  hints: 3,
  undos: 3,
  coins: 30,
  tip: 'Собери три одинаковых товара рядом — они исчезнут',
  theme: 'grocery',
};
