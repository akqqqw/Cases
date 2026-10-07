import { countByType, frozenIndices } from '../core/board';
import { comboLabel } from '../core/combo';
import { BOOSTERS, BOOSTER_IDS, boosterCount, shufflableIndices } from '../core/boosters';
import { useGameStore } from '../store/gameStore';
import { Button, CoinPill, GoalChip, HintIcon, IconButton, PauseIcon, SoundIcon, UndoIcon } from './components';
import { masterModifier } from '../data/master';
import { t } from '../platform/i18n';

/** In-game HUD: level, moves, goal, hint / undo, pause. */
export function Hud(): React.ReactElement | null {
  const runtime = useGameStore((state) => state.runtime);
  const settings = useGameStore((state) => state.settings);
  const setSettings = useGameStore((state) => state.setSettings);
  const pause = useGameStore((state) => state.pause);
  const requestHint = useGameStore((state) => state.requestHint);
  const requestUndo = useGameStore((state) => state.requestUndo);
  const armBooster = useGameStore((state) => state.armBooster);
  const boosterMode = useGameStore((state) => state.boosterMode);
  const boosters = useGameStore((state) => state.progress.boosters);
  const restartLevel = useGameStore((state) => state.restartLevel);
  const coins = useGameStore((state) => state.progress.coins);

  if (!runtime) return null;

  const { config, goal, movesLeft, moveLimit, hintsLeft, undosLeft, board } = runtime;
  const counts = countByType(board);
  const types = Object.keys(goal.targets);
  const ratio = goal.total > 0 ? Math.min(1, goal.removedTotal / goal.total) : 1;
  const tight = movesLeft <= Math.max(2, Math.round(moveLimit * 0.15));
  const iced = runtime.iceMelted ? 0 : frozenIndices(board).length;
  const bombs = board.cells.filter((cell) => cell.special === 'bomb').length;
  const combo = comboLabel(runtime.combo.streak);
  const master = config.master ?? null;
  const masterMods = (master?.modifiers ?? []).map((id) => masterModifier(id)).filter((entry) => entry !== undefined);

  return (
    <div className="hud">
      <div className="hud-top" data-hud="top">
        <div className="hud-row">
          <IconButton title={t('hud.pause')} onClick={pause}>
            <PauseIcon />
          </IconButton>

          <div className={`hud-pill level-pill${master ? ' level-pill-master' : ''}`}>
            <span className="level-label">
              {master ? t('hud.masterLevel', { id: master.baseId }) : `${t('hud.level')} ${config.id}`}
            </span>
            <span className="level-name">{config.name}</span>
            {master ? (
              <span className="master-chips">
                {masterMods.map((modifier) => (
                  <span className="master-chip" key={modifier.id} title={modifier.note}>
                    {modifier.icon} {modifier.title}
                  </span>
                ))}
              </span>
            ) : null}
          </div>

          <div className={`hud-pill moves-pill${tight ? ' moves-pill-tight' : ''}`}>
            <span className="moves-value">{movesLeft}</span>
            <span className="moves-label">{t('hud.moves')}</span>
          </div>

          <div className="hud-row-right">
            <IconButton title={t('hud.restart')} onClick={restartLevel}>
              <span className="restart-glyph" aria-hidden="true">
                ⟳
              </span>
            </IconButton>
            <IconButton
              title={settings.sound ? t('hud.soundOn') : t('hud.soundOff')}
              onClick={() => setSettings({ sound: !settings.sound })}
            >
              <SoundIcon on={settings.sound} />
            </IconButton>
          </div>
        </div>

        <div className="hud-pill goal-pill">
          <div className="goal-chips">
            {types.map((type) => (
              <GoalChip key={type} type={type} left={counts[type] ?? 0} total={goal.targets[type] ?? 0} size={42} />
            ))}
          </div>
          <div className="goal-progress">
            <div className="goal-progress-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
            <span className="goal-progress-label">
              {goal.removedTotal}/{goal.total}
            </span>
          </div>

          {combo ? (
            <div className="combo-line" key={runtime.combo.streak}>
              <span className="combo-chip">🔥 {combo}</span>
              <span className="combo-coins">
                +{runtime.comboCoins} монет за комбо
              </span>
            </div>
          ) : null}

          {iced > 0 || bombs > 0 ? (
            <div className="goal-marks">
              {bombs > 0 ? <span className="goal-mark goal-mark-bomb" title={t('hud.bombTitle')}>💥 {bombs}</span> : null}
              {iced > 0 ? (
                <span className="goal-mark goal-mark-ice" title={t('hud.iceTitle')}>
                  ❄ {iced}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="hud-bottom" data-hud="bottom">
        <div className="booster-bar" role="group" aria-label={t('hud.boosters')}>
          {BOOSTER_IDS.map((id) => {
            const def = BOOSTERS[id];
            const left = boosterCount(boosters, id);
            const armed = boosterMode === id;
            const noTargets = id === 'shuffle' && shufflableIndices(board).length < 2;

            return (
              <button
                key={id}
                type="button"
                className={`booster-btn${armed ? ' booster-btn-armed' : ''}${left <= 0 ? ' booster-btn-empty' : ''}`}
                title={`${def.title}: ${def.hint}`}
                aria-pressed={armed}
                disabled={left <= 0 || noTargets}
                onClick={() => armBooster(id)}
              >
                <span className="booster-icon" aria-hidden="true">
                  {def.icon}
                </span>
                <span className="booster-count">{left}</span>
              </button>
            );
          })}
        </div>

        <div className="hud-actions">
          <Button tone="secondary" onClick={requestHint} badge={hintsLeft} disabled={hintsLeft <= 0}>
            <span className="btn-icon">
              <HintIcon />
            </span>
            {t('hud.hint')}
          </Button>
          <Button tone="secondary" onClick={requestUndo} badge={undosLeft} disabled={undosLeft <= 0 || runtime.history.length === 0}>
            <span className="btn-icon">
              <UndoIcon />
            </span>
            {t('hud.undo')}
          </Button>
        </div>
        <div className="hud-coins">
          <CoinPill coins={coins} compact />
        </div>
      </div>
    </div>
  );
}
