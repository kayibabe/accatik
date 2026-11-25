import test from 'node:test';
import assert from 'node:assert/strict';
import type { AccaStrategy, DailySlateResponse } from '../types/fixtures.ts';
import {
  deleteCachedSlate,
  getCachedSlateOwner,
  readCachedSlate,
  setCachedSlateOwner,
  writeCachedSlate,
  type SlateCacheControls,
} from './slateClientCache.ts';
import { makeFixture } from './testFactories.ts';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }
}

function useStorage<T>(run: (storage: MemoryStorage) => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  });
  const originalNow = Date.now;
  let now = Date.UTC(2026, 10, 20, 12, 0);
  Date.now = () => now;

  try {
    return run(storage);
  } finally {
    Date.now = originalNow;
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function cacheControls(
  overrides: Partial<SlateCacheControls> = {}
): SlateCacheControls {
  return {
    strategy: (overrides.strategy ?? 'balanced') as AccaStrategy,
    minOdds: overrides.minOdds ?? 2.8,
    maxLegs: overrides.maxLegs ?? 3,
  };
}

function response(
  dateIso: string,
  controls: SlateCacheControls = cacheControls()
): DailySlateResponse {
  const resolved = cacheControls(controls);
  return {
    date: dateIso,
    displayDate: dateIso,
    timezoneLabel: 'CAT (GMT+2) Kickoff Times',
    dataProvider: 'API-Football Pro',
    strategy: resolved.strategy,
    minOdds: resolved.minOdds,
    strategyName: 'Balanced',
    strategySummary: 'Balanced summary',
    fixtures: [makeFixture({ id: `fixture-${dateIso}` })],
    recommendedLegIds: [],
    sources: [],
    cachedAt: `${dateIso}T10:00:00.000Z`,
  };
}

test('slates are cached per matchday and control combination', () => {
  useStorage(() => {
    const balanced = cacheControls();
    const favorites = cacheControls({ strategy: 'favorites', minOdds: 3.5, maxLegs: 4 });
    writeCachedSlate('2026-11-20', response('2026-11-20', balanced), balanced);
    writeCachedSlate('2026-11-20', response('2026-11-20', favorites), favorites);

    assert.deepEqual(readCachedSlate('2026-11-20', balanced), response('2026-11-20', balanced));
    assert.deepEqual(readCachedSlate('2026-11-20', favorites), response('2026-11-20', favorites));
    assert.equal(readCachedSlate('2026-11-21', balanced), null);
    assert.equal(
      readCachedSlate('2026-11-20', cacheControls({ strategy: 'goals' })),
      null
    );
    assert.equal(readCachedSlate('2026-11-20', cacheControls({ minOdds: 4 })), null);
    assert.equal(readCachedSlate('2026-11-20', cacheControls({ maxLegs: 5 })), null);
  });
});

test('a cached response whose controls do not match the request is rejected', () => {
  useStorage((storage) => {
    const balanced = cacheControls();
    const cached = response('2026-11-20', balanced);
    storage.setItem(
      'matchslip_slate_cache_v1',
      JSON.stringify({
        '2026-11-20|favorites|2.8|3': { storedAt: Date.now(), response: cached },
      })
    );
    assert.equal(
      readCachedSlate('2026-11-20', cacheControls({ strategy: 'favorites' })),
      null
    );
    // The mismatched entry is dropped even though its storage key existed.
    assert.deepEqual(JSON.parse(storage.getItem('matchslip_slate_cache_v1') ?? '{}'), {});
  });
});

test('an expired entry is dropped instead of reused', () => {
  useStorage((storage) => {
    writeCachedSlate('2026-11-20', response('2026-11-20'));
    assert.ok(storage.getItem('matchslip_slate_cache_v1'));

    // 30 minutes plus one tick.
    Date.now = () => Date.UTC(2026, 10, 20, 12, 30, 0, 1);
    assert.equal(readCachedSlate('2026-11-20'), null);
    assert.equal(storage.getItem('matchslip_slate_cache_v1'), '{}');
  });
});

test('the cache keeps only the eight most recent entries', () => {
  useStorage(() => {
    const originalNow = Date.now;
    let now = Date.UTC(2026, 10, 1, 12, 0);
    Date.now = () => now;
    try {
      for (let day = 1; day <= 10; day += 1) {
        const dateIso = `2026-11-${String(day).padStart(2, '0')}`;
        writeCachedSlate(dateIso, response(dateIso));
        now += 60_000;
      }

      assert.equal(readCachedSlate('2026-11-01'), null);
      assert.equal(readCachedSlate('2026-11-02'), null);
      assert.ok(readCachedSlate('2026-11-03'));
      assert.ok(readCachedSlate('2026-11-10'));
    } finally {
      Date.now = originalNow;
    }
  });
});

test('deleting one date clears every control variant for that matchday', () => {
  useStorage(() => {
    const balanced = cacheControls();
    const favorites = cacheControls({ strategy: 'favorites' });
    writeCachedSlate('2026-11-20', response('2026-11-20', balanced), balanced);
    writeCachedSlate('2026-11-20', response('2026-11-20', favorites), favorites);
    writeCachedSlate('2026-11-21', response('2026-11-21', balanced), balanced);

    deleteCachedSlate('2026-11-20');

    assert.equal(readCachedSlate('2026-11-20', balanced), null);
    assert.equal(readCachedSlate('2026-11-20', favorites), null);
    assert.ok(readCachedSlate('2026-11-21', balanced));
  });
});

test('changing identity clears the priced cache and its owner', () => {
  useStorage(() => {
    setCachedSlateOwner('user-a');
    writeCachedSlate('2026-11-20', response('2026-11-20'));
    assert.equal(getCachedSlateOwner(), 'user-a');

    deleteCachedSlate();

    assert.equal(getCachedSlateOwner(), null);
    assert.equal(readCachedSlate('2026-11-20'), null);
  });
});

test('corrupt storage degrades to a network fetch', () => {
  useStorage((storage) => {
    storage.setItem('matchslip_slate_cache_v1', '{not json');
    assert.equal(readCachedSlate('2026-11-20'), null);
  });
});
