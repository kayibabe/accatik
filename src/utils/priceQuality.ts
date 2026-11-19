import type { Fixture, PriceQuality } from '../types/fixtures.ts';

type PriceQualityInput = Pick<
  Fixture,
  'priceQuality' | 'status' | 'pricedAt' | 'kickoffTimestamp' | 'markets'
>;

/** A fixture whose prices can still be used to place a new bet. */
export function isPreMatchFixture(
  fixture: Pick<Fixture, 'status' | 'awaitingResult'>
): boolean {
  return fixture.status === 'Scheduled' && !fixture.awaitingResult;
}

/** Best-effort quality label for a price block.
 *
 * New captures carry `priceQuality` explicitly. Archived slates written before
 * that field existed fall back to comparing `pricedAt` with kickoff: a price
 * first captured after the match started is not a pre-match price and must be
 * excluded from ROI and closing-line analysis.
 */
export function inferPriceQuality(fixture: PriceQualityInput): PriceQuality {
  if (fixture.priceQuality) return fixture.priceQuality;
  if (fixture.status === 'Void' || fixture.markets.length === 0) {
    return 'unknown';
  }

  if (fixture.pricedAt && fixture.kickoffTimestamp) {
    const capturedMs = Date.parse(fixture.pricedAt);
    if (Number.isFinite(capturedMs)) {
      return capturedMs < fixture.kickoffTimestamp ? 'prematch' : 'live';
    }
  }

  // A scheduled fixture with no capture time cannot be verified as pre-match.
  if (fixture.status === 'Scheduled') return 'unknown';
  return fixture.status === 'Live' || fixture.status === 'Finished'
    ? 'live'
    : 'unknown';
}

/** Combines leg-level quality into the quality of the whole ticket. */
export function combinePriceQuality(
  qualities: PriceQuality[]
): PriceQuality {
  if (qualities.length === 0) return 'unknown';
  if (qualities.some((quality) => quality === 'live')) return 'live';
  if (qualities.some((quality) => quality === 'unknown')) return 'unknown';
  return 'prematch';
}
