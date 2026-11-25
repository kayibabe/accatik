import type { Fixture } from '../types/fixtures.ts';
import { fmtFixed } from './format.ts';
import { getMarketXg } from './marketXg.ts';

/**
 * Expected goals produced by the framework's Poisson model. Live fixtures read
 * the current assessment; settled fixtures read the value captured before the
 * framework decision was stripped from the archive. This is a projection, not
 * observed xG from a stats feed: label it as such wherever it is shown.
 */
export interface ModelXg {
  home: number;
  away: number;
}

export const MODEL_XG_TITLE =
  'Expected goals from the framework model, not an observed xG feed.';
export const MARKET_XG_TITLE =
  'Expected goals estimated from the priced 1X2 and Over/Under 2.5 markets, not an observed xG feed.';

function isUsable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Returns the model xG pair, or null when the fixture was never assessed. */
export function getModelXg(fixture: Fixture): ModelXg | null {
  const lambdaHome = fixture.modelXgHome ?? fixture.framework?.model?.lambdaHome;
  const lambdaAway = fixture.modelXgAway ?? fixture.framework?.model?.lambdaAway;
  if (!isUsable(lambdaHome) || !isUsable(lambdaAway)) return null;
  return { home: lambdaHome, away: lambdaAway };
}

/** One consistent label for the model xG pair across match views. */
export function formatModelXg(xg: ModelXg): string {
  return `xG (model): Home ${fmtFixed(xg.home)} / Away ${fmtFixed(xg.away)}`;
}

export interface XgDisplay extends ModelXg {
  source: 'framework' | 'market';
}

/** Framework xG first; market-implied xG for fixtures the model could not price. */
export function getXgDisplay(fixture: Fixture): XgDisplay | null {
  const model = getModelXg(fixture);
  if (model) return { ...model, source: 'framework' };
  const market = getMarketXg(fixture);
  return market ? { ...market, source: 'market' } : null;
}

export function formatXg(xg: XgDisplay): string {
  const label = xg.source === 'market' ? 'xG (market estimate)' : 'xG (model)';
  return `${label}: Home ${fmtFixed(xg.home)} / Away ${fmtFixed(xg.away)}`;
}

export function xgTitle(xg: XgDisplay): string {
  return xg.source === 'market' ? MARKET_XG_TITLE : MODEL_XG_TITLE;
}
