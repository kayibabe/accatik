import test from 'node:test';
import assert from 'node:assert/strict';
import type { DailySlateResponse } from '../types/fixtures.ts';
import {
  deleteCachedSlate,
  getCachedSlateOwner,
  readCachedSlate,
  setCachedSlateOwner,
  writeCachedSlate,
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

function response(dateIso: string): DailySlateResponse {
  return {
    date: dateIso,
    displayDate: dateIso,
    timezoneLabel: 'CAT (GMT+2) Kickoff Times',
    dataProvider: 'API-Football Pro',
    strategy: 'balanced',
    minOdds: 2.8,
    strategyName: 'Balanced',
    strategySummary: 'Balanced summary',
    fixtures: [makeFixture({ id: `fixture-${dateIso}` })],
    recommendedLegIds: [],
    sources: [],
    cachedAt: `${dateIso}T10:00:00.000Z`,
  };
}

test('slates are cached by match date only', () => {
  useStorage(() => {
    const slate = response('2026-11-20');
    writeCachedSlate('2026-11-20', slate);

    assert.deepEqual(readCachedSlate('2026-11-20'), slate);
    assert.equal(readCachedSlate('2026-11-21'), null);
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

test('the cache keeps only the eight most recent matchdays', () => {
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
