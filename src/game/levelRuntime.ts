import { cloneBoard, frozenIndices, isEmptyCell, itemCount, thawAll } from '../core/board';
import {
  EXTRA_MOVES,
  canHammer,
  hammerCell,
  leftoverTypes,
  shuffleItems,
  type BoosterRejectReason,
  type HammerResult,
  type ShuffleResult,
} from '../core/boosters';
import { generateBoard, GenerationError } from '../core/generate';
import {
  advanceCombo,
  comboBonus,
  isCleanRun,
  movesLeftBonus,
  rewardLines,
  starTitle,
  starsForRun,
  CLEAN_RUN_BONUS,
  EMPTY_COMBO,
  type ComboState,
  type RewardLine,
  type RunSummary,
} from '../core/combo';
import { createGoalState, updateGoalState, type GoalState, type StarThresholds } from '../core/goal';
import { MATCH_LENGTH } from '../core/match';
import { applyMove } from '../core/moves';
import { hasBomb, hasGolden } from '../core/specials';
import type { BoardState, MoveResult } from '../core/types';
import { autoMoveLimit, autoStars } from '../data/levels/auto';
import { SHOP_POOL_FROM_LEVEL } from '../data/levels/campaign';
import type { LevelConfig } from '../data/levels/types';
import type { MasterAward } from '../data/master';
import { level1 } from '../data/levels/level1';
import { EMPTY_BONUS, type ShopBonus } from '../data/shop';

export type LevelStatus = 'playing' | 'won' | 'lost';

/** Coins and moves paid for collecting a golden triple. */
export const GOLDEN_COINS = 2;
export const GOLDEN_MOVES = 1;
/** Product triples that melt the ice when the level asks for it. */
export const DEFAULT_ICE_MELT_AFTER = 3;

export interface LevelRuntime {
  config: LevelConfig;
  board: BoardState;
  goal: GoalState;
  moveLimit: number;
  movesLeft: number;
  /** Verified solution length (bonus info for the HUD / debug). */
  par: number;
  stars: StarThresholds;
  /** Board snapshots, newest last — powers "undo". */
  history: BoardState[];
  hintsLeft: number;
  undosLeft: number;
  status: LevelStatus;
  /** Golden triples collected so far. */
  goldenCollected: number;
  /** Bomb triples detonated so far. */
  bombsDetonated: number;
  /** Product triples collected in total (drives the ice melting). */
  triplesCollected: number;
  /** `true` once the ice melted (or when the level has no ice). */
  iceMelted: boolean;
  /** Coins earned on top of the level reward (golden triples + combos). */
  bonusCoins: number;
  /** Current and best combo run of the level. */
  combo: ComboState;
  /** Coins earned by combos alone. */
  comboCoins: number;
  /** Hints spent on this attempt (breaks the "perfect run"). */
  hintsUsed: number;
  /** Undos spent on this attempt. */
  undosUsed: number;
  /** Boosters used on this attempt (also breaks the "perfect run"). */
  boostersUsed: number;
  /** Guards against a level config that cannot be generated. */
  warning?: string;
}

export interface RuntimeOptions {
  /** Permanent bonuses bought in the shop. */
  bonus?: Required<ShopBonus>;
  /** Product types unlocked in the shop (kept for levels from id 15). */
  extraTypes?: string[];
}

interface GenerationResult {
  board: BoardState;
  par: number;
  warning?: string;
}

/**
 * Levels use the shop assortment from level 15 on: one product of the level is
 * swapped for a product the player bought, so purchases visibly change the game
 * without touching the level balance (the item count stays the same).
 */
export function applyShopAssortment(config: LevelConfig, extraTypes: string[]): LevelConfig {
  if (extraTypes.length === 0 || config.id < SHOP_POOL_FROM_LEVEL) return config;
  if (config.generator.kind !== 'scramble') return config;

  const generator = config.generator;
  const present = new Set(generator.groups.map((group) => group.type));
  const replacement = extraTypes.find((type) => !present.has(type));
  if (!replacement) return config;

  // The rarest product gives way to the new arrival.
  let weakest = 0;
  generator.groups.forEach((group, index) => {
    const current = generator.groups[weakest];
    if (current && group.count < current.count) weakest = index;
  });

  const groups = generator.groups.map((group, index) =>
    index === weakest ? { type: replacement, count: group.count } : group,
  );
  const weakestType = generator.groups[weakest]?.type;
  const remap = <T extends { type: string }>(groups: T[] | undefined): T[] | undefined =>
    groups?.map((group) => (group.type === weakestType ? { ...group, type: replacement } : group));

  const golden = remap(generator.golden);
  const bombs = remap(generator.bombs);

  return {
    ...config,
    generator: {
      ...generator,
      groups,
      ...(golden ? { golden } : {}),
      ...(bombs ? { bombs } : {}),
    },
  };
}

function safeGenerate(config: LevelConfig): GenerationResult {
  try {
    const generated = generateBoard(config.rows, config.cols, config.generator, { goal: config.goal });
    if (!generated.solvable) throw new GenerationError('no verified solution');
    return { board: generated.board, par: generated.par };
  } catch (error) {
    // Extremely unlikely — every shipped level is verified by the test suite —
    // but a broken config must never leave the player with a dead screen.
    const base = level1.generator;
    const generator = base.kind === 'scramble' ? { ...base, seed: base.seed + config.id } : base;
    const fallback = generateBoard(level1.rows, level1.cols, generator, { allowUnverified: true });
    return {
      board: fallback.board,
      par: fallback.par,
      warning: `Уровень ${config.id} не удалось собрать (${String(error)}), играем запасной`,
    };
  }
}

export function createLevelRuntime(config: LevelConfig, options: RuntimeOptions = {}): LevelRuntime {
  const bonus = options.bonus ?? EMPTY_BONUS;
  const effective = applyShopAssortment(config, options.extraTypes ?? []);
  const { board, par, warning } = safeGenerate(effective);

  const baseLimit =
    config.moveLimit === undefined || config.moveLimit === 'auto'
      ? autoMoveLimit(par, config.moveSlack ?? 0.9)
      : config.moveLimit;
  const moveLimit = baseLimit + bonus.bonusMoves;

  return {
    config: effective,
    board,
    goal: createGoalState(board, config.goal),
    moveLimit,
    movesLeft: moveLimit,
    par,
    stars: config.stars ?? autoStars(moveLimit),
    history: [],
    // A master level can forbid hints altogether — bought bonuses included.
    hintsLeft: config.noHints ? 0 : (config.hints ?? 3) + bonus.bonusHints,
    undosLeft: (config.undos ?? 3) + bonus.bonusUndos,
    status: 'playing',
    goldenCollected: 0,
    bombsDetonated: 0,
    triplesCollected: 0,
    iceMelted: frozenIndices(board).length === 0,
    bonusCoins: 0,
    combo: { ...EMPTY_COMBO },
    comboCoins: 0,
    hintsUsed: 0,
    undosUsed: 0,
    boostersUsed: 0,
    ...(warning ? { warning } : {}),
  };
}

export interface MoveOutcome {
  runtime: LevelRuntime;
  result: MoveResult;
  /** `true` when this move collected a golden triple (bonus move + coins). */
  golden: boolean;
  /** `true` when this move detonated a bomb triple. */
  bomb: boolean;
  /** `true` when the ice melted right after this move. */
  iceMelted: boolean;
  /** Combo run after this move (0 = the run was broken). */
  combo: number;
  /** Coins this move paid for the combo. */
  comboCoins: number;
}

/** Applies a player move, spending one move and refreshing the goal. */
export function playMove(runtime: LevelRuntime, from: number, to: number): MoveOutcome {
  const result = applyMove(runtime.board, from, to);
  if (!result.ok) return { runtime, result, golden: false, bomb: false, iceMelted: false, combo: 0, comboCoins: 0 };
  if (runtime.status !== 'playing') {
    return { runtime, result, golden: false, bomb: false, iceMelted: false, combo: 0, comboCoins: 0 };
  }

  const golden = hasGolden(result.cleared);
  const bomb = hasBomb(result.cleared);
  // One collected triple per match plus one per blast (a blast is a full triple
  // of products on its own), never counting a move that cleared nothing.
  const triples = (result.match ? 1 : 0) + (result.blast ? 1 : 0);
  const triplesCollected = runtime.triplesCollected + triples;

  // Combo: each collected triple extends the run, an empty move breaks it.
  const combo = advanceCombo(runtime.combo, triples);
  const comboPayout = comboBonus(combo.streak);

  // Ice melts after a few collected triples — a rescue for the player and a
  // visible reward for progress on the level.
  const meltAfter = runtime.config.iceMeltAfter ?? DEFAULT_ICE_MELT_AFTER;
  const shouldMelt = !runtime.iceMelted && triplesCollected >= meltAfter;
  const board = shouldMelt ? thawAll(result.board) : result.board;

  const goal = updateGoalState(runtime.goal, board);
  const movesLeft = Math.max(0, runtime.movesLeft - 1) + (golden ? GOLDEN_MOVES : 0);
  const status: LevelStatus = goal.done ? 'won' : movesLeft <= 0 ? 'lost' : 'playing';

  return {
    result,
    golden,
    bomb,
    iceMelted: shouldMelt,
    combo: combo.streak,
    comboCoins: comboPayout,
    runtime: {
      ...runtime,
      board,
      goal,
      movesLeft,
      status,
      history: [...runtime.history, cloneBoard(runtime.board)],
      goldenCollected: runtime.goldenCollected + (golden ? 1 : 0),
      bombsDetonated: runtime.bombsDetonated + (bomb ? 1 : 0),
      triplesCollected,
      iceMelted: runtime.iceMelted || shouldMelt,
      combo,
      comboCoins: runtime.comboCoins + comboPayout,
      bonusCoins: runtime.bonusCoins + (golden ? GOLDEN_COINS : 0) + comboPayout,
    },
  };
}

/** Steps one move back (refunds the move). */
export function undoMove(runtime: LevelRuntime): LevelRuntime {
  const previous = runtime.history[runtime.history.length - 1];
  if (!previous || runtime.undosLeft <= 0 || runtime.status !== 'playing') return runtime;

  return {
    ...runtime,
    board: previous,
    goal: updateGoalState(runtime.goal, previous),
    history: runtime.history.slice(0, -1),
    movesLeft: Math.min(runtime.moveLimit, runtime.movesLeft + 1),
    undosLeft: runtime.undosLeft - 1,
    undosUsed: runtime.undosUsed + 1,
    // stepping back breaks the run: the combo is about playing forward
    combo: { ...runtime.combo, streak: 0 },
    status: 'playing',
  };
}

export function spendHint(runtime: LevelRuntime): LevelRuntime {
  if (runtime.hintsLeft <= 0) return runtime;
  return { ...runtime, hintsLeft: runtime.hintsLeft - 1, hintsUsed: runtime.hintsUsed + 1 };
}

export interface BoosterOutcome {
  runtime: LevelRuntime;
  ok: boolean;
  /** Set when the booster could not be used. */
  reason?: BoosterRejectReason;
  /** Set for the hammer: what it destroyed and what became unmatchable. */
  hammer?: HammerResult;
  /** Set for the shuffle: how the products moved. */
  shuffle?: ShuffleResult;
  /** Set for the extra-move booster. */
  movesAdded?: number;
}

/**
 * Applies a booster to a running level. Boosters never spend moves and never
 * touch `history`, so undo/redo semantics stay exactly as they were — a booster
 * is an assist, not a move. They do lower the run to "helped", which costs the
 * perfect star (see `combo.ts`).
 */
export function useHammer(runtime: LevelRuntime, index: number): BoosterOutcome {
  if (runtime.status !== 'playing') return { runtime, ok: false, reason: 'not-playing' };

  const reason = canHammer(runtime.board, index);
  if (reason) return { runtime, ok: false, reason };

  const hammer = hammerCell(runtime.board, index);
  if (!hammer) return { runtime, ok: false, reason: 'empty-cell' };

  const board = hammer.board;
  const goal = updateGoalState(runtime.goal, board);
  const status: LevelStatus = goal.done ? 'won' : 'playing';

  return {
    ok: true,
    hammer,
    runtime: {
      ...runtime,
      board,
      goal,
      status,
      boostersUsed: runtime.boostersUsed + 1,
    },
  };
}

export function useShuffle(runtime: LevelRuntime, rng: () => number): BoosterOutcome {
  if (runtime.status !== 'playing') return { runtime, ok: false, reason: 'not-playing' };

  const shuffle = shuffleItems(runtime.board, rng);
  if (!shuffle) return { runtime, ok: false, reason: 'nothing-to-shuffle' };

  return {
    ok: true,
    shuffle,
    runtime: {
      ...runtime,
      board: shuffle.board,
      goal: updateGoalState(runtime.goal, shuffle.board),
      boostersUsed: runtime.boostersUsed + 1,
    },
  };
}

export function useExtraMoves(runtime: LevelRuntime): BoosterOutcome {
  if (runtime.status !== 'playing') return { runtime, ok: false, reason: 'not-playing' };

  return {
    ok: true,
    movesAdded: EXTRA_MOVES,
    runtime: {
      ...runtime,
      movesLeft: runtime.movesLeft + EXTRA_MOVES,
      // the budget grows as well, so `movesUsed` can never go negative and the
      // extra moves do not silently change the star thresholds
      moveLimit: runtime.moveLimit + EXTRA_MOVES,
      boostersUsed: runtime.boostersUsed + 1,
    },
  };
}

/**
 * Revives a lost level after a rewarded video: the budget grows exactly like
 * with the "extra moves" booster, so the star thresholds stay untouched and the
 * run can never turn into a 3-star win for free (it counts as a booster used).
 */
export function reviveRuntime(runtime: LevelRuntime): BoosterOutcome {
  if (runtime.status !== 'lost') return { runtime, ok: false, reason: 'not-playing' };

  return {
    ok: true,
    movesAdded: EXTRA_MOVES,
    runtime: {
      ...runtime,
      movesLeft: runtime.movesLeft + EXTRA_MOVES,
      moveLimit: runtime.moveLimit + EXTRA_MOVES,
      status: 'playing',
      boostersUsed: runtime.boostersUsed + 1,
    },
  };
}

/** Free undo: one more undo charge, usable whenever the player needs it. */
export function useFreeUndo(runtime: LevelRuntime): BoosterOutcome {
  if (runtime.status !== 'playing') return { runtime, ok: false, reason: 'not-playing' };

  return {
    ok: true,
    runtime: {
      ...runtime,
      undosLeft: runtime.undosLeft + 1,
      boostersUsed: runtime.boostersUsed + 1,
    },
  };
}

export interface LevelOutcome {
  status: LevelStatus;
  stars: number;
  /** ⭐ Победа / ⭐⭐ Хорошее прохождение / ⭐⭐⭐ Идеальное прохождение. */
  starTitle: string;
  coins: number;
  movesUsed: number;
  matches: number;
  golden: number;
  bombs: number;
  /** Longest combo run of the attempt. */
  comboBest: number;
  /** Coins the combos paid during the attempt. */
  comboCoins: number;
  /** Boosters used during the attempt. */
  boostersUsed: number;
  /** Products left on the shelf that can no longer be matched (boosted runs). */
  leftovers: number;
  /** `true` when the level was finished without hints and without undos. */
  clean: boolean;
  /** Coin breakdown shown on the result screen. */
  rewards: RewardLine[];
  /** Master mode: crowns and mastery points paid for this run. */
  mastery?: MasterAward;
}

/** Everything the star rules look at, derived from the current runtime. */
export function runSummary(runtime: LevelRuntime): RunSummary {
  return {
    movesLeft: runtime.movesLeft,
    moveLimit: runtime.moveLimit,
    par: runtime.par,
    hintsUsed: runtime.hintsUsed,
    undosUsed: runtime.undosUsed,
    boostersUsed: runtime.boostersUsed,
    comboBest: runtime.combo.best,
  };
}

/**
 * Rewards for a finished level: base coins, star bonus, combos, golden triples,
 * a clean-run bonus, coins for every unused move and the shop multiplier.
 */
export function levelOutcome(runtime: LevelRuntime, options: RuntimeOptions = {}): LevelOutcome {
  const bonus = options.bonus ?? EMPTY_BONUS;
  const summary = runSummary(runtime);
  const won = runtime.status === 'won';
  const stars = won ? starsForRun(summary, runtime.stars) : 0;
  const base = runtime.config.coins ?? 10 + runtime.config.id * 2;
  const clean = isCleanRun(summary);

  const rewards = won
    ? rewardLines({
        stars,
        movesLeft: runtime.movesLeft,
        goldenCoins: runtime.goldenCollected * GOLDEN_COINS,
        comboCoins: runtime.comboCoins,
        clean,
        baseCoins: base,
      })
    : [];

  const raw = won ? rewards.reduce((sum, line) => sum + line.coins, 0) : 0;

  return {
    status: runtime.status,
    stars,
    starTitle: won ? starTitle(stars) : '',
    coins: Math.round(raw * (1 + bonus.coinBonus)),
    movesUsed: runtime.moveLimit - runtime.movesLeft,
    matches: runtime.goal.removedTotal / MATCH_LENGTH,
    golden: runtime.goldenCollected,
    bombs: runtime.bombsDetonated,
    comboBest: runtime.combo.best,
    comboCoins: runtime.comboCoins,
    boostersUsed: runtime.boostersUsed,
    leftovers:
      runtime.config.goal.kind === 'clearAll'
        ? leftoverTypes(runtime.board).reduce((sum, entry) => sum + entry.count, 0)
        : 0,
    clean,
    rewards,
  };
}

/** Coins a clean run and leftover moves are worth (for the HUD tip). */
export { CLEAN_RUN_BONUS, movesLeftBonus };

/** Items still standing on the shelves (for the HUD hint). */
export function itemsLeft(runtime: LevelRuntime): number {
  return itemCount(runtime.board);
}

export function hasFreeCell(runtime: LevelRuntime): boolean {
  return runtime.board.cells.some((cell) => !cell.locked && isEmptyCell(cell));
}
