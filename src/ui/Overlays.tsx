import { useEffect, useState } from 'react';
import { ItemIcon } from './ItemIcon';
import { Button, CoinPill, SoundIcon, StarRow } from './components';
import { getLevel } from '../data/levels';
import { adRewardToday, useGameStore } from '../store/gameStore';
import { NO_ADS_PRODUCT } from '../platform/purchases';
import { baseLevelIdFor, masterHasNext } from '../data/master';
import { EXTRA_MOVES } from '../core/boosters';
import { audio } from '../game/audio';
import { t, translateRank } from '../platform/i18n';
import type { CloudStatus } from '../platform/cloud';

/** Dot colour of the cloud row: green = in sync, yellow = pending, grey = off. */
export function cloudDot(phase: CloudStatus['phase'], dirty: boolean): 'ok' | 'wait' | 'off' {
  if (dirty || phase === 'syncing') return 'wait';
  if (phase === 'synced' || phase === 'pushed' || phase === 'pulled') return 'ok';
  return 'off';
}

/** Human line under the "Облачное сохранение" title. */
export function cloudLine(cloud: CloudStatus, at: number = Date.now()): string {
  if (cloud.phase === 'disabled') return t('cloud.disabled');
  if (cloud.phase === 'offline') return cloud.dirty ? t('cloud.dirty') : t('cloud.offline');
  if (cloud.phase === 'error') return t('cloud.error');
  if (cloud.phase === 'syncing') return t('cloud.syncing');
  if (cloud.dirty) return t('cloud.dirty');

  const stamp = cloud.lastSyncAt ?? cloud.cloudSavedAt;
  if (!stamp) return cloud.guest ? t('cloud.guest') : t('cloud.synced');

  const minutes = Math.max(0, Math.round((at - stamp) / 60_000));
  const when = minutes <= 0 ? t('cloud.justNow') : t('cloud.minutesAgo', { n: minutes });
  const base = cloud.phase === 'pulled' ? t('cloud.pulled') : cloud.guest ? t('cloud.guest') : t('cloud.pushed');
  return `${base} · ${when}`;
}

/** "Pause" panel with resume / restart / menu and the sound switch. */
export function PauseOverlay(): React.ReactElement | null {
  const phase = useGameStore((state) => state.phase);
  const settings = useGameStore((state) => state.settings);
  const setSettings = useGameStore((state) => state.setSettings);
  const resume = useGameStore((state) => state.resume);
  const restartLevel = useGameStore((state) => state.restartLevel);
  const exitToMenu = useGameStore((state) => state.exitToMenu);
  const toggleFullscreen = useGameStore((state) => state.toggleFullscreen);
  const fullscreen = useGameStore((state) => state.platform.fullscreen);
  const cloud = useGameStore((state) => state.cloud);
  const syncCloud = useGameStore((state) => state.syncCloud);
  const authorizeCloud = useGameStore((state) => state.authorizeCloud);

  if (phase !== 'paused') return null;

  return (
    <div className="overlay">
      <div className="card pause-card">
        <h2 className="card-title">{t('pause.title')}</h2>
        <p className="card-text">{t('pause.text')}</p>

        <div className="settings-row">
          <span>{t('pause.sound')}</span>
          <button
            type="button"
            className={`toggle${settings.sound ? ' toggle-on' : ''}`}
            onClick={() => {
              audio.unlock();
              setSettings({ sound: !settings.sound });
            }}
            aria-pressed={settings.sound}
          >
            <SoundIcon on={settings.sound} />
            <span>{settings.sound ? t('common.on') : t('common.off')}</span>
          </button>
        </div>

        <div className="settings-row">
          <span>{t('pause.music')}</span>
          <button
            type="button"
            className={`toggle${settings.music ? ' toggle-on' : ''}`}
            onClick={() => {
              audio.unlock();
              setSettings({ music: !settings.music });
            }}
            aria-pressed={settings.music}
          >
            <span className="music-glyph" aria-hidden="true">
              {settings.music ? '♫' : '♪̶'}
            </span>
            <span>{settings.music ? t('common.on') : t('common.off')}</span>
          </button>
        </div>

        <div className="settings-row">
          <span>{t('pause.volume')}</span>
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            onChange={(event) => setSettings({ volume: Number(event.target.value) / 100 })}
            aria-label={t('pause.volume')}
          />
        </div>

        <div className="settings-row">
          <span>{t('pause.fullscreen')}</span>
          <button
            type="button"
            className={`toggle${fullscreen ? ' toggle-on' : ''}`}
            onClick={() => toggleFullscreen()}
            aria-pressed={fullscreen}
            title={fullscreen ? t('pause.fullscreenOn') : t('pause.fullscreenOff')}
          >
            <span className="music-glyph" aria-hidden="true">
              {fullscreen ? '⤡' : '⤢'}
            </span>
            <span>{fullscreen ? t('common.on') : t('common.off')}</span>
          </button>
        </div>

        <div className="cloud-row">
          <span className={`cloud-dot cloud-dot-${cloudDot(cloud.phase, cloud.dirty)}`} aria-hidden="true" />
          <span className="cloud-text">
            <b>{t('cloud.title')}</b>
            <span>{cloudLine(cloud)}</span>
          </span>
          <span className="cloud-actions">
            {cloud.guest && cloud.available ? (
              <Button size="sm" tone="ghost" onClick={authorizeCloud}>
                {t('cloud.authorize')}
              </Button>
            ) : null}
            {cloud.available ? (
              <Button size="sm" tone="ghost" onClick={syncCloud} disabled={cloud.phase === 'syncing'}>
                {t('cloud.sync')}
              </Button>
            ) : null}
          </span>
        </div>

        <div className="card-actions">
          <Button size="lg" onClick={resume}>
            {t('pause.continue')}
          </Button>
          <Button tone="secondary" onClick={restartLevel}>
            {t('pause.restart')}
          </Button>
          <Button tone="ghost" onClick={exitToMenu}>
            {t('pause.menu')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Win / lose panel with stars, coins and the next step. */
export function ResultOverlay(): React.ReactElement | null {
  const phase = useGameStore((state) => state.phase);
  const ads = useGameStore((state) => state.ads);
  const reviveUsed = useGameStore((state) => state.reviveUsed);
  const reviveWithAd = useGameStore((state) => state.reviveWithAd);
  const rewardDoubled = useGameStore((state) => state.rewardDoubled);
  const doubleRewardWithAd = useGameStore((state) => state.doubleRewardWithAd);
  const progress = useGameStore((state) => state.progress);
  const adFree = useGameStore((state) => state.purchases.owned.includes(NO_ADS_PRODUCT));
  // The daily quota of ad coins is a remote flag (Console «Флаги»).
  const coinsPerDay = useGameStore((state) => state.flags.values.adRewardsPerDay);
  const outcome = useGameStore((state) => state.outcome);
  const runtime = useGameStore((state) => state.runtime);
  const replayAfterAd = useGameStore((state) => state.replayAfterAd);
  const nextLevelAfterAd = useGameStore((state) => state.nextLevelAfterAd);
  const showToast = useGameStore((state) => state.showToast);
  const exitToMenu = useGameStore((state) => state.exitToMenu);
  const [visibleStars, setVisibleStars] = useState(0);

  const won = phase === 'won';
  const stars = outcome?.stars ?? 0;

  useEffect(() => {
    if (!won) {
      setVisibleStars(0);
      return;
    }
    setVisibleStars(0);
    const timers: number[] = [];
    for (let i = 1; i <= stars; i += 1) {
      timers.push(window.setTimeout(() => {
        setVisibleStars(i);
        audio.star(i - 1);
      }, 420 + i * 320));
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [won, stars, runtime?.config.id]);

  if (phase !== 'won' && phase !== 'lost') return null;

  const config = runtime?.config;
  const baseId = config ? baseLevelIdFor(config.id) : null;
  const masterRun = baseId !== null;
  const masterNext = baseId !== null && masterHasNext(baseId);
  const next = config && !masterRun ? getLevel(config.id + 1) : undefined;
  const hasNext = masterRun ? masterNext : Boolean(next);
  const award = outcome?.mastery ?? null;
  const adCoinsLeft = Math.max(0, coinsPerDay - adRewardToday(progress).coins);

  // The campaign is over: the button points at the master mode in the menu.
  const openMaster = (): void => {
    exitToMenu();
    showToast(t('result.masterWaiting'), 'info');
  };

  return (
    <div className={`overlay${won ? ' overlay-late' : ''}`}>
      <div className={`card result-card${won ? ' result-card-win' : ' result-card-lose'}`}>
        <h2 className="card-title">{won ? t('result.win') : t('result.lose')}</h2>

        {won ? (
          <>
            <StarRow stars={visibleStars} />
            {outcome?.starTitle ? (
              <p className={`star-title star-title-${outcome.stars}`}>
                {'★'.repeat(Math.max(1, outcome.stars))} {outcome.starTitle}
              </p>
            ) : null}
            <div className="reward-row">
              <CoinPill coins={outcome?.coins ?? 0} />
              <span className="reward-label">{t('result.reward')}</span>
            </div>
            {outcome && outcome.rewards.length > 1 ? (
              <ul className="reward-lines">
                {outcome.rewards.map((line) => (
                  <li key={line.id} className={`reward-line reward-line-${line.id}`}>
                    <span>{line.label}</span>
                    <b>+{line.coins}</b>
                  </li>
                ))}
              </ul>
            ) : null}
            {outcome && outcome.comboBest >= 2 ? (
              <p className="golden-note">{t('result.bestCombo', { n: outcome.comboBest })}</p>
            ) : null}
            {outcome && outcome.boostersUsed > 0 ? (
              <p className="golden-note">{t('result.boostersUsed', { n: outcome.boostersUsed })}</p>
            ) : null}
            {outcome && outcome.leftovers > 0 ? (
              <p className="golden-note">{t('result.leftovers', { n: outcome.leftovers })}</p>
            ) : null}
            {outcome && outcome.golden > 0 ? (
              <p className="golden-note">{t('result.golden', { n: outcome.golden, coins: outcome.golden * 2 })}</p>
            ) : null}
            {outcome && outcome.bombs > 0 ? (
              <p className="golden-note">{t('result.bombs', { n: outcome.bombs, removed: outcome.bombs * 3 })}</p>
            ) : null}
            {/* Voluntary rewarded video at a logical pause: the player clicks
                it, the ad opens from the click handler and the reward arrives
                only after a watched video. Hidden for the «no ads» owners. */}
            {outcome && outcome.coins > 0 && !adFree ? (
              rewardDoubled ? (
                <p className="ad-note">{t('ads.doubleDone')}</p>
              ) : (
                <>
                  <Button
                    tone="secondary"
                    className="ad-double"
                    disabled={ads.showing || adCoinsLeft === 0}
                    onClick={() => {
                      audio.unlock();
                      doubleRewardWithAd();
                    }}
                  >
                    {t('ads.double', { n: outcome.coins })}
                  </Button>
                  {adCoinsLeft > 0 ? (
                    <p className="ad-note">
                      {t('ads.doubleLeft', { n: adCoinsLeft, total: coinsPerDay })}
                    </p>
                  ) : (
                    <p className="ad-note">{t('ads.doubleLimit')}</p>
                  )}
                </>
              )
            ) : null}
            {award ? (
              <div className="master-award">
                <span className="master-award-crowns" aria-label={`👑 ${award.crowns}`}>
                  {'👑'.repeat(award.crowns)}
                </span>
                <span className="master-award-points">
                  {t('result.masterPoints', { points: award.gained > 0 ? award.gained : 0 })}
                  {award.gained === 0 && award.previousCrowns >= award.crowns ? t('result.masterNotBetter') : ''}
                </span>
                <span className="master-award-total">
                  {t('result.masterTotal', { total: award.total, rank: translateRank(award.rank) })}
                </span>
                {award.rankUp ? <span className="master-award-rank">{t('result.newRank', { rank: translateRank(award.rankUp) })}</span> : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="lose-art" aria-hidden="true">
              {config ? <ItemIcon id={(runtime?.goal.initial ? Object.keys(runtime.goal.initial)[0] : 'apple') ?? 'apple'} size={64} /> : null}
            </div>
            <p className="card-text">{t('result.loseText')}</p>
            {ads.available && !reviveUsed ? (
              <Button
                tone="secondary"
                className="ad-revive"
                disabled={ads.showing}
                onClick={reviveWithAd}
              >
                {t('ads.revive', { n: EXTRA_MOVES })}
              </Button>
            ) : null}
            {reviveUsed ? <p className="ad-note">{t('ads.reviveDone')}</p> : null}
          </>
        )}

        <div className="card-actions">
          {won ? (
            <Button
              size="lg"
              tone={hasNext ? 'primary' : 'secondary'}
              onClick={hasNext || masterRun ? nextLevelAfterAd : openMaster}
            >
              {hasNext ? t('result.next') : masterRun ? t('result.masterDone') : t('result.toMaster')}
            </Button>
          ) : (
            <Button size="lg" onClick={replayAfterAd}>
              {t('result.tryAgain')}
            </Button>
          )}
          {won ? (
            <Button tone="secondary" onClick={replayAfterAd}>
              {t('result.replay')}
            </Button>
          ) : null}
          <Button tone="ghost" onClick={exitToMenu}>
            {t('pause.menu')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Small transient messages (hint used up, undo used up, …). */
export function Toasts(): React.ReactElement | null {
  const toast = useGameStore((state) => state.toast);
  const dismiss = useGameStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => dismiss(), 2400);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div className="toast-wrap">
      <div className={`toast toast-${toast.tone}`} key={toast.id}>
        {toast.text}
      </div>
    </div>
  );
}
