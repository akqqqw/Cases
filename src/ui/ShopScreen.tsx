import { useEffect, useState } from 'react';
import { Button, CoinPill, IconButton } from './components';
import { ItemIcon } from './ItemIcon';
import {
  EMPTY_BONUS,
  SHOP_ITEMS,
  ownedBonus,
  type ShopItem,
  type ShopKind,
} from '../data/shop';
import { BOOSTERS, BOOSTER_IDS, boosterCount, type BoosterId } from '../core/boosters';
import {
  SHOP_TIERS,
  UPGRADE_TRACKS,
  boosterPrice,
  isMaxed,
  nextTier,
  nextUpgrade,
  shopTier,
  tierProgress,
  totalUpgradeCost,
  totalUpgradeLevels,
  trackCost,
  upgradeBonus,
  upgradeLevel,
} from '../data/upgrades';
import { AD_BOOSTERS_PER_DAY, adRewardToday, useGameStore } from '../store/gameStore';
import {
  NO_ADS_PRODUCT,
  PRODUCT_IDS,
  productDef,
  type CatalogItem,
} from '../platform/purchases';
import { audio } from '../game/audio';
import { t } from '../platform/i18n';

export interface ShopScreenProps {
  onBack: () => void;
}

/** The shop has an extra tab that is not a shop kind: the development screen. */
type ShopTab = ShopKind | 'upgrade';

const KIND_LABELS: Record<ShopTab, string> = {
  department: 'Отделы',
  set: 'Наборы',
  decor: 'Оформление',
  upgrade: 'Развитие',
};

const KIND_HINTS: Record<ShopTab, string> = {
  department: 'Новые отделы добавляют товары в ассортимент и дают постоянные бонусы.',
  set: 'Тематические наборы расширяют ассортимент товаров на полках.',
  decor: 'Оформление меняет вид полок — можно переключаться в любой момент.',
  upgrade: 'Развивайте купленные отделы: каждый уровень даёт постоянный бонус и украшает магазин.',
};

/** Shop: buy departments, product sets and interior presets with coins. */
export function ShopScreen({ onBack }: ShopScreenProps): React.ReactElement {
  const progress = useGameStore((state) => state.progress);
  const purchase = useGameStore((state) => state.purchase);
  const setActiveDecor = useGameStore((state) => state.setActiveDecor);
  const upgradeDepartment = useGameStore((state) => state.upgradeDepartment);
  const buyBooster = useGameStore((state) => state.buyBooster);
  const ads = useGameStore((state) => state.ads);
  const watchAdForCoins = useGameStore((state) => state.watchAdForCoins);
  const watchAdForBooster = useGameStore((state) => state.watchAdForBooster);
  const purchases = useGameStore((state) => state.purchases);
  // The ad economy is a remote flag: the numbers of the section follow the
  // values that arrived from the Console, not the constants of the build.
  const flags = useGameStore((state) => state.flags.values);
  const buyProduct = useGameStore((state) => state.buyProduct);
  const refreshPurchases = useGameStore((state) => state.refreshPurchases);
  const adFree = purchases.owned.includes(NO_ADS_PRODUCT);
  const [kind, setKind] = useState<ShopTab>('department');
  const adToday = adRewardToday(progress);

  // The catalog of the Console is read once per boot; the shop refreshes it in
  // case the prices changed or the connection came back.
  useEffect(() => {
    refreshPurchases();
  }, [refreshPurchases]);

  const shopBonus = ownedBonus(progress.owned);
  const developed = upgradeBonus(progress.upgrades);

  // Purchases and development levels stack into one visible bonus line.
  const bonus = {
    bonusMoves: shopBonus.bonusMoves + developed.bonusMoves,
    bonusHints: shopBonus.bonusHints + developed.bonusHints,
    bonusUndos: shopBonus.bonusUndos + developed.bonusUndos,
    coinBonus: shopBonus.coinBonus + developed.coinBonus,
  };

  const items = SHOP_ITEMS.filter((item) => item.kind === kind);
  const levels = totalUpgradeLevels(progress.upgrades);
  const tier = shopTier(levels);
  const upcoming = nextTier(levels);
  const progressToNext = tierProgress(levels);

  return (
    <div className="screen shop-screen" data-tier={tier.index}>
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
          Магазин
          <span className="shop-tier-name">{tier.name}</span>
        </h2>
        <div className="screen-header-right">
          <CoinPill coins={progress.coins} compact />
        </div>
      </header>

      <div className="shop-tier" title={tier.note}>
        <div className="shop-tier-pips" aria-hidden="true">
          {SHOP_TIERS.map((entry) => (
            <span
              key={entry.id}
              className={`shop-tier-pip${entry.index <= tier.index ? ' shop-tier-pip-on' : ''}`}
            >
              ◆
            </span>
          ))}
        </div>
        <div className="shop-tier-bar">
          <div className="shop-tier-bar-fill" style={{ width: `${Math.round(progressToNext * 100)}%` }} />
        </div>
        <span className="shop-tier-note">
          {upcoming
            ? `${tier.name} · до «${upcoming.name}» ещё ${Math.max(0, (tier.to ?? 0) - levels)} ур.`
            : `${tier.name} · максимальное развитие`}
        </span>
      </div>

      <div className="shop-bonuses">
        <span className="summary-chip">
          Бонусы: {bonus.bonusMoves > 0 ? `+${bonus.bonusMoves} хода ` : ''}
          {bonus.bonusHints > 0 ? `+${bonus.bonusHints} подсказка ` : ''}
          {bonus.bonusUndos > 0 ? `+${bonus.bonusUndos} отмена ` : ''}
          {bonus.coinBonus > 0 ? `+${Math.round(bonus.coinBonus * 100)}% монет` : ''}
          {bonus.bonusMoves + bonus.bonusHints + bonus.bonusUndos + bonus.coinBonus === 0 ? 'пока нет' : ''}
        </span>
      </div>

      <nav className="shop-tabs">
        {(Object.keys(KIND_LABELS) as ShopTab[]).map((value) => (
          <button
            key={value}
            type="button"
            className={`shop-tab${kind === value ? ' shop-tab-active' : ''}`}
            onClick={() => {
              audio.tap();
              setKind(value);
            }}
          >
            {KIND_LABELS[value]}
          </button>
        ))}
      </nav>

      <p className="shop-hint">{KIND_HINTS[kind]}</p>

      <PremiumBlock
        catalog={purchases.catalog}
        available={purchases.available}
        buying={purchases.buying}
        owned={purchases.owned}
        onBuy={buyProduct}
      />

      <div className="shop-scroll">
        {kind === 'upgrade' ? (
          <>
            {UPGRADE_TRACKS.map((track) => (
              <UpgradeCard
                key={track.id}
                trackId={track.id}
                levels={progress.upgrades}
                coins={progress.coins}
                owned={progress.owned.includes(track.id)}
                onUpgrade={() => {
                  audio.unlock();
                  if (upgradeDepartment(track.id)) audio.star(1);
                }}
              />
            ))}

            <h3 className="shop-section-title">Бустеры поштучно</h3>
            <div className="booster-shop">
              {BOOSTER_IDS.map((id) => (
                <BoosterShopCard
                  key={id}
                  id={id}
                  have={boosterCount(progress.boosters, id)}
                  coins={progress.coins}
                  onBuy={() => {
                    audio.unlock();
                    if (buyBooster(id)) audio.tap();
                  }}
                />
              ))}
            </div>

            <h3 className="shop-section-title">{t('ads.title')}</h3>
            <p className="shop-hint">{adFree ? t('ads.off') : t('ads.hint')}</p>
            <div className="ad-rewards">
              <AdRewardCard
                id="coins"
                icon="🪙"
                title={t('ads.coins', { n: flags.adRewardCoins })}
                quota={t('ads.coinsLeft', {
                  n: Math.max(0, flags.adRewardsPerDay - adToday.coins),
                  total: flags.adRewardsPerDay,
                })}
                left={Math.max(0, flags.adRewardsPerDay - adToday.coins)}
                available={ads.available && !ads.showing}
                onWatch={watchAdForCoins}
              />
              <AdRewardCard
                id="booster"
                icon="🎁"
                title={t('ads.booster')}
                quota={t('ads.boosterLeft', {
                  n: Math.max(0, AD_BOOSTERS_PER_DAY - adToday.boosters),
                  total: AD_BOOSTERS_PER_DAY,
                })}
                left={Math.max(0, AD_BOOSTERS_PER_DAY - adToday.boosters)}
                available={ads.available && !ads.showing}
                onWatch={watchAdForBooster}
              />
            </div>

            <footer className="map-footer">
              Полное развитие всех отделов стоит {totalUpgradeCost()} монет.
            </footer>
          </>
        ) : (
          items.map((item) => (
          <ShopCard
            key={item.id}
            item={item}
            owned={progress.owned.includes(item.id)}
            active={progress.activeDecor === item.id}
            affordable={progress.coins >= item.price}
            unlocked={progress.unlockedLevel >= (item.unlockLevel ?? 0)}
            onBuy={() => {
              audio.unlock();
              if (purchase(item.id)) audio.star(1);
            }}
              onUse={() => setActiveDecor(item.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ShopCard({
  item,
  owned,
  active,
  affordable,
  unlocked,
  onBuy,
  onUse,
}: {
  item: ShopItem;
  owned: boolean;
  active: boolean;
  affordable: boolean;
  unlocked: boolean;
  onBuy: () => void;
  onUse: () => void;
}): React.ReactElement {
  const bonusText = describeBonus(item);

  return (
    <article className={`shop-card${owned ? ' shop-card-owned' : ''}${active ? ' shop-card-active' : ''}`}>
      <div className="shop-card-icon">
        <ItemIcon id={item.icon} size={54} tile />
      </div>

      <div className="shop-card-body">
        <h3 className="shop-card-name">{item.name}</h3>
        <p className="shop-card-text">{item.description}</p>
        {bonusText ? <p className="shop-card-bonus">{bonusText}</p> : null}
        {!unlocked ? <p className="shop-card-locked">Откроется на уровне {item.unlockLevel}</p> : null}
      </div>

      <div className="shop-card-action">
        {owned ? (
          item.kind === 'decor' ? (
            active ? (
              <span className="owned-badge">Активно</span>
            ) : (
              <Button tone="secondary" size="sm" onClick={onUse}>
                Применить
              </Button>
            )
          ) : (
            <span className="owned-badge">Куплено</span>
          )
        ) : (
          <Button
            tone="primary"
            size="sm"
            disabled={!affordable || !unlocked}
            onClick={onBuy}
            title={affordable ? 'Купить' : 'Не хватает монет'}
          >
            <span className="price-tag">
              <span className="coin-icon" aria-hidden="true" />
              {item.price}
            </span>
          </Button>
        )}
      </div>
    </article>
  );
}

/** One department development track: pips, next reward and the upgrade button. */
function UpgradeCard({
  trackId,
  levels,
  coins,
  owned,
  onUpgrade,
}: {
  trackId: string;
  levels: Record<string, number>;
  coins: number;
  owned: boolean;
  onUpgrade: () => void;
}): React.ReactElement {
  const track = UPGRADE_TRACKS.find((entry) => entry.id === trackId);
  if (!track) return <></>;

  const level = upgradeLevel(levels, trackId);
  const maxed = isMaxed(levels, trackId);
  const next = nextUpgrade(levels, trackId);
  const affordable = next !== null && coins >= next.step.cost;

  return (
    <article
      className={`shop-card upgrade-card${maxed ? ' upgrade-card-max' : ''}${owned ? '' : ' upgrade-card-locked'}`}
    >
      <div className="shop-card-icon">
        <ItemIcon id={track.icon} size={54} tile />
      </div>

      <div className="shop-card-body">
        <h3 className="shop-card-name">{track.name}</h3>
        <p className="shop-card-text">{track.focus}</p>

        <div className="upgrade-pips" aria-label={`Уровень ${level} из ${track.steps.length}`}>
          {track.steps.map((_, index) => (
            <span key={index} className={`upgrade-pip${index < level ? ' upgrade-pip-on' : ''}`} />
          ))}
          <span className="upgrade-level">
            ур. {level}/{track.steps.length}
          </span>
        </div>

        {maxed ? (
          <p className="shop-card-bonus">Максимум: всё развитие отдела куплено</p>
        ) : null}
        {!maxed && next && owned ? (
          <p className="shop-card-bonus">
            Дальше: {next.step.label}
            {next.step.bonus ? ' · постоянно' : ''}
            {next.step.boosters ? ' · сразу в инвентарь' : ''}
          </p>
        ) : null}
        {!owned ? <p className="shop-card-locked">Сначала купите отдел в «Отделах»</p> : null}
        <p className="shop-card-text">Вся ветка: {trackCost(track.id)} монет</p>
      </div>

      <div className="shop-card-action">
        {maxed ? (
          <span className="owned-badge">Максимум</span>
        ) : (
          <Button
            tone="primary"
            size="sm"
            disabled={!owned || !affordable}
            onClick={onUpgrade}
            title={owned ? (affordable ? 'Улучшить отдел' : 'Не хватает монет') : 'Сначала купите отдел'}
          >
            <span className="price-tag">
              <span className="coin-icon" aria-hidden="true" />
              {next?.step.cost ?? 0}
            </span>
          </Button>
        )}
      </div>
    </article>
  );
}

/** Single booster for sale: a small repeatable coin sink. */
function BoosterShopCard({
  id,
  have,
  coins,
  onBuy,
}: {
  id: BoosterId;
  have: number;
  coins: number;
  onBuy: () => void;
}): React.ReactElement {
  const def = BOOSTERS[id];
  const price = boosterPrice(id);

  return (
    <div className="booster-shop-card">
      <span className="booster-shop-icon" aria-hidden="true">
        {def.icon}
      </span>
      <span className="booster-shop-name">{def.title}</span>
      <span className="booster-shop-have">в запасе: {have}</span>
      <Button tone="primary" size="sm" disabled={coins < price} onClick={onBuy}>
        <span className="price-tag">
          <span className="coin-icon" aria-hidden="true" />
          {price}
        </span>
      </Button>
    </div>
  );
}

/** A voluntary rewarded video: the reward arrives only after the full view. */
function AdRewardCard({
  id,
  icon,
  title,
  quota,
  left,
  available,
  onWatch,
}: {
  id: string;
  icon: string;
  title: string;
  quota: string;
  left: number;
  available: boolean;
  onWatch: () => void;
}): React.ReactElement {
  const spent = left <= 0;

  return (
    <div className={`ad-card${spent ? ' ad-card-spent' : ''}`} data-ad={id}>
      <span className="ad-card-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="ad-card-body">
        <b>{title}</b>
        <span>{quota}</span>
      </div>
      <Button
        size="sm"
        tone={spent ? 'ghost' : 'secondary'}
        disabled={spent || !available}
        className="ad-watch"
        onClick={() => {
          audio.unlock();
          onWatch();
        }}
      >
        {spent ? t('ads.done') : available ? t('ads.watch') : t('ads.unavailable')}
      </Button>
    </div>
  );
}

/**
 * Products of the Console («Покупки»). The price and the currency come from the
 * catalog of the platform only — the portal owns them (requirement 1.13.2).
 * Without the platform, or before the Console has the products, the section
 * explains itself instead of showing invented numbers.
 */
function PremiumBlock({
  catalog,
  available,
  buying,
  owned,
  onBuy,
}: {
  catalog: CatalogItem[];
  available: boolean;
  buying: string | null;
  owned: string[];
  onBuy: (id: string) => void;
}): React.ReactElement {
  const listed = catalog.filter((item) => item.known && PRODUCT_IDS.includes(item.id));

  return (
    <section className="premium-block" aria-label={t('shop.premium')}>
      <div className="premium-head">
        <h3 className="shop-section-title">{t('shop.premium')}</h3>
        <span className="premium-note">{available ? t('shop.premiumHint') : t('shop.premiumOffline')}</span>
      </div>

      {listed.length === 0 ? (
        <p className="shop-hint premium-empty">{available ? t('shop.premiumEmpty') : t('shop.premiumOffline')}</p>
      ) : (
        <div className="premium-grid">
          {listed.map((item) => {
            const isOwned = owned.includes(item.id);
            const busy = buying === item.id;
            const def = productDef(item.id);
            return (
              <article key={item.id} className={`premium-card${isOwned ? ' premium-card-owned' : ''}`} data-product={item.id}>
                <span className="premium-icon" aria-hidden="true">
                  {def?.icon ?? '💎'}
                </span>
                <b className="premium-title">{t(def?.titleKey ?? 'shop.premium')}</b>
                <span className="premium-hint">{t(def?.hintKey ?? 'shop.premiumHint')}</span>
                <span className="premium-price">
                  {item.priceImage ? <img src={item.priceImage} alt="" className="premium-price-icon" /> : null}
                  {item.price}
                </span>
                <Button
                  size="sm"
                  tone={isOwned ? 'ghost' : 'secondary'}
                  disabled={isOwned || buying !== null || !available}
                  className="premium-buy"
                  onClick={() => {
                    audio.unlock();
                    onBuy(item.id);
                  }}
                >
                  {isOwned ? t('purchase.owned') : busy ? t('purchase.processing') : t('purchase.buy')}
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function describeBonus(item: ShopItem): string {
  const bonus = item.bonus ?? EMPTY_BONUS;
  const parts: string[] = [];
  if (bonus.bonusMoves) parts.push(`+${bonus.bonusMoves} хода на уровень`);
  if (bonus.bonusHints) parts.push(`+${bonus.bonusHints} подсказка`);
  if (bonus.bonusUndos) parts.push(`+${bonus.bonusUndos} отмена`);
  if (bonus.coinBonus) parts.push(`+${Math.round(bonus.coinBonus * 100)}% монет`);
  return parts.join(' · ');
}
