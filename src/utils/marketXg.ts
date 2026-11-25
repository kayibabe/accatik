import {
  buildScorelineMatrix,
  matrixProbability,
} from '../framework/scoreline.ts';
import type { Fixture, MarketOption } from '../types/fixtures.ts';
import { resolveMarketSelection } from './marketSelection.ts';

/**
 * Expected-goals estimate derived from the priced 1X2 and Over/Under 2.5
 * markets, for fixtures the framework could not model (thin team/league
 * history). This is a market-implied projection, not observed xG from a stats
 * feed: label it as such wherever it is shown.
 */

const MIN_LAMBDA = 0.05;
const MAX_LAMBDA = 6;
const MAX_GOALS = 10;

function fairProbability(market: MarketOption): number | null {
  const value = market.fairProbability ?? market.impliedProbability;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value / 100
    : null;
}

function selectionProbabilities(
  fixture: Fixture
): Map<string, number> {
  const best = new Map<string, number>();
  for (const market of fixture.allMarkets ?? fixture.markets) {
    const { key } = resolveMarketSelection(market, fixture);
    const value = fairProbability(market);
    if (value === null) continue;
    // A recapture can price the same selection at two books; the de-vigged
    // fair value is the one the framework itself would compare against.
    if (
      market.fairProbability !== undefined ||
      !best.has(key) ||
      value > (best.get(key) ?? 0)
    ) {
      best.set(key, value);
    }
  }
  return best;
}

/** Inverts Poisson P(total >= 3) to the total-goals lambda. */
function totalLambdaForOver25(target: number): number {
  let low = MIN_LAMBDA;
  let high = MAX_LAMBDA * 2;
  for (let index = 0; index < 50; index += 1) {
    const middle = (low + high) / 2;
    const over = 1 - Math.exp(-middle) * (1 + middle + middle ** 2 / 2);
    if (over < target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Finds the home share of total goals that reproduces the 1X2 win split. */
function homeShareForWinSplit(total: number, targetDiff: number): number {
  let low = 0.02;
  let high = 0.98;
  for (let index = 0; index < 32; index += 1) {
    const share = (low + high) / 2;
    const matrix = buildScorelineMatrix(
      total * share,
      total * (1 - share),
      0,
      MAX_GOALS
    ).matrix;
    const diff =
      matrixProbability(matrix, (home, away) => home > away) -
      matrixProbability(matrix, (home, away) => home < away);
    if (diff < targetDiff) low = share;
    else high = share;
  }
  return (low + high) / 2;
}

/**
 * Returns a market-implied home/away expected-goals pair, or null when the
 * fixture lacks a complete 1X2 book or an Over/Under 2.5 line.
 */
export function getMarketXg(
  fixture: Fixture
): { home: number; away: number } | null {
  const probabilities = selectionProbabilities(fixture);
  const home = probabilities.get('1X2-H');
  const draw = probabilities.get('1X2-D');
  const away = probabilities.get('1X2-A');
  const over = probabilities.get('GOALS-O2.5');
  const under = probabilities.get('GOALS-U2.5');

  if (
    home === undefined ||
    draw === undefined ||
    away === undefined ||
    over === undefined
  ) {
    return null;
  }

  const resultSum = home + draw + away;
  if (resultSum <= 0) return null;

  const pOver =
    under !== undefined && over + under > 0 ? over / (over + under) : over;
  if (pOver <= 0 || pOver >= 1) return null;

  const total = Math.min(MAX_LAMBDA * 2, totalLambdaForOver25(pOver));
  const targetDiff = (home - away) / resultSum;
  const share = homeShareForWinSplit(total, targetDiff);
  const lambdaHome = Math.min(
    MAX_LAMBDA,
    Math.max(MIN_LAMBDA, total * share)
  );
  const lambdaAway = Math.min(
    MAX_LAMBDA,
    Math.max(MIN_LAMBDA, total * (1 - share))
  );

  if (
    !Number.isFinite(lambdaHome) ||
    !Number.isFinite(lambdaAway)
  ) {
    return null;
  }
  return { home: lambdaHome, away: lambdaAway };
}
