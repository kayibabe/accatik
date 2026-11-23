import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeResearchLegs } from './researchSlip.ts';
import { makeLeg } from './testFactories.ts';

test('a research merge keeps every leg beyond the five-leg recommendation cap', () => {
  const incoming = Array.from({ length: 8 }, (_, index) =>
    makeLeg(`f${index}`, `f${index}-ou25o`, 2 + index / 10)
  );

  const merged = mergeResearchLegs([], incoming);

  assert.equal(merged.length, 8);
  assert.equal(new Set(merged.map((leg) => leg.fixtureId)).size, 8);
  assert.deepEqual(
    merged.map((leg) => leg.odds),
    incoming.map((leg) => leg.odds)
  );
});

test('a research merge replaces the held leg for the same fixture', () => {
  const existing = makeLeg('f0', 'old-market', 1.8, { homeTeam: 'Old Home' });
  const replacement = makeLeg('f0', 'new-market', 2.4, { homeTeam: 'New Home' });
  const added = makeLeg('f1', 'f1-market', 2.1);

  const merged = mergeResearchLegs([existing], [replacement, added]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].marketId, 'new-market');
  assert.equal(merged[0].odds, 2.4);
  assert.equal(merged[0].homeTeam, 'New Home');
  assert.equal(merged[1].fixtureId, 'f1');
  assert.deepEqual(
    existing,
    makeLeg('f0', 'old-market', 1.8, { homeTeam: 'Old Home' })
  );
});

test('a research merge keeps one leg per incoming fixture', () => {
  const first = makeLeg('f1', 'first-market', 2.1);
  const duplicate = makeLeg('f1', 'second-market', 3.1);

  const merged = mergeResearchLegs([], [first, duplicate]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].marketId, 'first-market');
});
