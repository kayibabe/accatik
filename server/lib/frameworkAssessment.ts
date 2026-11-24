import type {
  Fixture,
  FixtureFrameworkSummary,
  FrameworkSlateSummary,
  MarketOption,
} from '../../src/types/fixtures.ts';
import type { MarketCalibrationRecord } from '../../src/framework/confidence.ts';
import type { TeamMatchResult } from '../../src/framework/model.ts';
import type {
  AssessmentFixtureInput,
  AssessmentMarketInput,
  FixtureFrameworkAssessment,
} from '../../src/framework/assessment.ts';
import { assessFixtureFramework } from '../../src/framework/assessment.ts';
import { FRAMEWORK_VERSION } from '../../src/framework/config.ts';
import { resolveMarketSelection } from '../../src/utils/marketSelection.ts';

/**
 * Server-side bridge between the app's `Fixture` shape and the pure framework.
 *
 * Only scheduled fixtures are assessed. A finished matchday keeps the old
 * archive behaviour: its prices are frozen history, not a live decision.
 */

function toMarketInput(
  fixture: Fixture,
  market: MarketOption
): AssessmentMarketInput {
  return {
    id: market.id,
    selectionKey: resolveMarketSelection(market, fixture).key,
    odds: market.odds,
    bookmaker: market.bookmaker,
  };
}

function toAssessmentInput(fixture: Fixture): AssessmentFixtureInput {
  const all = fixture.allMarkets ?? fixture.markets;
  return {
    id: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    country: fixture.country,
    matchDateIso: fixture.matchDateIso,
    kickoffTimestamp: fixture.kickoffTimestamp,
    status: fixture.status,
    pricedAt: fixture.pricedAt,
    markets: fixture.markets.map((market) => toMarketInput(fixture, market)),
    allMarkets: all.map((market) => toMarketInput(fixture, market)),
  };
}

export function summarizeFrameworkAssessment(
  assessment: FixtureFrameworkAssessment
): FixtureFrameworkSummary {
  const counts = {
    qualified: 0,
    review: 0,
    screenOnly: 0,
    rejected: 0,
    insufficient: 0,
  };
  for (const market of assessment.markets) {
    switch (market.status) {
      case 'QUALIFIED':
        counts.qualified += 1;
        break;
      case 'CONDITIONAL_REVIEW':
        counts.review += 1;
        break;
      case 'SCREEN_ONLY':
        counts.screenOnly += 1;
        break;
      case 'REJECTED':
        counts.rejected += 1;
        break;
      default:
        counts.insufficient += 1;
    }
  }

  return {
    version: assessment.version,
    modelVersion: assessment.modelVersion,
    status: assessment.status,
    confidence: assessment.confidence,
    dataOk: assessment.dataOk,
    flags: assessment.flags,
    reasonCodes: assessment.reasonCodes,
    model: assessment.model,
    summary: assessment.summary,
    counts,
  };
}

/** Attaches one assessment to a fixture and every market it priced. */
export function attachFrameworkAssessment(
  fixture: Fixture,
  history: TeamMatchResult[],
  nowMs: number,
  calibration?: Record<string, MarketCalibrationRecord> | null
): Fixture {
  if (fixture.status !== 'Scheduled' || fixture.markets.length === 0) {
    return fixture;
  }

  const assessment = assessFixtureFramework(toAssessmentInput(fixture), history, {
    nowMs,
    calibration,
  });
  const byMarketId = new Map(
    assessment.markets.map((market) => [market.marketId, market])
  );
  const attach = (market: MarketOption): MarketOption => {
    const marketAssessment = byMarketId.get(market.id);
    return marketAssessment
      ? { ...market, framework: marketAssessment }
      : market;
  };

  return {
    ...fixture,
    markets: fixture.markets.map(attach),
    allMarkets: fixture.allMarkets?.map(attach),
    framework: summarizeFrameworkAssessment(assessment),
  };
}

export function attachFrameworkAssessments(
  fixtures: Fixture[],
  history: TeamMatchResult[],
  nowMs: number = Date.now(),
  calibration?: Record<string, MarketCalibrationRecord> | null
): Fixture[] {
  return fixtures.map((fixture) =>
    attachFrameworkAssessment(fixture, history, nowMs, calibration)
  );
}

/** Removes framework output before a slate is written to the permanent archive. */
export function stripFrameworkFromFixture(fixture: Fixture): Fixture {
  const stripMarket = (market: MarketOption): MarketOption => {
    if (!market.framework) return market;
    const copy = { ...market };
    delete copy.framework;
    return copy;
  };

  if (
    !fixture.framework &&
    !fixture.markets.some((market) => market.framework) &&
    !fixture.allMarkets?.some((market) => market.framework)
  ) {
    return fixture;
  }

  const copy = { ...fixture };
  delete copy.framework;
  copy.markets = fixture.markets.map(stripMarket);
  copy.allMarkets = fixture.allMarkets?.map(stripMarket);
  return copy;
}

export function stripFrameworkFromFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.map(stripFrameworkFromFixture);
}

/** Matchday-level counts shown beside the slate. */
export function summarizeFrameworkSlate(
  fixtures: Fixture[],
  caps?: FrameworkSlateSummary['caps']
): FrameworkSlateSummary {
  const assessed = fixtures.filter((fixture) => fixture.framework);
  const totals = {
    qualifiedMarkets: 0,
    reviewMarkets: 0,
    screenOnlyMarkets: 0,
    rejectedMarkets: 0,
    insufficientMarkets: 0,
  };

  for (const fixture of assessed) {
    const counts = fixture.framework?.counts;
    if (!counts) continue;
    totals.qualifiedMarkets += counts.qualified;
    totals.reviewMarkets += counts.review;
    totals.screenOnlyMarkets += counts.screenOnly;
    totals.rejectedMarkets += counts.rejected;
    totals.insufficientMarkets += counts.insufficient;
  }

  const note =
    assessed.length === 0
      ? 'No scheduled fixtures were assessed on this matchday.'
      : totals.qualifiedMarkets === 0
        ? 'No market cleared every framework gate; the board is screening only.'
        : 'Only framework-qualified markets are eligible for the recommended accumulator.';

  return {
    version: FRAMEWORK_VERSION,
    modelVersion: assessed[0]?.framework?.modelVersion ?? 'unavailable',
    fixturesAssessed: assessed.length,
    fixturesWithModel: assessed.filter((fixture) => fixture.framework?.model)
      .length,
    ...totals,
    note,
    caps,
  };
}
