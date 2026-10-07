/**
 * In-app purchases on top of the Yandex Games SDK.
 *
 * Documented API used here
 * (https://yandex.com/dev/games/doc/en/sdk/sdk-purchases):
 *   - the `ysdk.payments` object (`getPayments()` is only the preloader);
 *   - `payments.getCatalog()` — the products of the Console, each with a real
 *     price: the portal currency must come from `price` / `priceCurrencyCode` /
 *     `getPriceCurrencyImage()` (requirement 1.13.2), never hardcoded;
 *   - `payments.purchase({ id })` — opens the payment window; the promise
 *     rejects when the player closed it or the purchase failed;
 *   - `payments.consumePurchase(token)` — deletes a consumable purchase for
 *     good, so it must be called **after** the reward was credited;
 *   - `payments.getPurchases()` — the mandatory check of unprocessed purchases
 *     (requirement 1.13.1): a purchase paid while the network died must be
 *     credited on the next launch.
 *
 * The order matters and is exactly the one from the docs: credit first, consume
 * second. A failure anywhere in between leaves the purchase unconsumed, so the
 * next launch will find it again — the player never loses what they paid for
 * and never gets it twice.
 *
 * Without the platform (the web build, a draft without purchases enabled) the
 * module reports why and the shop simply hides the section.
 */
import { isYandex, paymentsApi, type SdkPayments, type SdkProduct, type SdkPurchase } from './yandex';
import { localStorageAdapter } from '../store/persistence';

/** Booster packs a product may grant (ids from `core/boosters`). */
export interface PurchaseReward {
  coins: number;
  boosters: Partial<Record<'hammer' | 'shuffle' | 'extraMove' | 'undo', number>>;
}

export interface ProductDef {
  /** Product ID — must match the Console field exactly. */
  id: string;
  icon: string;
  titleKey: string;
  hintKey: string;
  reward: PurchaseReward;
  /** `'consumable'` is credited and consumed; `'permanent'` is owned forever. */
  kind: 'consumable' | 'permanent';
}

/**
 * The three products of the Console (tab «Покупки»). Ids are the technical
 * contract: the same strings must be created in the draft.
 */
export const PRODUCTS: readonly ProductDef[] = [
  {
    id: 'coins_small',
    icon: '🪙',
    titleKey: 'shop.buyCoinsSmall',
    hintKey: 'shop.buyCoinsSmallHint',
    reward: { coins: 1_200, boosters: {} },
    kind: 'consumable',
  },
  {
    id: 'coins_big',
    icon: '💰',
    titleKey: 'shop.buyCoinsBig',
    hintKey: 'shop.buyCoinsBigHint',
    reward: { coins: 4_000, boosters: {} },
    kind: 'consumable',
  },
  {
    id: 'boosters_pack',
    icon: '🧰',
    titleKey: 'shop.buyBoosters',
    hintKey: 'shop.buyBoostersHint',
    reward: { coins: 0, boosters: { hammer: 5, shuffle: 5, extraMove: 3, undo: 5 } },
    kind: 'consumable',
  },
  {
    id: 'remove_ads',
    icon: '📺',
    titleKey: 'shop.buyNoAds',
    hintKey: 'shop.buyNoAdsHint',
    reward: { coins: 0, boosters: {} },
    kind: 'permanent',
  },
  {
    id: 'starter_pack',
    icon: '🎁',
    titleKey: 'shop.buyStarter',
    hintKey: 'shop.buyStarterHint',
    reward: { coins: 2_500, boosters: { hammer: 3, shuffle: 3, extraMove: 2, undo: 3 } },
    kind: 'consumable',
  },
];

export const PRODUCT_IDS: string[] = PRODUCTS.map((product) => product.id);

export function productDef(id: string): ProductDef | null {
  return PRODUCTS.find((product) => product.id === id) ?? null;
}

export type PurchasesPhase = 'idle' | 'disabled' | 'unavailable' | 'ready' | 'buying' | 'error';

export type PurchasesReason =
  | 'no-platform'
  | 'no-api'
  | 'cancelled'
  | 'failed'
  | 'unknown-product'
  | 'offline'
  | null;

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  /** Price with the currency code, exactly as the portal gave it. */
  price: string;
  priceValue: string;
  priceCurrencyCode: string;
  /** Currency icon URL from `getPriceCurrencyImage()`, `null` without one. */
  priceImage: string | null;
  /** `false` for a Console product the game does not know how to grant. */
  known: boolean;
}

export interface PurchasesStatus {
  /** The platform and its payments object are present. */
  available: boolean;
  phase: PurchasesPhase;
  reason: PurchasesReason;
  catalog: CatalogItem[];
  loadedAt: number | null;
  /** Products that were credited at least once in this session. */
  purchased: string[];
  /** Purchase tokens that are paid but not consumed yet (retried on launch). */
  pending: number;
  /** Products the player owns forever (`getPurchases()` found them). */
  owned: string[];
  buying: string | null;
  lastProduct: string | null;
  error: string | null;
}

/**
 * What the module needs from the game: crediting the reward.
 * `apply` must return `true` only when the reward really reached the save — the
 * purchase is consumed after that, never before. For a permanent product the
 * empty reward is still reported, so the game can mark it owned in its own save.
 */
export interface PurchasesHost {
  apply: (id: string, reward: PurchaseReward) => boolean;
  /** Products the save already knows about (used to skip a double credit). */
  owned?: () => string[];
}

/** Product id of the non-consumable «no ads» item (requirement 4.4). */
export const NO_ADS_PRODUCT = 'remove_ads';

/** `true` when the player owned the ad-free product before this session. */
export function ownedBeforeSession(id: string = NO_ADS_PRODUCT): boolean {
  return status.owned.includes(id);
}

export function emptyPurchasesStatus(): PurchasesStatus {
  return {
    available: false,
    phase: 'idle',
    reason: null,
    catalog: [],
    loadedAt: null,
    purchased: [],
    pending: 0,
    owned: [],
    buying: null,
    lastProduct: null,
    error: null,
  };
}

// --------------------------------------------------------------- pure helpers

/** Normalizes whatever `getCatalog()` returned into the rows the shop renders. */
export function catalogFrom(products: SdkProduct[], known: readonly ProductDef[] = PRODUCTS): CatalogItem[] {
  const ids = new Set(known.map((product) => product.id));
  const result: CatalogItem[] = [];
  for (const product of products) {
    const id = typeof product?.id === 'string' ? product.id : '';
    if (id.length === 0 || result.some((item) => item.id === id)) continue;

    let priceImage: string | null = null;
    try {
      const url = product.getPriceCurrencyImage?.('small');
      priceImage = typeof url === 'string' && url.length > 0 ? url : null;
    } catch {
      priceImage = null;
    }

    const priceValue = typeof product.priceValue === 'string' ? product.priceValue : '';
    const currency = typeof product.priceCurrencyCode === 'string' ? product.priceCurrencyCode : '';
    result.push({
      id,
      title: typeof product.title === 'string' ? product.title : '',
      description: typeof product.description === 'string' ? product.description : '',
      price: typeof product.price === 'string' && product.price.length > 0 ? product.price : `${priceValue} ${currency}`.trim(),
      priceValue,
      priceCurrencyCode: currency,
      priceImage,
      known: ids.has(id),
    });
  }
  return result;
}

/** `getPurchases()` may answer with a signed payload — that mode is not ours. */
export function purchasesFrom(answer: SdkPurchase[] | { signature: string } | null | undefined): SdkPurchase[] {
  if (Array.isArray(answer)) return answer;
  return [];
}

// ------------------------------------------------------------------- live part

let api: SdkPayments | null = null;
let host: PurchasesHost | null = null;
let status: PurchasesStatus = emptyPurchasesStatus();

const listeners = new Set<(value: PurchasesStatus) => void>();
const REQUEST_TIMEOUT_MS = 10_000;
/** Where the ids of the products bought in this session are remembered. */
const OWNED_KEY = 'shelf-sort:purchases:owned';

export function purchasesStatus(): PurchasesStatus {
  return { ...status, catalog: [...status.catalog], purchased: [...status.purchased], owned: [...status.owned] };
}

export function subscribePurchases(listener: (value: PurchasesStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(patch: Partial<PurchasesStatus>): PurchasesStatus {
  status = { ...status, ...patch };
  const snapshot = purchasesStatus();
  for (const listener of [...listeners]) listener(snapshot);
  return snapshot;
}

/**
 * The store injects itself once. The module never imports the store: that is
 * the rule that keeps every platform module free of cycles.
 */
export function connectPurchases(next: PurchasesHost | null = null): void {
  if (next) host = next;
}

/** A player who paid once is `'paying'` — the Console can target flags at them. */
export function payingStatus(): string {
  return status.purchased.length > 0 || status.owned.length > 0 ? 'paying' : 'not_paying';
}

/**
 * The `payingStatus` client feature of the flags request. The local ledger is
 * read too: on the very first frames of a launch the purchases are not answered
 * yet, but a player who paid earlier must still count as paying.
 */
export function payingFeature(): string {
  return status.owned.length > 0 || readOwned().length > 0 ? 'paying' : 'not_paying';
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), REQUEST_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ------------------------------------------------------- ownership bookkeeping

/**
 * Owned products are remembered locally too: `getPurchases()` answers slowly
 * under throttling, and a permanently owned item must never look lost.
 */
function readOwned(): string[] {
  try {
    const raw = localStorageAdapter()?.getItem(OWNED_KEY) ?? null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

function writeOwned(ids: string[]): void {
  try {
    localStorageAdapter()?.setItem(OWNED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* ignore: the list then lives only in memory */
  }
}

// -------------------------------------------------------------------- startup

/**
 * Connects the payments: the API object, the catalog and the mandatory pass
 * over unprocessed purchases. Never rejects — no purchases is a normal state.
 */
export async function initPurchases(next: PurchasesHost | null = null): Promise<PurchasesStatus> {
  if (next) host = next;
  const owned = readOwned();

  if (!isYandex()) {
    api = null;
    return publish({ ...emptyPurchasesStatus(), owned, phase: 'disabled', reason: 'no-platform' });
  }

  publish({ available: false, phase: 'idle', owned, reason: null });
  api = await paymentsApi();
  if (!api) {
    return publish({ available: false, phase: 'unavailable', reason: 'no-api' });
  }

  publish({ available: true, phase: 'ready', reason: null });
  await loadCatalog({ silent: true });
  await processPending();
  return purchasesStatus();
}

/** Reads the Console products with their real prices. */
export async function loadCatalog(options: { silent?: boolean } = {}): Promise<PurchasesStatus> {
  const getCatalog = api?.getCatalog;
  if (!api || typeof getCatalog !== 'function') {
    return publish({ catalog: [], available: Boolean(api), reason: api ? 'no-api' : 'no-platform' });
  }

  try {
    const products = await withTimeout(getCatalog.call(api), 'getCatalog timeout');
    return publish({ catalog: catalogFrom(Array.isArray(products) ? products : []), loadedAt: Date.now(), error: null });
  } catch (error) {
    if (!options.silent) {
      return publish({ phase: 'error', error: error instanceof Error ? error.message : 'error', reason: 'failed' });
    }
    return purchasesStatus();
  }
}

/**
 * The check the docs call mandatory (requirement 1.13.1): every purchase the
 * platform still holds is credited now — the player paid for it while the game
 * was closed or the network died mid-purchase.
 */
export async function processPending(): Promise<PurchasesStatus> {
  const getPurchases = api?.getPurchases;
  if (!api || typeof getPurchases !== 'function') return purchasesStatus();

  let answer: SdkPurchase[] | { signature: string } | null = null;
  try {
    answer = await withTimeout(getPurchases.call(api), 'getPurchases timeout');
  } catch {
    return publish({ reason: 'offline' });
  }

  const purchases = purchasesFrom(answer);
  publish({ pending: purchases.length });
  for (const purchase of purchases) {
    await credit(purchase);
  }
  return purchasesStatus();
}

/**
 * Credits one purchase and then consumes it. The order is the documented one:
 * a consumed purchase is gone forever, so the save must already contain the
 * reward when `consumePurchase()` is called.
 */
async function credit(purchase: SdkPurchase): Promise<boolean> {
  const product = productDef(purchase.productID ?? '');
  const token = typeof purchase.purchaseToken === 'string' ? purchase.purchaseToken : '';
  if (!product || token.length === 0) {
    // An unknown product belongs to another build: leave it for that build.
    return false;
  }
  if (!host) return false;

  const applied = host.apply(product.id, product.reward);
  if (!applied) {
    publish({ reason: 'failed' });
    return false;
  }

  // Permanent products are kept in the save; consumables are consumed at once.
  if (product.kind === 'permanent') {
    const owned = [...new Set([...status.owned, product.id])];
    writeOwned(owned);
    publish({
      owned,
      purchased: [...new Set([...status.purchased, product.id])],
      lastProduct: product.id,
      pending: Math.max(0, status.pending - 1),
    });
    return true;
  }

  const consume = api?.consumePurchase;
  if (typeof consume === 'function') {
    try {
      await withTimeout(consume.call(api, token), 'consumePurchase timeout');
    } catch {
      // Not consumed: the next launch credits it again and tries to consume again.
      publish({ reason: 'failed', error: 'consume' });
      return true;
    }
  }

  publish({
    purchased: [...new Set([...status.purchased, product.id])],
    lastProduct: product.id,
    pending: Math.max(0, status.pending - 1),
    phase: 'ready',
    reason: null,
  });
  return true;
}

/**
 * The «Купить» button. Opens the payment window and, when the player paid,
 * credits the reward and consumes the purchase.
 */
export async function buyProduct(id: string): Promise<PurchasesStatus> {
  const product = productDef(id);
  if (!product) return publish({ reason: 'unknown-product' });

  const purchase = api?.purchase;
  if (!api || typeof purchase !== 'function') {
    return publish({ phase: api ? 'unavailable' : 'disabled', reason: api ? 'no-api' : 'no-platform' });
  }

  publish({ buying: id, phase: 'buying', reason: null, error: null });
  try {
    const result = await withTimeout(purchase.call(api, { id }), 'purchase timeout');
    const record: SdkPurchase = result ?? {};
    const credited = await credit({ ...record, productID: record.productID ?? id });
    if (!credited) return publish({ buying: null, phase: 'error', reason: 'failed' });
    return publish({ buying: null, phase: 'ready', reason: null, error: null });
  } catch (error) {
    // The player closed the payment window or the platform refused —
    // no reward, no error screen, just a quiet explanation.
    return publish({ buying: null, phase: 'ready', reason: 'cancelled', error: null });
  }
}

/** `true` when the product is already owned forever. */
export function isOwned(id: string): boolean {
  return status.owned.includes(id);
}

/** Test seam: forgets the API, the catalog and the counters. */
export function resetPurchases(): void {
  api = null;
  status = emptyPurchasesStatus();
}
