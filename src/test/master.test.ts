import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_MASTERY,
  MASTER_ID_BASE,
  MASTER_LEVEL_IDS,
  MASTER_MODIFIERS,
  MASTER_MODIFIER_BY_ID,
  MASTER_RANKS,
  MASTER_SLACK,
  awardMastery,
  baseLevelIdFor,
  buildMasterLevel,
  crownsForStars,
  isMasterLevel,
  masterHasNext,
  masterIdFor,
  masterModifier,
  masterModifiersFor,
  masterRank,
  masterRankProgress,
  masterUnlocked,
  masteryPointsFor,
  masteryTotal,
  nextMasterRank,
  totalCrowns,
} from '../data/master';
import { CAMPAIGN_SIZE } from '../data/levels/campaign';
import { getLevel } from '../data/levels';
import { generateBoard } from '../core/generate';
import { createGoalState } from '../core/goal';
import { planSolution } from '../core/solver';
import { createLevelRuntime, levelOutcome } from '../game/levelRuntime';
import { useGameStore } from '../store/gameStore';
import { migrateMastery } from '../store/persistence';
import { findHint } from '../core/solver';

const findMasterHint = (): { from: number; to: number } | null => {
  const runtime = useGameStore.getState().runtime;
  if (!runtime) return null;
  return findHint(runtime.board, { goal: runtime.goal });
};

describe('master modifiers', () => {
  it('describes every modifier with an id, a title and a note', () => {
    const ids = MASTER_MODIFIERS.map((modifier) => modifier.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['slow', 'no-hints', 'ice', 'locked', 'specials']);

    for (const modifier of MASTER_MODIFIERS) {
      expect(modifier.title.length).toBeGreaterThan(0);
      expect(modifier.note.length).toBeGreaterThan(0);
      expect(modifier.icon.length).toBeGreaterThan(0);
      expect(MASTER_MODIFIER_BY_ID[modifier.id]).toBe(modifier);
      expect(masterModifier(modifier.id)).toBe(modifier);
    }
    expect(masterModifier('nonsense')).toBeUndefined();
  });

  it('never touches the source level', () => {
    const base = getLevel(30) as NonNullable<ReturnType<typeof getLevel>>;
    const before = JSON.stringify(base);

    for (const modifier of MASTER_MODIFIERS) modifier.apply(base);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('makes a level harder, never easier', () => {
    const base = getLevel(44) as NonNullable<ReturnType<typeof getLevel>>;
    const frozen = base.generator.kind === 'scramble' ? Number(base.generator.frozen ?? 0) : 0;
    const locked = base.generator.kind === 'scramble' && Array.isArray(base.generator.locked)
      ? base.generator.locked.length
      : 0;

    const slow = MASTER_MODIFIER_BY_ID.slow.apply(base);
    expect(slow.moveLimit).toBe('auto');
    expect(slow.moveSlack).toBe(MASTER_SLACK);
    expect(MASTER_SLACK).toBeLessThan(base.moveSlack ?? 1);

    const noHints = MASTER_MODIFIER_BY_ID['no-hints'].apply(base);
    expect(noHints.noHints).toBe(true);
    expect(noHints.hints).toBe(0);

    const icy = MASTER_MODIFIER_BY_ID.ice.apply(base);
    expect(icy.generator.kind).toBe('scramble');
    expect(Number(icy.generator.kind === 'scramble' ? icy.generator.frozen : 0)).toBeGreaterThan(frozen);

    const blocky = MASTER_MODIFIER_BY_ID.locked.apply(base);
    expect(blocky.generator.kind).toBe('scramble');
    expect((blocky.generator.kind === 'scramble' ? blocky.generator.locked : []) as unknown as number[]).toHaveLength(
      locked + 1,
    );

    const special = MASTER_MODIFIER_BY_ID.specials.apply(base);
    expect(special.generator.kind).toBe('scramble');
    const triples = special.generator.kind === 'scramble' ? special.generator.golden ?? [] : [];
    expect(triples.reduce((sum, group) => sum + group.count, 0)).toBeGreaterThan(0);
  });

  it('skips a modifier the level generator cannot take', () => {
    // hand written layouts are not in the registry any more, but a future level
    // may be one — the modifiers must never break such a config
    const layout = {
      ...(getLevel(2) as NonNullable<ReturnType<typeof getLevel>>),
      generator: {
        kind: 'layout' as const,
        rows: ['a a a ..', 'b b b ..'],
        palette: { a: 'apple' as const, b: 'bread' as const },
      },
    };
    expect(layout.generator.kind).toBe('layout');

    expect(MASTER_MODIFIER_BY_ID.ice.canApply(layout)).toBe(false);
    expect(MASTER_MODIFIER_BY_ID.ice.apply(layout)).toBe(layout);
    expect(MASTER_MODIFIER_BY_ID.locked.canApply(layout)).toBe(false);
    expect(MASTER_MODIFIER_BY_ID.specials.canApply(layout)).toBe(false);

    // «fewer moves» and «no hints» work for any level kind
    expect(MASTER_MODIFIER_BY_ID.slow.canApply(layout)).toBe(true);
    expect(MASTER_MODIFIER_BY_ID['no-hints'].apply(layout).noHints).toBe(true);
  });

  it('picks the same modifiers for the same level, and more of them later', () => {
    for (const id of [2, 17, 30, 45, 60]) {
      const first = masterModifiersFor(id).map((modifier) => modifier.id);
      const again = masterModifiersFor(id).map((modifier) => modifier.id);
      expect(first).toEqual(again);
      expect(first[0]).toBe('slow');
      expect(first[1]).toBe('no-hints');
      expect(new Set(first).size).toBe(first.length);
      expect(first.length).toBeGreaterThanOrEqual(3);
    }

    expect(new Set([2, 17, 30, 45, 60].map((id) => masterModifiersFor(id).map((m) => m.id).join('+'))).size)
      .toBeGreaterThan(1);
    expect(masterModifiersFor(1).map((m) => m.id).length).toBeGreaterThanOrEqual(3);
    expect(masterModifiersFor(Number.NaN).length).toBeGreaterThanOrEqual(3);
  });
});

describe('master levels', () => {
  it('maps master ids onto campaign levels', () => {
    expect(isMasterLevel(2)).toBe(false);
    expect(isMasterLevel(MASTER_ID_BASE + 2)).toBe(true);
    expect(masterIdFor(30)).toBe(MASTER_ID_BASE + 30);
    expect(baseLevelIdFor(MASTER_ID_BASE + 30)).toBe(30);
    expect(baseLevelIdFor(30)).toBeNull();
    expect(baseLevelIdFor(MASTER_ID_BASE + 1)).toBeNull();
    expect(baseLevelIdFor(MASTER_ID_BASE + 999)).toBeNull();
  });

  it('covers the campaign without the tutorial', () => {
    expect(MASTER_LEVEL_IDS[0]).toBe(2);
    expect(MASTER_LEVEL_IDS[MASTER_LEVEL_IDS.length - 1]).toBe(CAMPAIGN_SIZE);
    expect(MASTER_LEVEL_IDS).toHaveLength(CAMPAIGN_SIZE - 1);
    expect(MASTER_LEVEL_IDS).not.toContain(1);

    expect(masterHasNext(2)).toBe(true);
    expect(masterHasNext(CAMPAIGN_SIZE)).toBe(false);
    expect(masterHasNext(CAMPAIGN_SIZE + 1)).toBe(false);
  });

  it('builds a harder version of the level, with the campaign level behind it', () => {
    const base = getLevel(20) as NonNullable<ReturnType<typeof getLevel>>;
    const master = buildMasterLevel(20) as NonNullable<ReturnType<typeof buildMasterLevel>>;

    expect(master.id).toBe(MASTER_ID_BASE + 20);
    expect(master.name).toContain('МАСТЕР');
    expect(master.name).toContain(base.name);
    expect(master.master?.baseId).toBe(20);
    expect(master.noHints).toBe(true);
    expect(master.moveSlack).toBe(MASTER_SLACK);
    expect(master.hints).toBe(0);
    expect(master.tip).toContain('МАСТЕР');

    const modifiers = master.master?.modifiers ?? [];
    expect(modifiers.length).toBeGreaterThanOrEqual(3);
    // every listed modifier really changed something
    expect(modifiers).toContain('slow');
    expect(modifiers).toContain('no-hints');

    // the tutorial is not part of the endgame list
    expect(buildMasterLevel(1)).toBeNull();
    expect(buildMasterLevel(999)).toBeNull();
    expect(buildMasterLevel(Number.NaN)).toBeNull();
  });

  it('uses a different scramble than the campaign level', () => {
    const master = buildMasterLevel(30) as NonNullable<ReturnType<typeof buildMasterLevel>>;
    const base = getLevel(30) as NonNullable<ReturnType<typeof getLevel>>;
    expect(master.generator.kind).toBe('scramble');
    expect(base.generator.kind).toBe('scramble');
    if (master.generator.kind !== 'scramble' || base.generator.kind !== 'scramble') return;
    expect(master.generator.seed).not.toBe(base.generator.seed);
  });

  it('opens only after the campaign is finished', () => {
    expect(masterUnlocked({})).toBe(false);
    expect(masterUnlocked({ 1: 3, 59: 3 })).toBe(false);
    expect(masterUnlocked({ [CAMPAIGN_SIZE]: 1 })).toBe(true);
    expect(masterUnlocked({ [CAMPAIGN_SIZE]: 3 })).toBe(true);
  });
});

describe('master levels stay solvable', () => {
  const sample = [2, 12, 24, 36, 48, 55, 59, 60];

  it('generates a verified board for every sampled level', () => {
    for (const id of sample) {
      const config = buildMasterLevel(id) as NonNullable<ReturnType<typeof buildMasterLevel>>;
      const generated = generateBoard(config.rows, config.cols, config.generator, { goal: config.goal });

      expect(generated.solvable, `level ${id} solvable`).toBe(true);
      const planned = planSolution(generated.board, {
        maxMoves: 400,
        goal: createGoalState(generated.board, config.goal),
      });
      expect(planned.done, `level ${id} goal reachable`).toBe(true);
    }
  });

  it('never asks for fewer moves than the solver needs', () => {
    for (const id of [...sample, 44]) {
      const runtime = createLevelRuntime(
        buildMasterLevel(id) as NonNullable<ReturnType<typeof buildMasterLevel>>,
      );
      expect(runtime.warning, `level ${id} generated`).toBeUndefined();
      expect(runtime.moveLimit).toBeGreaterThan(runtime.par);
      expect(runtime.hintsLeft).toBe(0);
    }
  });

  it('keeps bought hints out of a no-hint level, but moves still arrive', () => {
    const config = buildMasterLevel(10) as NonNullable<ReturnType<typeof buildMasterLevel>>;
    const plain = createLevelRuntime(config);
    const bought = createLevelRuntime(config, {
      bonus: { bonusMoves: 2, bonusHints: 3, bonusUndos: 3, coinBonus: 0 },
    });

    expect(plain.hintsLeft).toBe(0);
    expect(bought.hintsLeft).toBe(0);
    expect(bought.moveLimit).toBe(plain.moveLimit + 2);
  });

  it('gives fewer moves than the campaign version, and never more', () => {
    let tighter = 0;
    // generating and verifying a board is the slow part, so the spread is sampled
    const spread = [2, 8, 15, 20, 26, 33, 40, 44, 50, 55, 58, 60];

    for (const id of spread) {
      const base = createLevelRuntime(getLevel(id) as NonNullable<ReturnType<typeof getLevel>>);
      const master = createLevelRuntime(buildMasterLevel(id) as NonNullable<ReturnType<typeof buildMasterLevel>>);

      expect(master.warning, `level ${id} generated`).toBeUndefined();
      expect(master.moveLimit, `level ${id} is not easier than the campaign`).toBeLessThanOrEqual(base.moveLimit);
      if (master.moveLimit < base.moveLimit) tighter += 1;
    }

    // the tightened budget is the point of the mode: it has to bite almost everywhere
    expect(tighter).toBeGreaterThanOrEqual(spread.length - 2);
  }, 30_000);

  it('builds every master level of the campaign', () => {
    for (const id of MASTER_LEVEL_IDS) {
      const config = buildMasterLevel(id);
      expect(config?.id, `level ${id}`).toBe(MASTER_ID_BASE + id);
      expect(config?.master?.modifiers.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('master runs through the store', () => {
  /** Plays the current level by following the solver, like a careful player. */
  const playWithHints = (): boolean => {
    for (let guard = 0; guard < 600; guard += 1) {
      const state = useGameStore.getState();
      if (state.phase !== 'playing' || !state.runtime) break;
      const hint = findHint(state.runtime.board, { goal: state.runtime.goal });
      if (!hint) break;
      state.requestMove(hint.from, hint.to);
    }
    return useGameStore.getState().phase === 'won';
  };

  beforeEach(() => {
    useGameStore.setState({
      toast: null,
      phase: 'menu',
      runtime: null,
      outcome: null,
      progress: {
        ...useGameStore.getState().progress,
        coins: 0,
        levelStars: { [CAMPAIGN_SIZE]: 3 },
        mastery: { crowns: {}, best: {} },
      eventWins: [],
      },
    });
  });

  it('is winnable and pays crowns without touching campaign stars', () => {
    for (const id of [2, 44]) {
      useGameStore.getState().startMasterLevel(id);
      expect(useGameStore.getState().runtime?.config.id).toBe(masterIdFor(id));

      expect(playWithHints(), `master ${id} is winnable`).toBe(true);
      const state = useGameStore.getState();
      const award = state.outcome?.mastery;

      expect(award?.levelId).toBe(id);
      expect(award?.crowns).toBeGreaterThanOrEqual(1);
      expect(award?.gained).toBeGreaterThan(0);
      expect(state.progress.mastery.crowns[id]).toBe(award?.crowns);
      expect(state.progress.coins).toBeGreaterThan(0);
    }

    // two levels played, the campaign is exactly where it was
    expect(useGameStore.getState().progress.levelStars).toEqual({ [CAMPAIGN_SIZE]: 3 });
    expect(useGameStore.getState().progress.mastery.best[2]).toBeGreaterThan(0);
    expect(useGameStore.getState().progress.mastery.best[44]).toBeGreaterThan(0);
  });
});

describe('mastery rewards', () => {
  it('pays more for better runs and harder levels', () => {
    expect(crownsForStars(0)).toBe(1);
    expect(crownsForStars(1)).toBe(1);
    expect(crownsForStars(2)).toBe(2);
    expect(crownsForStars(3)).toBe(3);
    expect(crownsForStars(9)).toBe(3);

    expect(masteryPointsFor(3, 4)).toBeGreaterThan(masteryPointsFor(2, 4));
    expect(masteryPointsFor(2, 4)).toBeGreaterThan(masteryPointsFor(2, 3));
    expect(masteryPointsFor(0, 0)).toBeGreaterThan(0);
    expect(masteryPointsFor(Number.NaN, Number.NaN)).toBeGreaterThan(0);
  });

  it('grows crowns and points, and never lowers them', () => {
    const first = awardMastery(EMPTY_MASTERY, 12, 2, 3);
    expect(first.award.crowns).toBe(2);
    expect(first.award.previousCrowns).toBe(0);
    expect(first.award.gained).toBe(first.award.points);
    expect(first.award.total).toBe(first.award.points);
    expect(masteryTotal(first.mastery)).toBe(first.award.points);
    expect(totalCrowns(first.mastery)).toBe(2);

    const worse = awardMastery(first.mastery, 12, 1, 3);
    expect(worse.award.gained).toBe(0);
    expect(worse.award.best).toBe(first.award.points);
    expect(worse.mastery.crowns[12]).toBe(2);
    expect(masteryTotal(worse.mastery)).toBe(first.award.points);

    const better = awardMastery(first.mastery, 12, 3, 3);
    expect(better.award.gained).toBe(masteryPointsFor(3, 3) - masteryPointsFor(2, 3));
    expect(better.mastery.crowns[12]).toBe(3);
    expect(totalCrowns(better.mastery)).toBe(3);

    // another level adds up
    const two = awardMastery(better.mastery, 13, 3, 4);
    expect(masteryTotal(two.mastery)).toBe(better.award.total + two.award.points);
    expect(Object.keys(two.mastery.crowns)).toHaveLength(2);
  });

  it('announces a promotion exactly once', () => {
    const almost = { ...EMPTY_MASTERY, crowns: { 60: 3 }, best: { 60: MASTER_RANKS[1]!.from - 1 } };
    const promoted = awardMastery(almost, 59, 3, 4);

    expect(promoted.award.rankUp).toBe(MASTER_RANKS[1]!.name);
    expect(promoted.award.rank).toBe(MASTER_RANKS[1]!.name);

    const again = awardMastery(promoted.mastery, 58, 3, 4);
    expect(again.award.rankUp).toBeNull();
  });

  it('climbs the ranks with points', () => {
    expect(masterRank(0).name).toBe(MASTER_RANKS[0]!.name);
    expect(masterRank(-50).name).toBe(MASTER_RANKS[0]!.name);
    expect(masterRank(Number.NaN).name).toBe(MASTER_RANKS[0]!.name);

    for (let i = 1; i < MASTER_RANKS.length; i += 1) {
      const rank = MASTER_RANKS[i] as (typeof MASTER_RANKS)[number];
      const previous = MASTER_RANKS[i - 1] as (typeof MASTER_RANKS)[number];
      expect(rank.from).toBeGreaterThan(previous.from);
      expect(masterRank(rank.from).id).toBe(rank.id);
    }

    expect(nextMasterRank(0)?.id).toBe(MASTER_RANKS[1]!.id);
    expect(nextMasterRank(999_999)).toBeNull();
    expect(masterRankProgress(0)).toBe(0);
    expect(masterRankProgress(999_999)).toBe(1);

    const middle = Math.round((MASTER_RANKS[0]!.from + MASTER_RANKS[1]!.from) / 2);
    expect(masterRankProgress(middle)).toBeGreaterThan(0);
    expect(masterRankProgress(middle)).toBeLessThan(1);
  });
});

describe('master mode in the store', () => {
  const cleared = { [CAMPAIGN_SIZE]: 3 };

  const setProgress = (patch: Partial<ReturnType<typeof useGameStore.getState>['progress']>): void => {
    useGameStore.setState({
      phase: 'menu',
      runtime: null,
      outcome: null,
      progress: {
        ...useGameStore.getState().progress,
        levelStars: cleared,
        mastery: { crowns: {}, best: {} },
      eventWins: [],
        ...patch,
      },
    });
  };

  beforeEach(() => {
    useGameStore.setState({ toast: null });
    setProgress({});
  });

  it('refuses to start before the campaign is finished', () => {
    setProgress({ levelStars: { 30: 3 } });

    useGameStore.getState().startMasterLevel(30);
    expect(useGameStore.getState().runtime).toBeNull();
    expect(useGameStore.getState().toast?.text).toContain('после уровня 60');
  });

  it('starts the master variant of a level', () => {
    useGameStore.getState().startMasterLevel(30);
    const state = useGameStore.getState();

    expect(state.phase).toBe('playing');
    expect(state.runtime?.config.id).toBe(masterIdFor(30));
    expect(state.runtime?.config.master?.baseId).toBe(30);
    expect(state.runtime?.hintsLeft).toBe(0);
    expect(state.runtime?.status).toBe('playing');
  });

  it('replays and restarts a master level as a master level', () => {
    useGameStore.getState().startMasterLevel(7);
    useGameStore.getState().restartLevel();
    expect(useGameStore.getState().runtime?.config.id).toBe(masterIdFor(7));

    useGameStore.getState().playNextLevel();
    expect(useGameStore.getState().runtime?.config.id).toBe(masterIdFor(8));

    useGameStore.getState().replayCurrentLevel();
    expect(useGameStore.getState().runtime?.config.id).toBe(masterIdFor(8));
  });

  it('pays crowns and mastery points instead of campaign stars', () => {
    setProgress({ coins: 0, levelStars: cleared });
    useGameStore.getState().startMasterLevel(2);

    const before = useGameStore.getState();
    const runtime = before.runtime;
    expect(runtime).toBeTruthy();

    // play the level through the hint solver, exactly like a player would
    for (let guard = 0; guard < 500; guard += 1) {
      if (useGameStore.getState().phase !== 'playing') break;
      const hint = findMasterHint();
      if (!hint) break;
      useGameStore.getState().requestMove(hint.from, hint.to);
    }

    const after = useGameStore.getState();
    expect(after.phase).toBe('won');

    const award = after.outcome?.mastery;
    expect(award, 'award attached to the outcome').toBeTruthy();
    expect(award?.levelId).toBe(2);
    expect(award?.crowns).toBeGreaterThanOrEqual(1);
    expect(after.progress.mastery.crowns[2]).toBe(award?.crowns);
    expect(after.progress.mastery.best[2]).toBe(award?.best);
    expect(masteryTotal(after.progress.mastery)).toBe(award?.total);

    // campaign progress is untouched: no new stars, same unlocked level, no coins lost
    expect(after.progress.levelStars).toEqual(cleared);
    expect(after.progress.unlockedLevel).toBe(before.progress.unlockedLevel);
    expect(after.progress.coins).toBeGreaterThan(0);
  });

  it('pays nothing new for a weaker replay', () => {
    const strong = awardMastery(EMPTY_MASTERY, 5, 3, 4);
    setProgress({ mastery: strong.mastery });
    const earned = masteryTotal(strong.mastery);

    const worse = awardMastery(strong.mastery, 5, 1, 4);
    expect(worse.award.gained).toBe(0);
    expect(masteryTotal(worse.mastery)).toBe(earned);
  });
});

describe('mastery migration', () => {
  it('falls back to an empty mastery for broken data', () => {
    for (const bad of [null, undefined, 42, 'nonsense', []]) {
      expect(migrateMastery(bad)).toEqual({ crowns: {}, best: {} });
    }
  });

  it('drops unknown levels and clamps crowns', () => {
    const migrated = migrateMastery({
      crowns: { 2: 3, 30: 9, 60: 2, 1: 3, 999: 1, 5: -1, 6: 'x' },
      best: { 2: 40, 30: 999, 60: -5, 1: 30, 999: 10 },
    });

    expect(migrated.crowns).toEqual({ 2: 3, 30: 3, 60: 2 });
    expect(migrated.best).toEqual({ 2: 40, 30: 999 });
    expect(totalCrowns(migrated)).toBe(8);
    expect(masteryTotal(migrated)).toBe(1039);
  });
});

describe('master screen data', () => {
  it('has a card for every master level', () => {
    const cards = MASTER_LEVEL_IDS.map((id) => buildMasterLevel(id));
    expect(cards.filter((card) => card !== null)).toHaveLength(MASTER_LEVEL_IDS.length);
    for (const card of cards) {
      expect(card?.tip?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('reports the reward of a level through the outcome type', () => {
    const runtime = createLevelRuntime(
      buildMasterLevel(3) as NonNullable<ReturnType<typeof buildMasterLevel>>,
    );
    const won = { ...runtime, status: 'won' as const, movesLeft: runtime.moveLimit - 1 };
    const outcome = levelOutcome(won);

    expect(outcome.status).toBe('won');
    expect(outcome.mastery).toBeUndefined(); // the store attaches the award
    expect(outcome.rewards.length).toBeGreaterThan(0);
  });
});
