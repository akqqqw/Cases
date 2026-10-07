import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from './components';
import { useGameStore } from '../store/gameStore';
import {
  BOARDS,
  boardDef,
  currentWeekStars,
  type BoardEntry,
  type BoardId,
} from '../platform/leaderboards';
import { t } from '../platform/i18n';
import { audio } from '../game/audio';

export interface LeaderboardScreenProps {
  onBack: () => void;
}

/** Value of a table formatted for a human: the weekly board adds a star sign. */
function scoreText(id: BoardId, score: number): string {
  if (id === 'stars3') return t('lb.scoreStars3', { n: score });
  if (id === 'week') return t('lb.scoreWeek', { n: score });
  return t('lb.scorePoints', { n: score });
}

function Row({ entry, index }: { entry: BoardEntry; index: number }): React.ReactElement {
  const rank = entry.rank > 0 ? entry.rank : index + 1;
  return (
    <li className={`board-row${entry.self ? ' board-row-self' : ''}`}>
      <span className="board-rank">{rank}</span>
      <span className="board-avatar" aria-hidden="true">
        {entry.avatar ? <img src={entry.avatar} alt="" loading="lazy" /> : '🙂'}
      </span>
      <span className="board-name">{entry.name.length > 0 ? entry.name : t('lb.hidden')}</span>
      <span className="board-score">{entry.score}</span>
    </li>
  );
}

/**
 * The rating screen: three tables of the Yandex Games leaderboards.
 *
 * The screen explains every state the platform can be in — no portal, no API,
 * no table in the Console, a guest — and never blocks the game: without a
 * ranking the rest of the game works exactly as before.
 */
export function LeaderboardScreen({ onBack }: LeaderboardScreenProps): React.ReactElement {
  const leaderboard = useGameStore((state) => state.leaderboard);
  const cloud = useGameStore((state) => state.cloud);
  const loadLeaderboard = useGameStore((state) => state.loadLeaderboard);
  const publishLeaderboards = useGameStore((state) => state.publishLeaderboards);
  const refreshLeaderboards = useGameStore((state) => state.refreshLeaderboards);
  const authorizeCloud = useGameStore((state) => state.authorizeCloud);
  const [board, setBoard] = useState<BoardId>('mastery');

  const def = boardDef(board);
  const view = leaderboard.boards[board] ?? { id: board, phase: 'idle' as const, entries: [], userRank: 0, loadedAt: null };
  const scores = useGameStore((state) => state.scores)();
  const weekNow = currentWeekStars();

  // Opening a tab publishes what improved and loads the table (cached for a
  // minute — the SDK allows only 20 `getEntries` per 5 minutes).
  useEffect(() => {
    publishLeaderboards();
    loadLeaderboard(board);
  }, [board, loadLeaderboard, publishLeaderboards]);

  // Signing in changes the answer: the place of the player can appear, so the
  // table is sent and read once more right after the session is back.
  const authorized = cloud.authorized;
  const wasAuthorized = useRef(authorized);
  useEffect(() => {
    const previous = wasAuthorized.current;
    wasAuthorized.current = authorized;
    if (authorized && !previous) refreshLeaderboards(board);
  }, [authorized, board, refreshLeaderboards]);

  const refresh = (): void => {
    audio.tap();
    refreshLeaderboards(board);
  };

  const rank = view.userRank;
  const showLogin = leaderboard.available && !leaderboard.authorized;

  return (
    <div className="screen board-screen">
      <header className="screen-header">
        <IconButton title={t('lb.back')} onClick={() => {
          audio.unlock();
          audio.uiClose();
          onBack();
        }} className="back-btn">
          <span className="back-glyph" aria-hidden="true">
            ‹
          </span>
        </IconButton>
        <h2 className="screen-title">{t('lb.title')}</h2>
        <div className="screen-header-right">
          <Button size="sm" tone="ghost" onClick={refresh} disabled={!leaderboard.available || view.phase === 'loading'}>
            {t('lb.refresh')}
          </Button>
        </div>
      </header>

      <nav className="shop-tabs">
        {BOARDS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`shop-tab${entry.id === board ? ' shop-tab-active' : ''}`}
            onClick={() => {
              audio.tap();
              setBoard(entry.id);
            }}
          >
            {entry.icon} {t(entry.titleKey)}
          </button>
        ))}
      </nav>

      <p className="board-hint">{t(def.hintKey)}</p>

      <div className="board-scroll">
        <div className="board-me">
          <span className="board-me-icon" aria-hidden="true">
            {def.icon}
          </span>
          <span className="board-me-body">
            <b>{t('lb.myScore')}</b>
            <span>
              {scoreText(board, scores[board] ?? 0)}
              {board === 'week' ? ` · ${t('lb.thisWeek', { n: weekNow })}` : ''}
            </span>
          </span>
          <span className={`board-rank-pill${rank > 0 ? '' : ' board-rank-none'}`}>
            {rank > 0 ? t('lb.rank', { n: rank }) : t('lb.noRank')}
          </span>
        </div>

        {leaderboard.phase === 'disabled' ? <p className="board-note">{t('lb.disabled')}</p> : null}
        {leaderboard.phase === 'unavailable' ? <p className="board-note">{t('lb.unavailable')}</p> : null}
        {leaderboard.phase === 'error' ? <p className="board-note">{t('lb.error')}</p> : null}
        {view.phase === 'no-board' ? (
          <p className="board-note">
            {t('lb.noBoard')} <code className="board-code">{def.sdkName}</code>
          </p>
        ) : null}
        {view.phase === 'unavailable' && leaderboard.available ? (
          <p className="board-note">{t('lb.unavailable')}</p>
        ) : null}
        {view.phase === 'error' ? <p className="board-note">{t('lb.error')}</p> : null}
        {view.phase === 'too-often' ? <p className="board-note">{t('lb.tooOften')}</p> : null}

        {showLogin ? (
          <div className="board-login">
            <span className="board-note">{t('lb.unauthorized')}</span>
            <Button size="sm" tone="secondary" onClick={authorizeCloud}>
              {cloud.guest && cloud.available ? t('cloud.authorize') : t('lb.authorize')}
            </Button>
          </div>
        ) : null}

        {view.phase === 'loading' ? <p className="board-note">{t('lb.loading')}</p> : null}

        {view.phase === 'ready' && view.entries.length === 0 ? (
          <p className="board-note">{t('lb.empty')}</p>
        ) : null}

        {view.entries.length > 0 ? (
          <ol className="board-list">
            {view.entries.map((entry, index) => (
              <Row key={`${entry.rank}-${entry.name}-${index}`} entry={entry} index={index} />
            ))}
          </ol>
        ) : null}
      </div>

      <footer className="board-footer">
        {leaderboard.phase === 'ready' && leaderboard.sent[board] > 0
          ? t('lb.sent', { n: leaderboard.sent[board] })
          : t('lb.footer')}
      </footer>
    </div>
  );
}
