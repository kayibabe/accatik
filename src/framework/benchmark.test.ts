import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBenchmark } from './benchmark.ts';

const close = (a: number, b: number, tolerance = 1e-9): boolean =>
  Math.abs(a - b) <= tolerance;

test('the sharpest complete 1X2 book is the benchmark', () => {
  const result = buildBenchmark([
    { selectionKey: '1X2-H', odds: 2.0, bookmaker: 'Wide' },
    { selectionKey: '1X2-D', odds: 3.5, bookmaker: 'Wide' },
    { selectionKey: '1X2-A', odds: 4.0, bookmaker: 'Wide' },
    { selectionKey: '1X2-H', odds: 2.1, bookmaker: 'Sharp' },
    { selectionKey: '1X2-D', odds: 3.4, bookmaker: 'Sharp' },
    { selectionKey: '1X2-A', odds: 3.8, bookmaker: 'Sharp' },
  ]);

  assert.equal(result.benchmarkBook, 'Sharp');
  const home = result.entries.get('1X2-H');
  assert.equal(home?.book, 'Sharp');
  assert.equal(home?.complete, true);
  const total =
    (result.entries.get('1X2-H')?.pFair ?? 0) +
    (result.entries.get('1X2-D')?.pFair ?? 0) +
    (result.entries.get('1X2-A')?.pFair ?? 0);
  assert.ok(close(total, 1));
});

test('Double Chance is derived from the complete 1X2 market', () => {
  const result = buildBenchmark([
    { selectionKey: '1X2-H', odds: 2.0, bookmaker: 'A' },
    { selectionKey: '1X2-D', odds: 3.5, bookmaker: 'A' },
    { selectionKey: '1X2-A', odds: 4.0, bookmaker: 'A' },
  ]);
  const home = result.entries.get('1X2-H')?.pFair ?? 0;
  const draw = result.entries.get('1X2-D')?.pFair ?? 0;
  const away = result.entries.get('1X2-A')?.pFair ?? 0;
  assert.ok(close(result.entries.get('DC-1X')?.pFair ?? 0, home + draw));
  assert.ok(close(result.entries.get('DC-X2')?.pFair ?? 0, draw + away));
  assert.ok(close(result.entries.get('DC-12')?.pFair ?? 0, home + away));
});

test('a complete two-way market is de-vigged at its own book', () => {
  const result = buildBenchmark([
    { selectionKey: 'GOALS-O2.5', odds: 1.9, bookmaker: 'B' },
    { selectionKey: 'GOALS-U2.5', odds: 1.95, bookmaker: 'B' },
  ]);
  const over = result.entries.get('GOALS-O2.5');
  assert.equal(over?.complete, true);
  assert.equal(over?.book, 'B');
  assert.ok((over?.pFair ?? 0) > 0.5);
});

test('a one-sided market is approximated and marked incomplete', () => {
  const result = buildBenchmark([
    { selectionKey: 'GOALS-O2.5', odds: 1.9, bookmaker: 'B' },
  ]);
  const over = result.entries.get('GOALS-O2.5');
  assert.equal(over?.complete, false);
  assert.ok((over?.pFair ?? 0) > 0);
  assert.ok((over?.pFair ?? 0) < 1 / 1.9);
});

test('markets from different books are never blended', () => {
  const result = buildBenchmark([
    { selectionKey: '1X2-H', odds: 2.0, bookmaker: 'A' },
    { selectionKey: '1X2-D', odds: 3.5, bookmaker: 'A' },
    { selectionKey: '1X2-A', odds: 4.0, bookmaker: 'A' },
    { selectionKey: 'GOALS-O2.5', odds: 1.9, bookmaker: 'B' },
    { selectionKey: 'GOALS-U2.5', odds: 1.95, bookmaker: 'B' },
  ]);
  assert.equal(result.entries.get('1X2-H')?.book, 'A');
  assert.equal(result.entries.get('GOALS-O2.5')?.book, 'B');
});
