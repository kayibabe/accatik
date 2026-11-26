import type {
  Fixture,
  FrameworkSlateSummary,
} from '../types/fixtures.ts';
import { fmtCount } from './format.ts';

export interface NoQualifiedPicksCopy {
  headline: string;
  detail: string;
}

/**
 * Explains why an auto-built accumulator is empty on a given matchday.
 *
 * The ticket builder deliberately uses only framework-qualified markets. When
 * the slate has none, the empty slip is correct behaviour rather than a failed
 * request, so the UI must say that and point to manual selection instead of
 * offering a button that cannot add a leg.
 */
export function noQualifiedPicksCopy(
  framework: FrameworkSlateSummary | undefined,
  fixtures: Fixture[] = []
): NoQualifiedPicksCopy | null {
  if (!framework) return null;

  if (framework.fixturesAssessed === 0) {
    return {
      headline: 'No fixtures could be assessed on this matchday',
      detail:
        'There is no priced slate with enough model history yet. Pick a pre-match odd on the fixture board manually, or choose another matchday.',
    };
  }

  if (framework.qualifiedMarkets > 0) return null;

  const pricedFixtures = fixtures.filter(
    (fixture) =>
      fixture.status === 'Scheduled' &&
      fixture.markets.some((market) => Number.isFinite(market.odds) && market.odds > 1)
  ).length;
  const boardText =
    pricedFixtures > 0
      ? `${fmtCount(pricedFixtures)} priced ${pricedFixtures === 1 ? 'match is' : 'matches are'} on the board`
      : 'The board has no priced upcoming matches';

  return {
    headline: 'No framework-qualified picks today',
    detail:
      `${boardText}, but none cleared the data, model and price gates. ` +
      `Auto-build has no eligible legs. Add picks manually from any pre-match odd on the fixture board, or choose another matchday.`,
  };
}
