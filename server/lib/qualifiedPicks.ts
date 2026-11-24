import type { AccaStrategy, Fixture, MarketOption } from '../../src/types/fixtures.ts';
import type {
  FeaturedPickSource,
  QualifiedPickRow,
  QualifiedPicksResponse,
  RoiRegistryEntry,
} from '../../src/types/analytics.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import { isPreMatchFixture, inferPriceQuality } from '../../src/utils/priceQuality.ts';
import { isPriced } from '../../src/utils/pickResolver.ts';
import { resolveMarketSelection } from '../../src/utils/marketSelection.ts';
import { resolveFeaturedPick } from '../../src/utils/featuredPickSnapshot.ts';
import { formatKickoffCat } from './time.ts';

/**
 * Join between the daily ROI whitelist and the three cards the board renders.
 *
 * Only stored `modelAdvice` is used for the analyst note: `getAnalystNote()`
 * falls back to a derived note the analytics never settled, so admitting that
 * fallback here would let an untracked bet into the qualified table.
 */

interface Card {
  source: FeaturedPickSource;
  market: MarketOption | null;
}

function cardsFor(fixture: Fixture, strategy: AccaStrategy): Card[] {
  return [
    { source: 'angle', market: resolveFeaturedPick(fixture, strategy, 'angle') },
    { source: 'cover', market: resolveFeaturedPick(fixture, strategy, 'cover') },
    { source: 'note', market: resolveFeaturedPick(fixture, strategy, 'note') },
  ];
}

function kickoffLabel(fixture: Fixture): string {
  if (fixture.kickoffTimestamp) {
    return formatKickoffCat(new Date(fixture.kickoffTimestamp).toISOString());
  }
  return fixture.kickoffTime || 'TBD';
}

export function buildQualifiedPickRows(
  fixtures: Fixture[],
  registry: RoiRegistryEntry[],
  strategy: AccaStrategy,
  nowMs: number = Date.now()
): QualifiedPickRow[] {
  const byPair = new Map(
    registry
      .filter((entry) => entry.strategy === strategy)
      .map((entry) => [`${entry.source}:${entry.selectionKey}`, entry])
  );

  const rows: QualifiedPickRow[] = [];
  for (const fixture of fixtures) {
    const upcoming = isPreMatchFixture(fixture);
    const notKickedOff =
      !fixture.kickoffTimestamp || fixture.kickoffTimestamp > nowMs;
    const quality = inferPriceQuality(fixture);

    for (const card of cardsFor(fixture, strategy)) {
      if (!card.market || !isPriced(card.market)) continue;
      const selection = resolveMarketSelection(card.market, fixture);
      const result = evaluateMarketSettlement(fixture, card.market);
      const entry = byPair.get(`${card.source}:${selection.key}`);
      const framework = card.market.framework ?? null;

      let reason: string;
      let eligibleForAcca = false;
      if (!upcoming || !notKickedOff) {
        reason = 'Fixture has already kicked off or is not scheduled.';
      } else if (quality !== 'prematch') {
        reason = `Price quality is ${quality}, not prematch-confirmed.`;
      } else if (!framework || framework.status !== 'QUALIFIED') {
        reason = framework
          ? `Framework ${framework.status}: ${
              framework.reasonCodes.join(', ') || 'not qualified'
            }.`
          : 'No framework assessment for this selection.';
      } else if (!entry) {
        reason = 'No registry row for this card and selection.';
      } else if (entry.status !== 'promoted') {
        reason = entry.reason || `Registry status is ${entry.status}.`;
      } else {
        eligibleForAcca = true;
        reason = entry.reason || 'Promoted selection.';
      }

      rows.push({
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
        kickoffTimestamp: fixture.kickoffTimestamp ?? null,
        kickoffCat: kickoffLabel(fixture),
        source: card.source,
        selectionKey: selection.key,
        selectionLabel: selection.label,
        marketType: selection.marketType,
        marketId: card.market.id,
        odds: card.market.odds,
        fairProbability: card.market.fairProbability ?? null,
        result,
        status: entry?.status ?? 'untracked',
        roi: entry?.roi ?? null,
        roiCiLow: entry?.roiCiLow ?? null,
        roiCiHigh: entry?.roiCiHigh ?? null,
        settled: entry?.settled ?? 0,
        eligibleForAcca,
        reason,
        frameworkStatus: framework?.status ?? null,
        frameworkReasonCodes: framework?.reasonCodes ?? [],
        frameworkConfidence: framework?.confidence ?? null,
        frameworkEdge: framework?.edge ?? null,
        frameworkEvStress: framework?.evStress ?? null,
      });
    }
  }

  return rows;
}

export function buildQualifiedPicksResponse(
  dateIso: string,
  fixtures: Fixture[],
  registry: RoiRegistryEntry[],
  strategy: AccaStrategy,
  nowMs: number = Date.now()
): QualifiedPicksResponse {
  const rows = buildQualifiedPickRows(fixtures, registry, strategy, nowMs);
  return {
    dateIso,
    strategy,
    generatedAt: new Date(nowMs).toISOString(),
    rows,
    eligibleCount: rows.filter((row) => row.eligibleForAcca).length,
  };
}
