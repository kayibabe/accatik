import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleConfidence,
  buildRecommendedAngle,
} from './recommendedAngle.ts';
import { makeFixture, makeMarket } from './testFactories.ts';

/** 1X2 trio with the home side as the most likely outcome. */
const trio = () => [
  makeMarket('f-1x2-h', 2.0, '1X2', 'Home Win'),
  makeMarket('f-1x2-d', 3.5, '1X2', 'Draw'),
  makeMarket('f-1x2-a', 4.0, '1X2', 'Away Win'),
];

test('an unpriced fixture has no angle', () => {
  assert.equal(
    buildRecommendedAngle(makeFixture({ id: 'f1', markets: [] }), 'balanced'),
    null
  );

  const unpriced = makeFixture({
    id: 'f2',
    markets: [makeMarket('f-1x2-h', 1)],
  });
  assert.equal(buildRecommendedAngle(unpriced, 'balanced'), null);
});

test('balanced mode follows the recommended pick', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: trio(),
    recommendedPickId: 'f-1x2-a',
  });

  const angle = buildRecommendedAngle(fixture, 'balanced');
  assert.equal(angle?.market.id, 'f-1x2-a');
  assert.equal(angle?.probability, 25);
  assert.equal(angle?.confidence, 'Speculative');
});

test('probability mode overrides the recommended pick with the most likely', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: trio(),
    recommendedPickId: 'f-1x2-a',
  });

  const angle = buildRecommendedAngle(fixture, 'probability');
  assert.equal(angle?.market.id, 'f-1x2-h');
  assert.equal(angle?.probability, 50);
  assert.equal(angle?.confidence, 'Moderate');
});

test('confidence bands sit on their thresholds', () => {
  assert.equal(angleConfidence(70), 'High');
  assert.equal(angleConfidence(69.9), 'Solid');
  assert.equal(angleConfidence(52), 'Solid');
  assert.equal(angleConfidence(51.9), 'Moderate');
  assert.equal(angleConfidence(38), 'Moderate');
  assert.equal(angleConfidence(37.9), 'Speculative');
});

test('the cover is a safer outcome from a different market', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: [
      ...trio(),
      makeMarket('f-ou-15', 1.25, 'Goals', 'Over 1.5 Goals'),
      makeMarket('f-btts-y', 1.4, 'BTTS', 'BTTS Yes'),
    ],
    recommendedPickId: 'f-1x2-a',
  });

  const angle = buildRecommendedAngle(fixture, 'balanced');
  assert.equal(angle?.market.id, 'f-1x2-a');
  // Over 1.5 Goals (80%) beats BTTS Yes (71.4%) among safer options.
  assert.equal(angle?.cover?.id, 'f-ou-15');
  assert.equal(angle?.coverProbability, 80);
});

test('a safer side of the same market is not a cover', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: [
      makeMarket('f-1x2-h', 1.5, '1X2', 'Home Win'),
      makeMarket('f-1x2-a', 4.0, '1X2', 'Away Win'),
      makeMarket('f-ou-25', 5.0, 'Goals', 'Over 2.5 Goals'),
    ],
    recommendedPickId: 'f-1x2-a',
  });

  const angle = buildRecommendedAngle(fixture, 'balanced');
  // Home Win is safer but same type; the only other-type market is riskier.
  assert.equal(angle?.cover, null);
  assert.equal(angle?.coverProbability, 0);
});

test('no cover when the primary is already the safest priced bet', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: [
      makeMarket('f-1x2-h', 1.25, '1X2', 'Home Win'),
      makeMarket('f-1x2-a', 4.0, '1X2', 'Away Win'),
      makeMarket('f-ou-15', 1.4, 'Goals', 'Over 1.5 Goals'),
    ],
    recommendedPickId: 'f-1x2-h',
  });

  const angle = buildRecommendedAngle(fixture, 'balanced');
  assert.equal(angle?.confidence, 'High');
  assert.equal(angle?.cover, null);
});

test('the note matches the confidence band', () => {
  const fixture = makeFixture({
    id: 'f1',
    markets: trio(),
    recommendedPickId: 'f-1x2-d',
  });

  const angle = buildRecommendedAngle(fixture, 'balanced');
  assert.equal(angle?.confidence, 'Speculative');
  assert.match(angle?.note ?? '', /Long shot/);
});
