// @vitest-environment jsdom
/**
 * In-app purchases — `platform/purchases.ts`.
 *
 * The portal rules these tests pin (`sdk-purchases`, requirements 1.13.1–1.13.3):
 *   - the price and the currency come from the platform catalog, never from the
 *     game (1.13.2);
 *   - every purchase the platform still holds is processed at launch (1.13.1);
 *   - a consumable is consumed **after** the reward reached the save, so a lost
 *     connection can never eat a paid product;
 *   - a permanent product stays in `getPurchases()` and is never consumed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  NO_ADS_PRODUCT,
  PRODUCT_IDS,
  buyProduct,
  catalogFrom,
  connectPurchases,
  emptyPurchasesStatus,
  initPurchases,
  loadCatalog,
  ownedBeforeSession,
  payingFeature,
  productDef,
  purchasesFrom,
  purchasesStatus,
  resetPurchases,
  subscribePurchases,
} from '../platform/purchases';
import type { SdkProduct, SdkPurchase } from '../platform/yandex';
import { createMockSdk, type MockSdk } from '../platform/mock';
import { initPlatform, resetPlatform } from '../platform/yandex';
import { DEFAULT_PLATFORM, applyPurchaseReward, useGameStore } from '../store/gameStore';

const CATALOG = [
  { id: 'coins_small', title: 'Горсть монет', price: '75 YAN', currency: 'YAN' },
  { id: 'coins_big', title: 'Мешок монет', price: '199 YAN', currency: 'YAN' },
  { id: 'boosters_pack', title: 'Набор бустеров', price: '149 YAN', currency: 'YAN' },
  { id: 'starter_pack', title: 'Стартовый набор', price: '299 YAN', currency: 'YAN' },
  { id: 'remove_ads', title: 'Без рекламы', price: '249 YAN', currency: 'YAN' },
];

async function withMock(options: Parameters<typeof createMockSdk>[0] = {}): Promise<MockSdk> {
  const mock = createMockSdk(options);
  mock.install(window);
  await initPlatform({ windowRef: window });
  return mock;
}

/** Records the order of the calls — «credit first, consume second». */
function recordingHost(log: string[], accept = true) {
  return {
    apply: (id: string) => {
      log.push(`apply:${id}`);
      return accept;
    },
    owned: () => [],
  };
}

function clean(): void {
  resetPurchases();
  resetPlatform();
  window.localStorage.clear();
  delete (window as unknown as { YaGames?: unknown }).YaGames;
  // Back to the host the store injected at import — a test that replaced it
  // must not leak into the next one.
  connectPurchases({ apply: applyPurchaseReward, owned: () => purchasesStatus().owned });
  useGameStore.setState({
    phase: 'menu',
    runtime: null,
    outcome: null,
    platform: { ...DEFAULT_PLATFORM },
    purchases: emptyPurchasesStatus(),
    progress: { ...useGameStore.getState().progress, coins: 0 },
  });
}

afterEach(clean);

describe('catalog of the Console', () => {
  it('takes the price, the currency and its icon from the platform', () => {
    const products: SdkProduct[] = [
      {
        id: 'coins_small',
        title: 'Горсть монет',
        description: '1 200 монет',
        price: '75 YAN',
        priceValue: '75',
        priceCurrencyCode: 'YAN',
        getPriceCurrencyImage: () => 'https://yastatic.net/currency/yan-small.svg',
      },
      { id: 'unknown_thing', title: 'Что-то' },
      { id: 'coins_small', title: 'дубль' },
    ];
    const items = catalogFrom(products);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'coins_small',
      price: '75 YAN',
      priceCurrencyCode: 'YAN',
      priceImage: 'https://yastatic.net/currency/yan-small.svg',
      known: true,
    });
    // A product of another build stays listed, but the game cannot grant it.
    expect(items[1]).toMatchObject({ id: 'unknown_thing', known: false, price: '' });
  });

  it('falls back to the raw price parts and survives a broken currency image', () => {
    const items = catalogFrom([
      {
        id: 'coins_big',
        priceValue: '199',
        priceCurrencyCode: 'YAN',
        getPriceCurrencyImage: () => {
          throw new Error('нет картинки');
        },
      },
    ]);
    expect(items[0]?.price).toBe('199 YAN');
    expect(items[0]?.priceImage).toBeNull();
  });

  it('knows every product the shop shows', () => {
    expect(PRODUCT_IDS).toEqual(['coins_small', 'coins_big', 'boosters_pack', 'remove_ads', 'starter_pack']);
    for (const id of PRODUCT_IDS) {
      expect(productDef(id)).not.toBeNull();
      expect(productDef(id)?.kind).toBe(id === NO_ADS_PRODUCT ? 'permanent' : 'consumable');
    }
    expect(productDef('nope')).toBeNull();
  });

  it('ignores the signed answer of the server mode', () => {
    expect(purchasesFrom({ signature: 'abc' })).toEqual([]);
    const list: SdkPurchase[] = [{ productID: 'coins_small', purchaseToken: 't' }];
    expect(purchasesFrom(list)).toBe(list);
  });
});

describe('without the platform', () => {
  it('reports itself disabled and never rejects', async () => {
    const status = await initPurchases();
    expect(status.phase).toBe('disabled');
    expect(status.reason).toBe('no-platform');
    expect(status.available).toBe(false);
    expect(status.catalog).toEqual([]);
    expect(await buyProduct('coins_small')).toMatchObject({ reason: 'no-platform' });
  });

  it('keeps the remembered ownership of a permanent product', async () => {
    window.localStorage.setItem('shelf-sort:purchases:owned', JSON.stringify([NO_ADS_PRODUCT]));
    const status = await initPurchases();
    expect(status.owned).toContain(NO_ADS_PRODUCT);
    expect(ownedBeforeSession(NO_ADS_PRODUCT)).toBe(true);
    expect(payingFeature()).toBe('paying');
  });
});

describe('with the platform', () => {
  it('reads the catalog and stops at an unknown product id', async () => {
    await withMock({ payments: { enabled: true, catalog: CATALOG } });
    const status = await initPurchases();
    expect(status.available).toBe(true);
    expect(status.phase).toBe('ready');
    expect(status.catalog.map((item) => item.id)).toEqual(CATALOG.map((item) => item.id));
    expect(status.catalog[0]?.price).toBe('75 YAN');
    expect((await buyProduct('не существует')).reason).toBe('unknown-product');
  });

  it('credits a paid product before consuming it', async () => {
    const mock = await withMock({ payments: { enabled: true, catalog: CATALOG } });
    const log: string[] = [];
    connectPurchases(recordingHost(log));
    await initPurchases();

    const status = await buyProduct('coins_big');
    expect(status.reason).toBeNull();
    expect(status.purchased).toContain('coins_big');
    expect(status.lastProduct).toBe('coins_big');
    // The save got the reward before the purchase disappeared for good.
    expect(log).toEqual(['apply:coins_big']);
    expect(mock.pay.consumed).toEqual(['coins_big']);
    expect(mock.calls.payConsume).toBe(1);
    expect(mock.pay.pending).toEqual({});
  });

  it('keeps the purchase when the save refused the reward', async () => {
    const mock = await withMock({ payments: { enabled: true, catalog: CATALOG } });
    connectPurchases(recordingHost([], false));
    await initPurchases();

    const status = await buyProduct('coins_small');
    expect(status.phase).toBe('error');
    expect(status.reason).toBe('failed');
    // Not consumed: the next launch finds it again and credits it once more.
    expect(mock.pay.consumed).toEqual([]);
    expect(Object.values(mock.pay.pending)).toEqual(['coins_small']);
  });

  it('credits the purchases the platform still holds at launch (1.13.1)', async () => {
    const mock = await withMock({ payments: { enabled: true, catalog: CATALOG, pending: ['coins_small', 'boosters_pack'] } });
    const log: string[] = [];
    connectPurchases(recordingHost(log));

    const status = await initPurchases();
    expect(log).toEqual(['apply:coins_small', 'apply:boosters_pack']);
    expect(mock.pay.consumed).toEqual(['coins_small', 'boosters_pack']);
    expect(status.pending).toBe(0);
  });

  it('never consumes a permanent product', async () => {
    const mock = await withMock({ payments: { enabled: true, catalog: CATALOG } });
    const log: string[] = [];
    connectPurchases(recordingHost(log));
    await initPurchases();
    mock.pay.addPending(NO_ADS_PRODUCT);

    await buyProduct(NO_ADS_PRODUCT);
    expect(log).toEqual(['apply:remove_ads']);
    expect(mock.pay.consumed).toEqual([]);
    expect(mock.calls.payConsume).toBe(0);
    expect(ownedBeforeSession(NO_ADS_PRODUCT)).toBe(true);

    // A later launch: the platform returns the non-consumable again, the
    // ownership is already in the ledger and nothing is consumed.
    resetPurchases();
    connectPurchases(recordingHost(log));
    const again = await initPurchases();
    expect(again.owned).toContain(NO_ADS_PRODUCT);
    expect(mock.calls.payConsume).toBe(0);
  });

  it('treats a closed payment window as a normal outcome', async () => {
    const mock = await withMock({ payments: { enabled: true, catalog: CATALOG, decline: true } });
    connectPurchases(recordingHost([]));
    await initPurchases();

    const status = await buyProduct('coins_small');
    expect(status.reason).toBe('cancelled');
    expect(status.phase).toBe('ready');
    expect(status.error).toBeNull();
    expect(mock.calls.payPurchase).toBe(1);
    expect(mock.pay.consumed).toEqual([]);
  });

  it('survives a broken payments API', async () => {
    await withMock({ payments: { enabled: true, fail: true, catalog: CATALOG } });
    const status = await initPurchases();
    expect(status.available).toBe(true);
    // The catalog call failed silently at launch: the shop shows the plug.
    expect(status.catalog).toEqual([]);
    expect((await loadCatalog()).phase).toBe('error');
    expect(purchasesStatus().reason).toBe('failed');
  });

  it('notifies the subscribers about every change', async () => {
    await withMock({ payments: { enabled: true, catalog: CATALOG } });
    const seen: string[] = [];
    const stop = subscribePurchases((value) => seen.push(value.phase));
    connectPurchases(recordingHost([]));
    await initPurchases();
    await buyProduct('coins_small');
    expect(seen).toContain('ready');
    expect(seen).toContain('buying');
    stop();
  });
});

describe('the store side', () => {
  /** Lets the fire-and-forget chain of an action settle. */
  const flush = async (): Promise<void> => {
    for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('credits the coins and the boosters of a pack into the save', async () => {
    await withMock({ payments: { enabled: true, catalog: CATALOG } });
    const store = useGameStore.getState();
    useGameStore.setState({
      progress: {
        ...store.progress,
        coins: 100,
        boosters: { hammer: 0, shuffle: 0, extraMove: 0, undo: 0 },
      },
    });
    // The store injected itself as the host of the module on import, so the
    // real crediting path runs here: coins, boosters and the cloud mirror.
    await initPurchases();
    useGameStore.getState().buyProduct('starter_pack');
    await flush();

    const progress = useGameStore.getState().progress;
    expect(progress.coins).toBe(100 + 2_500);
    expect(progress.boosters).toMatchObject({ hammer: 3, shuffle: 3, extraMove: 2, undo: 3 });
    expect(purchasesStatus().purchased).toContain('starter_pack');
  });
});
