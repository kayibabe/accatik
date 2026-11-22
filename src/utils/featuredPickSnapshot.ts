import type {
  AccaStrategy,
  FeaturedPickRef,
  FeaturedPickSnapshot,
  Fixture,
  MarketOption,
} from '../types/fixtures.ts';
import { resolveAnalystNoteMarket } from './analystNote.ts';
import { resolveMarketSelection } from './marketSelection.ts';
import { isPriced } from './pickResolver.ts';
import { buildRecommendedAngle } from './recommendedAngle.ts';

/**
 * Durable record of the three featured cards.
 *
 * Angles and covers used to be recomputed from whatever price block happened
 * to be archived, so a refresh or recapture silently rewrote history. Snapshots
 * are appended when the slate is persisted and are never replaced: analytics
 * can always fall back to the pick as it was captured.
 */

export const CAPTURED_STRATEGIES: readonly AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

export type FeaturedPickSource = 'angle' | 'cover' | 'note';

function toRef(fixture: Fixture, market: MarketOption | null): FeaturedPickRef | null {
  if (!market || !isPriced(market)) return null;
  const selection = resolveMarketSelection(market, fixture);
  return {
    marketId: market.id,
    selectionKey: selection.key,
    label: selection.label,
    marketType: selection.marketType,
    odds: market.odds,
    fairProbability: market.fairProbability,
    bookmaker: market.bookmaker,
  };
}

/** Builds one snapshot from the same resolver the board renders. */
export function buildFeaturedPickSnapshot(
  fixture: Fixture,
  strategy: AccaStrategy,
  capturedAt: string
): FeaturedPickSnapshot {
  const angle = buildRecommendedAngle(fixture, strategy);
  return {
    capturedAt,
    strategy,
    angle: toRef(fixture, angle?.market ?? null),
    cover: toRef(fixture, angle?.cover ?? null),
    note: toRef(fixture, resolveAnalystNoteMarket(fixture, fixture.modelAdvice)),
  };
}

function snapshotKey(snapshot: FeaturedPickSnapshot): string {
  return `${snapshot.capturedAt}:${snapshot.strategy}`;
}

/**
 * Appends one snapshot per strategy using a shared capture timestamp. Repeating
 * the same timestamp is a no-op, so retrying a persist cannot duplicate history.
 */
export function appendFeaturedPickSnapshots(
  fixtures: Fixture[],
  nowMs: number = Date.now()
): Fixture[] {
  const capturedAt = new Date(nowMs).toISOString();
  return fixtures.map((fixture) => {
    const previous = fixture.featuredPickSnapshots ?? [];
    const seen = new Set(previous.map(snapshotKey));
    const additions = CAPTURED_STRATEGIES.map((strategy) =>
      buildFeaturedPickSnapshot(fixture, strategy, capturedAt)
    ).filter((snapshot) => !seen.has(snapshotKey(snapshot)));

    if (additions.length === 0 && previous.length > 0) return fixture;
    return { ...fixture, featuredPickSnapshots: [...previous, ...additions] };
  });
}

/** Most recent snapshot for a strategy, or null for older archives. */
export function latestFeaturedPickSnapshot(
  fixture: Fixture,
  strategy: AccaStrategy
): FeaturedPickSnapshot | null {
  const snapshots = fixture.featuredPickSnapshots ?? [];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    if (snapshots[index].strategy === strategy) return snapshots[index];
  }
  return null;
}

/**
 * Rebuilds a settleable market from the captured ref itself. A recapture can
 * reprice or relist the same market id, so even a still-present live object is
 * not trusted: the archived odds and label are what the pick actually referred
 * to and are what settlement and ROI must keep using.
 */
export function marketFromRef(_fixture: Fixture, ref: FeaturedPickRef): MarketOption {
  return {
    id: ref.marketId,
    marketType: ref.marketType,
    label: ref.label,
    odds: ref.odds,
    impliedProbability: Math.round((100 / ref.odds) * 10) / 10,
    fairProbability: ref.fairProbability,
    rationale: 'Captured featured pick.',
    bookmaker: ref.bookmaker,
  };
}

/**
 * The pick a featured card referred to at capture time. A later snapshot that
 * drops a cover must not erase the earlier settleable pick, so the newest
 * non-null ref wins. Fixtures archived before snapshots existed still fall
 * back to a live recompute.
 */
export function resolveFeaturedPick(
  fixture: Fixture,
  strategy: AccaStrategy,
  source: FeaturedPickSource
): MarketOption | null {
  const snapshots = fixture.featuredPickSnapshots ?? [];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot.strategy !== strategy) continue;
    const ref = snapshot[source];
    if (ref) return marketFromRef(fixture, ref);
  }

  const angle = buildRecommendedAngle(fixture, strategy);
  if (source === 'angle') return angle?.market ?? null;
  if (source === 'cover') return angle?.cover ?? null;
  return resolveAnalystNoteMarket(fixture, fixture.modelAdvice);
}
