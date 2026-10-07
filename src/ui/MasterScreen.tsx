import { useMemo, useState } from 'react';
import { Button, CoinPill, IconButton } from './components';
import { getLevel } from '../data/levels';
import {
  MASTER_LEVEL_IDS,
  MASTER_RANKS,
  buildMasterLevel,
  masterRank,
  masterRankProgress,
  masterUnlocked,
  masteryPointsFor,
  masteryTotal,
  masterModifier,
  nextMasterRank,
  totalCrowns,
} from '../data/master';
import { useGameStore } from '../store/gameStore';
import { audio } from '../game/audio';

export interface MasterScreenProps {
  onBack: () => void;
}

interface MasterCard {
  id: number;
  /** Number of the campaign level behind this challenge. */
  baseId: number;
  name: string;
  modifiers: Array<{ id: string; title: string; icon: string; note: string }>;
  /** Best mastery points this level can pay. */
  maxPoints: number;
}

/** Endgame screen: the campaign replayed with modifiers for crowns and points. */
export function MasterScreen({ onBack }: MasterScreenProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const startMasterLevel = useGameStore((state) => state.startMasterLevel);
  const [picked, setPicked] = useState<number | null>(null);

  const unlocked = masterUnlocked(progress.levelStars);
  const points = masteryTotal(progress.mastery);
  const crowns = totalCrowns(progress.mastery);
  const rank = masterRank(points);
  const upcoming = nextMasterRank(points);
  const toNext = upcoming ? Math.max(0, upcoming.from - points) : 0;

  const cards = useMemo<MasterCard[]>(
    () =>
      MASTER_LEVEL_IDS.map((baseId) => {
        const built = buildMasterLevel(baseId);
        const modifiers = (built?.master?.modifiers ?? []).map((id) => {
          const modifier = masterModifier(id);
          return {
            id,
            title: modifier?.title ?? id,
            icon: modifier?.icon ?? '❔',
            note: modifier?.note ?? '',
          };
        });
        return {
          id: built?.id ?? baseId,
          baseId,
          name: getLevel(baseId)?.name ?? `Уровень ${baseId}`,
          modifiers,
          maxPoints: masteryPointsFor(3, modifiers.length),
        };
      }),
    [],
  );

  const selected = picked === null ? null : cards.find((card) => card.baseId === picked) ?? null;

  if (!unlocked) {
    return (
      <div className="screen master-screen master-screen-locked">
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
          <h2 className="screen-title">
            Мастер
            <span className="master-rank-name">закрыто</span>
          </h2>
          <div className="screen-header-right">
            <CoinPill coins={progress.coins} compact />
          </div>
        </header>

        <div className="master-locked">
          <div className="master-locked-art" aria-hidden="true">
            👑
          </div>
          <h3>Режим откроется после 60-го уровня</h3>
          <p>
            Пройдите кампанию до конца — и все 60 уровней вернутся с модификаторами: меньше ходов,
            без подсказок, больше льда, блоков и особых троек. За победы дают короны и очки
            мастерства, а не новые звёзды.
          </p>
          <Button tone="secondary" onClick={onBack}>
            К уровням
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen master-screen">
      <header className="screen-header">
        <IconButton title="В меню" onClick={onBack} className="back-btn">
          <span className="back-glyph" aria-hidden="true">
            ‹
          </span>
        </IconButton>
        <h2 className="screen-title">
          Мастер
          <span className="master-rank-name">{rank.name}</span>
        </h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <div className="master-banner">
        <div className="master-stats">
          <span className="master-points">
            <b>{points}</b> очков мастерства
          </span>
          <span className="master-crowns" title="Собрано корон">
            👑 <b>{crowns}</b>/{MASTER_LEVEL_IDS.length * 3}
          </span>
        </div>
        <div className="master-rank-bar">
          <div className="master-rank-fill" style={{ width: `${Math.round(masterRankProgress(points) * 100)}%` }} />
        </div>
        <span className="master-rank-note">
          {upcoming
            ? `До ранга «${upcoming.name}» ещё ${toNext} очк.`
            : 'Высший ранг — «Мастер полок»'}
        </span>
        <div className="master-rank-pips" aria-hidden="true">
          {MASTER_RANKS.map((entry) => (
            <span
              key={entry.id}
              className={`master-rank-pip${points >= entry.from ? ' master-rank-pip-on' : ''}`}
              title={`${entry.name} · ${entry.from} очк.`}
            >
              ◆
            </span>
          ))}
        </div>
      </div>

      <div className="master-scroll">
        <div className="master-grid">
          {cards.map((card) => {
            const best = progress.mastery.best[card.baseId] ?? 0;
            const won = progress.mastery.crowns[card.baseId] ?? 0;
            return (
              <button
                type="button"
                key={card.id}
                className={`master-card${picked === card.baseId ? ' master-card-active' : ''}${won > 0 ? ' master-card-won' : ''}`}
                onClick={() => {
                  audio.tap();
                  setPicked(picked === card.baseId ? null : card.baseId);
                }}
              >
                <span className="master-card-head">
                  <span className="master-card-num">{card.baseId}</span>
                  <span className="master-card-crowns" aria-label={`Короны: ${won} из 3`}>
                    {'👑'.repeat(won)}
                    {'·'.repeat(3 - won)}
                  </span>
                </span>
                <span className="master-card-name">{card.name}</span>
                <span className="master-card-mods" aria-hidden="true">
                  {card.modifiers.map((modifier) => (
                    <span className="master-mod-icon" key={modifier.id} title={modifier.title}>
                      {modifier.icon}
                    </span>
                  ))}
                </span>
                <span className="master-card-best">{best > 0 ? `лучший результат: ${best}` : 'не пройден'}</span>
              </button>
            );
          })}
        </div>

        {selected ? (
          <div className="master-detail">
            <h3 className="master-detail-title">
              Уровень {selected.baseId} · {selected.name}
            </h3>
            <ul className="master-detail-mods">
              {selected.modifiers.map((modifier) => (
                <li key={modifier.id}>
                  <span className="master-mod-icon" aria-hidden="true">
                    {modifier.icon}
                  </span>
                  <b>{modifier.title}</b> — {modifier.note}
                </li>
              ))}
            </ul>
            <p className="master-detail-reward">
              За победу: 1–3 короны и до {selected.maxPoints} очков мастерства за идеальный заход.
              Монеты платят как обычно.
            </p>
            <Button
              size="lg"
              onClick={() => {
                audio.tap();
                startMasterLevel(selected.baseId);
              }}
            >
              ▶ Играть МАСТЕР
            </Button>
          </div>
        ) : (
          <footer className="map-footer">
            Каждый уровень — тот же самый, но с модификаторами. Очки мастерства растут только от
            нового лучшего результата, так что переигрывать легкие уровни смысла нет.
          </footer>
        )}
      </div>
    </div>
  );
}
