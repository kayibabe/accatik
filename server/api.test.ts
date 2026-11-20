import test from 'node:test';
import assert from 'node:assert/strict';
import { needsPredictionRefresh } from './api.ts';
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
