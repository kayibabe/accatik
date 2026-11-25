import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketKey } from '../framework/config.ts';
import {
  buildScorelineMatrix,
  deriveMarketProbabilities,
} from '../framework/scoreline.ts';
import type { MarketOption, MarketType } from '../types/fixtures.ts';
import { getMarketXg } from './marketXg.ts';
import { makeFixture } from './testFactories.ts';

const IDS: Partial<Record<MarketKey, string>> = {
  '1X2-H': '1-1x2-h',
  '1X2-D': '1-1x2-d',
  '1X2-A': '1-1x2-a',
  'GOALS-O2.5': '1-ou-25',
  'GOALS-U2.5': '1-ou-u25',
};

const TYPES: Partial<Record<MarketKey, MarketType>> = {
  '1X2-H': '1X2',
  '1X2-D': '1X2',
  '1X2-A': '1X2',
  'GOALS-O2.5': 'Goals',
  'GOALS-U2.5': 'Goals',
};

const LABELS: Partial<Record<MarketKey, string>> = {
  '1X2-H': 'Home Win',
  '1X2-D': 'Draw',
  '1X2-A': 'Away Win',
  'GOALS-O2.5': 'Over 2.5 Goals',
  'GOALS-U2.5': 'Under 2.5 Goals',
};

function priced(key: MarketKey, probability: number): MarketOption {
  const percent = probability * 100;
  return {
    id: IDS[key] ?? `1-${key}`,
    marketType: TYPES[key] ?? '1X2',
    label: LABELS[key] ?? key,
    odds: 1 / Math.max(probability, 0.01),
    impliedProbability: percent,
    fairProbability: percent,
    rationale: '',
  };
}

function fixtureFromLambdas(lambdaHome: number, lambdaAway: number) {
  const probabilities = deriveMarketProbabilities(
    buildScorelineMatrix(lambdaHome, lambdaAway, 0, 10).matrix
  );
  const keys: MarketKey[] = [
    '1X2-H',
    '1X2-D',
    '1X2-A',
    'GOALS-O2.5',
    'GOALS-U2.5',
  ];
  return makeFixture({
    id: 'market-xg',
    markets: keys.map((key) => priced(key, probabilities[key])),
  });
}

test('recovers expected goals from a complete 1X2 and Over/Under 2.5 book', () => {
  const xg = getMarketXg(fixtureFromLambdas(1.6, 0.9));
  assert.ok(xg);
  assert.ok(Math.abs(xg.home - 1.6) < 0.08, `home was ${xg.home}`);
  assert.ok(Math.abs(xg.away - 0.9) < 0.08, `away was ${xg.away}`);
});

test('an away-strong price split produces a higher away lambda', () => {
  const xg = getMarketXg(fixtureFromLambdas(0.8, 1.7));
  assert.ok(xg);
  assert.ok(xg.away > xg.home);
});

test('missing parts of the book do not produce an estimate', () => {
  const complete = fixtureFromLambdas(1.2, 1.1);
  const withoutDraw = {
    ...complete,
    markets: complete.markets.filter((market) => !market.id.endsWith('-1x2-d')),
  };
  assert.equal(getMarketXg(withoutDraw), null);

  const withoutGoalLine = {
    ...complete,
    markets: complete.markets.filter((market) => market.id !== '1-ou-25'),
  };
  assert.equal(getMarketXg(withoutGoalLine), null);
});
