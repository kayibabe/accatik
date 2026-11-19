import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SLATE_FILTER_STATE,
  SLATE_FILTER_STORAGE_KEY,
  loadSlateFilterState,
  parseSlateFilterState,
  saveSlateFilterState,
} from './slateFilterState.ts';
import type { SlateFilterState } from './slateFilterState.ts';

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const asStorage = (storage: MemoryStorage) => storage as unknown as Storage;

const activeState: SlateFilterState = {
  angle: 'High',
  marketType: '1X2',
  minProbability: 70,
  minModelEdge: 5,
  kickoffWindowHours: 6,
  minOddsInput: '1.5',
  maxOddsInput: '2,4',
};

test('a missing or malformed save falls back to no filters', () => {
  assert.deepEqual(parseSlateFilterState(null), DEFAULT_SLATE_FILTER_STATE);
  assert.deepEqual(parseSlateFilterState('nope'), DEFAULT_SLATE_FILTER_STATE);
  assert.deepEqual(parseSlateFilterState([]), DEFAULT_SLATE_FILTER_STATE);
  assert.deepEqual(loadSlateFilterState(null), DEFAULT_SLATE_FILTER_STATE);

  const storage = new MemoryStorage();
  storage.setItem(SLATE_FILTER_STORAGE_KEY, '{not json');
  assert.deepEqual(loadSlateFilterState(asStorage(storage)), DEFAULT_SLATE_FILTER_STATE);
});

test('a saved filter set round-trips', () => {
  const storage = new MemoryStorage();
  saveSlateFilterState(activeState, asStorage(storage));

  assert.equal(storage.getItem(SLATE_FILTER_STORAGE_KEY) !== null, true);
  assert.deepEqual(loadSlateFilterState(asStorage(storage)), activeState);
});

test('unknown chip values are ignored one by one', () => {
  const parsed = parseSlateFilterState({
    angle: 'Superb',
    marketType: 'Corners',
    minProbability: 55,
    minModelEdge: 7,
    kickoffWindowHours: 3,
    minOddsInput: 'lots',
    maxOddsInput: '12.3456',
  });

  assert.deepEqual(parsed, DEFAULT_SLATE_FILTER_STATE);
});

test('valid values survive beside invalid ones', () => {
  const parsed = parseSlateFilterState({
    angle: 'Moderate',
    marketType: 'all',
    minProbability: 80,
    minModelEdge: 3,
    kickoffWindowHours: 12,
    minOddsInput: '1.85',
    maxOddsInput: '',
  });

  assert.deepEqual(parsed, {
    angle: 'Moderate',
    marketType: 'all',
    minProbability: 80,
    minModelEdge: 3,
    kickoffWindowHours: 12,
    minOddsInput: '1.85',
    maxOddsInput: '',
  });
});

test('storage failures never break the board', () => {
  const brokenStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  } as unknown as Storage;

  assert.deepEqual(loadSlateFilterState(brokenStorage), DEFAULT_SLATE_FILTER_STATE);
  assert.doesNotThrow(() => saveSlateFilterState(activeState, brokenStorage));
});
