import { useEffect, useMemo, useRef } from 'react';
import { CoinPill, IconButton, Star } from './components';
import { LEVELS, getLevel } from '../data/levels';
import { THEMES, themeForLevel } from '../data/themes';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';

export interface LevelMapProps {
  onBack: () => void;
}

interface WorldGroup {
  themeId: string;
  name: string;
  levels: typeof LEVELS;
}

/** Campaign layout: each product world owns this many levels. */
const LEVELS_PER_THEME = 8;

/** Level map: 60 levels grouped by product theme, with stars and locks. */
export function LevelMap({ onBack }: LevelMapProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const startLevel = useGameStore((state) => state.startLevel);
  const currentRef = useRef<HTMLButtonElement>(null);

  const worlds = useMemo<WorldGroup[]>(() => {
    const groups = new Map<string, WorldGroup>();
    for (const level of LEVELS) {
      const theme = themeForLevel(level.id);
      const existing = groups.get(theme.id);
      if (existing) existing.levels.push(level);
      else groups.set(theme.id, { themeId: theme.id, name: theme.name, levels: [level] });
    }
    return [...groups.values()];
  }, []);

  const totalStars = Object.values(progress.levelStars).reduce((sum, stars) => sum + stars, 0);
  const cleared = Object.keys(progress.levelStars).length;
  const maxStars = LEVELS.length * 3;

  useEffect(() => {
    // bring the level the player is about to play into view
    const timer = window.setTimeout(() => {
      currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="screen map-screen">
      <header className="screen-header">
        <IconButton title="В меню" onClick={() => {
          audio.unlock();
          audio.uiClose();
          onBack();
        }} className="back-btn">
          <span className="back-glyph" aria-hidden="true">
            ‹
          </span>
        </IconButton>
        <h2 className="screen-title">Карта уровней</h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <div className="map-summary">
        <span className="summary-chip">
          Пройдено <b>{cleared}</b> из {LEVELS.length}
        </span>
        <span className="summary-chip">
          <span className="stat-star" aria-hidden="true">
            ★
          </span>
          <b>{totalStars}</b> из {maxStars}
        </span>
      </div>

      <div className="map-scroll">
        {worlds.map((world) => {
          const themeStars = world.levels.reduce((sum, level) => sum + (progress.levelStars[level.id] ?? 0), 0);
          return (
            <section className="world" key={world.themeId}>
              <div className="world-head">
                <span className="world-name">{world.name}</span>
                <span className="world-stars">
                  ★ {themeStars}/{world.levels.length * 3}
                </span>
              </div>

              <div className="level-grid">
                {world.levels.map((level) => {
                  const stars = progress.levelStars[level.id] ?? 0;
                  const locked = level.id > progress.unlockedLevel;
                  const isCurrent = level.id === progress.unlockedLevel;
                  return (
                    <button
                      key={level.id}
                      ref={isCurrent ? currentRef : undefined}
                      type="button"
                      className={`level-tile${locked ? ' level-tile-locked' : ''}${isCurrent ? ' level-tile-current' : ''}${
                        stars > 0 ? ' level-tile-done' : ''
                      }`}
                      disabled={locked}
                      title={locked ? `Уровень ${level.id} — закрыт` : `Уровень ${level.id}: ${level.name}`}
                      onClick={() => {
                        audio.unlock();
                        audio.tap();
                        startLevel(level.id);
                      }}
                    >
                      <span className="level-tile-number">{locked ? '🔒' : level.id}</span>
                      <span className="level-tile-stars">
                        {[0, 1, 2].map((index) => (
                          <span className="mini-star" key={index}>
                            <Star filled={index < stars} index={index} />
                          </span>
                        ))}
                      </span>
                      <span className="level-tile-name">{level.name}</span>
                      {mechanicsOf(level.id) ? (
                        <span className="level-tile-marks" aria-hidden="true">
                          {mechanicsOf(level.id)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        <footer className="map-footer">
          {policyNote(cleared, LEVELS.length)}
        </footer>
      </div>
    </div>
  );
}

/** Small badges that tell the player which mechanics a level brings. */
function mechanicsOf(id: number): string {
  const level = getLevel(id);
  if (!level || level.generator.kind !== 'scramble') return '';
  const marks: string[] = [];
  if ((level.generator.bombs?.length ?? 0) > 0) marks.push('💥');
  if ((level.generator.frozen ?? 0) !== 0 && level.generator.frozen !== undefined) marks.push('❄');
  if ((level.generator.golden?.length ?? 0) > 0) marks.push('★');
  return marks.join('');
}

function policyNote(cleared: number, total: number): string {
  if (cleared >= total) return 'Все уровни пройдены — вы настоящий мастер полок! 🎉';
  const theme = themeForLevel(Math.min(total, cleared + 1));
  return `Дальше: ${THEMES[theme.id]?.name ?? theme.name} · уровень ${Math.min(total, cleared + 1)}`;
}

/** Exported for tests: how many levels a product world owns. */
export { LEVELS_PER_THEME };
