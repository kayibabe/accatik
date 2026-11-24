import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoiAccaTicket, needsPredictionRefresh, parseMinScore } from './api.ts';
import { makeFixture } from '../src/utils/testFactories.ts';

test('a fixture without durable model data needs a prediction fetch', () => {
  const fixture = makeFixture({ id: 'fresh' });
  assert.equal(needsPredictionRefresh(fixture, false), true);
});

test('a durable model snapshot suppresses refetches until explicitly forced', () => {
  const fixture = makeFixture({
    id: 'archived',
    modelDataAt: '2026-11-20T10:00:00.000Z',
  });
  assert.equal(needsPredictionRefresh(fixture, false), false);
  assert.equal(needsPredictionRefresh(fixture, true), true);
});

test('a missing fixture never triggers a prediction fetch', () => {
  assert.equal(needsPredictionRefresh(undefined, true), false);
});

test('model-score bar defaults to off and clamps to 0..100', () => {
  assert.equal(parseMinScore(undefined), 0);
  assert.equal(parseMinScore('not a score'), 0);
  assert.equal(parseMinScore(-20), 0);
  assert.equal(parseMinScore(140), 100);
  assert.equal(parseMinScore('72'), 72);
});

test('ROI accumulator requests cannot opt into live staking', async () => {
  const result = await buildRoiAccaTicket({ strategy: 'balanced', stake: 100 });
  assert.equal(result.status, 400);
  assert.match(JSON.stringify(result.body), /research\/shadow-only/);
});
