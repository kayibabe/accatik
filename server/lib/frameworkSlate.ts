import type { Fixture } from '../../src/types/fixtures.ts';
import { applySlateCaps, type SlateCandidate, type SlateRunSummary } from '../../src/framework/slate.ts';
import {
  frameworkCompetitionKey,
  frameworkTeamKey,
} from './frameworkHistory.ts';
import {
  buildDecisionRecords,
  priorWeeklyStakeUnits,
  writeDecisionRecords,
} from './frameworkDecisionLog.ts';

/**
 * Slate controller wiring (§13.3, R-16).
 *
 * The pure controller ranks qualified markets, keeps one per fixture, applies
 * league/team/daily caps and the weekly exposure already used in the ISO week.
 * The result is copied back onto the per-market decisions so every downstream
 * pick builder sees the same verdict, and the decisions are written to the
 * durable log with their frozen odds snapshot.
 */

export interface FrameworkSlateControlResult {
  fixtures: Fixture[];
  caps: SlateRunSummary;
  weekKey: string;
}

function candidateKey(fixtureId: string, marketId: string): string {
  return `${fixtureId}:${marketId}`;
}

/** Matches the market id used in the decision log's `decisionId`. */
function candidateMarketId(decisionMarketId: string, fallback: string): string {
  return decisionMarketId || fallback;
}

export async function applyFrameworkSlateControls(
  fixtures: Fixture[],
  dateIso: string,
  nowMs: number = Date.now()
): Promise<FrameworkSlateControlResult> {
  const candidates: SlateCandidate[] = [];
  for (const fixture of fixtures) {
    for (const market of fixture.markets) {
      const decision = market.framework;
      if (!decision) continue;
      candidates.push({
        fixtureId: fixture.id,
        marketId: candidateMarketId(decision.marketId, market.id),
        leagueId: frameworkCompetitionKey(fixture.country, fixture.competition),
        homeTeamId: frameworkTeamKey(fixture.country, fixture.homeTeam),
        awayTeamId: frameworkTeamKey(fixture.country, fixture.awayTeam),
        market: decision.selectionKey,
        status: decision.status,
        reasonCodes: [...decision.reasonCodes],
        value: decision.value,
        confidence: decision.confidence,
        oddsAgeSeconds: decision.oddsAgeSeconds ?? 0,
      });
    }
  }

  const weekly = await priorWeeklyStakeUnits(dateIso, nowMs);
  const controlled = applySlateCaps(candidates, {
    priorWeeklyStakeUnits: weekly.units,
  });
  const byKey = new Map(
    controlled.candidates.map((candidate) => [
      candidateKey(
        candidate.fixtureId,
        candidateMarketId(candidate.marketId ?? '', candidate.market)
      ),
      candidate,
    ])
  );

  const controlledFixtures = fixtures.map((fixture) => ({
    ...fixture,
    markets: fixture.markets.map((market) => {
      const decision = market.framework;
      if (!decision) return market;
      const result = byKey.get(
        candidateKey(fixture.id, candidateMarketId(decision.marketId, market.id))
      );
      if (!result) return market;
      const capReasonCodes = result.reasonCodes.filter(
        (code) => !decision.reasonCodes.includes(code)
      );
      return {
        ...market,
        framework: {
          ...decision,
          status: result.status,
          reasonCodes: [...result.reasonCodes],
          staked: result.staked,
          capReasonCodes,
        },
      };
    }),
  }));

  // Bookkeeping is best-effort: a failed log write must never block a slate.
  try {
    await writeDecisionRecords(
      dateIso,
      buildDecisionRecords(controlledFixtures, nowMs),
      nowMs
    );
  } catch (error) {
    console.warn('Framework decision log unavailable:', error);
  }

  return { fixtures: controlledFixtures, caps: controlled.summary, weekKey: weekly.weekKey };
}
