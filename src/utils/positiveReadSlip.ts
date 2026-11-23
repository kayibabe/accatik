import type { PositiveReadPick } from '../types/analytics.ts';
import type { AccaLeg } from '../types/fixtures.ts';
import { mergeResearchLegs } from './researchSlip.ts';

/** A positive-read card is already a fully priced pick; no board lookup needed. */
export function legFromPositiveReadPick(pick: PositiveReadPick): AccaLeg {
  return {
    fixtureId: pick.fixtureId,
    homeTeam: pick.homeTeam,
    awayTeam: pick.awayTeam,
    competition: pick.competition,
    matchDate: pick.matchDate,
    kickoffTime: pick.kickoffTime,
    marketId: pick.marketId,
    marketLabel: pick.marketLabel,
    marketType: pick.marketType,
    odds: pick.odds,
    impliedProbability: pick.impliedProbability,
    fairProbability: pick.fairProbability ?? undefined,
    rationale: pick.rationale || pick.label,
    bookmaker: pick.bookmaker,
  };
}

/**
 * Pending picks with one entry per fixture. Later duplicate cards do not turn
 * into same-match legs, so the first labelled pick for a fixture wins.
 */
export function eligiblePositiveReadPicks(
  picks: PositiveReadPick[]
): PositiveReadPick[] {
  const byFixture = new Map<string, PositiveReadPick>();
  for (const pick of picks) {
    if (pick.status !== 'Pending') continue;
    if (!byFixture.has(pick.fixtureId)) byFixture.set(pick.fixtureId, pick);
  }
  return [...byFixture.values()];
}

/**
 * Positive Reads are research slips: every eligible pick is kept, with one leg
 * per fixture. A later pick for the same fixture replaces the leg already held.
 *
 * No recommendation cap is applied here. Ticket Review discloses wide slips
 * separately instead of silently cutting the user's selection to five legs.
 */
export function mergePositiveReadPicks(
  current: AccaLeg[],
  picks: PositiveReadPick[]
): AccaLeg[] {
  return mergeResearchLegs(
    current,
    eligiblePositiveReadPicks(picks).map(legFromPositiveReadPick)
  );
}
