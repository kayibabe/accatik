import type { AccaStrategy, Fixture } from '../../src/types/fixtures.ts';
import type {
  CombinationRoiResponse,
  FeaturedPickSource,
  PositiveReadCombo,
  PositiveReadMatch,
  PositiveReadMatchesResponse,
  PositiveReadPick,
  PositiveReadUniverse,
  RoiBand,
} from '../../src/types/analytics.ts';
import { FEATURED_SOURCE_LABELS } from '../../src/utils/featuredPickLabels.ts';
import { combinationRoiMarkets } from '../../src/utils/marketSelection.ts';
import { MIN_SAMPLE, studyPickForFixture } from './combinationRoi.ts';

/**
 * Daily matches behind the positive cells of the section x band x market study.
 *
 * The positive set is taken from the same study the analytics table renders,
 * and each fixture's labels are rebuilt with the study's own pick resolvers.
 * That keeps a label such as "Analyst Note · High · Over 2.5 Goals" identical to
 * the row that earned the positive read; no second confidence calculation.
 */

const SECTION_SOURCES = Object.keys(FEATURED_SOURCE_LABELS) as FeaturedPickSource[];
const BAND_ORDER: Record<RoiBand, number> = {
  High: 0,
  Solid: 1,
  Moderate: 2,
  Speculative: 3,
};

export const POSITIVE_READ_CAVEATS: readonly string[] = [
  'A positive read is descriptive, not proven edge: Qualified needs the matchday-clustered 95% interval to clear zero, and Confirmed means it stayed positive in a study that stops before this one’s latest matchday.',
  'Stable means a qualified cell was also positive on at least half the matchdays it appeared on, with a minimum of two, so one large win cannot carry the read.',
  'Rows below the study’s minimum sample are still included, matching the table’s Positive toggle, and are badged as small samples; they can never be Qualified or Confirmed.',
  'Archive reviews leave the reviewed matchday out of the study, so the labels are out-of-sample for that day. The study is the fixed 3-section × 4-band × 18-market universe, not a per-market promotion.',
  'Bands are the engine’s confidence label for the fair probability of the frozen pre-match price, not a guarantee of the outcome.',
  'Live mode prices a card from the current book, so its band can differ from the archived price that produced the study. A Band drift badge marks a match made by section and market instead of the exact band.',
  'Adding a pick copies the price shown here into your slip. Archive uses the frozen pre-match price; switch to Live for the current book.',
];

function compareCombos(a: PositiveReadCombo, b: PositiveReadCombo): number {
  return (
    BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
    a.sectionLabel.localeCompare(b.sectionLabel) ||
    a.marketLabel.localeCompare(b.marketLabel)
  );
}

function bandDistance(a: RoiBand, b: RoiBand): number {
  return Math.abs(BAND_ORDER[a] - BAND_ORDER[b]);
}

const POSITIVE_READ_UNIVERSE: PositiveReadUniverse = (() => {
  const markets = combinationRoiMarkets().map((market) => ({
    key: market.key,
    label: market.label,
  }));
  return {
    sections: SECTION_SOURCES,
    bands: Object.keys(BAND_ORDER) as RoiBand[],
    markets,
    marketLabels: Object.fromEntries(markets.map((market) => [market.key, market.label])),
  };
})();

/**
 * The study rows that the table's Positive toggle would show.
 *
 * `priorStudy` is the same study cut one matchday earlier. A cell is confirmed
 * only when it is Qualified here and still positive there, so a single lucky
 * matchday cannot earn the strongest badge.
 */
export function positiveCombosFromStudy(
  study: CombinationRoiResponse,
  priorStudy?: CombinationRoiResponse
): PositiveReadCombo[] {
  const priorPositive = new Set<string>();
  if (priorStudy) {
    for (const row of priorStudy.rows) {
      if (row.scope !== 'section-band' || !row.section || row.band === 'All') continue;
      if (row.roi === null || row.roi <= 0) continue;
      priorPositive.add(row.key);
    }
  }

  const combos: PositiveReadCombo[] = [];
  for (const row of study.rows) {
    if (row.scope !== 'section-band' || !row.section || row.band === 'All') continue;
    if (row.roi === null || row.roi <= 0) continue;
    const sectionLabel = FEATURED_SOURCE_LABELS[row.section];
    const qualified = !row.smallSample && row.roiCiLow !== null && row.roiCiLow > 0;
    combos.push({
      key: row.key,
      section: row.section,
      sectionLabel,
      band: row.band,
      marketKey: row.marketKey,
      marketLabel: row.marketLabel,
      label: `${sectionLabel} · ${row.band} · ${row.marketLabel}`,
      roi: row.roi,
      staked: row.staked,
      smallSample: row.smallSample,
      roiCiLow: row.roiCiLow,
      roiCiHigh: row.roiCiHigh,
      positiveDates: row.positiveDates,
      totalDates: row.totalDates,
      qualified,
      confirmed: qualified && priorPositive.has(row.key),
      stable:
        qualified &&
        row.positiveDates >= 2 &&
        row.positiveDates * 2 >= row.totalDates,
    });
  }
  return combos.sort(compareCombos);
}

export interface BuildPositiveReadMatchesArgs {
  strategy: AccaStrategy;
  dateIso: string;
  source: 'archive' | 'live';
  fixtures: Fixture[];
  combos: PositiveReadCombo[];
  availableDates: string[];
  generatedAt?: string;
  /** When the display study was computed; defaults to `generatedAt`. */
  studyGeneratedAt?: string;
  /** Archived matchday left out of the display study, if any. */
  studyExcludedDateIso?: string | null;
  minSample?: number;
  universe?: PositiveReadUniverse;
}

export function buildPositiveReadMatchesResponse({
  strategy,
  dateIso,
  source,
  fixtures,
  combos,
  availableDates,
  generatedAt = new Date().toISOString(),
  studyGeneratedAt = generatedAt,
  studyExcludedDateIso = null,
  minSample = MIN_SAMPLE,
  universe = POSITIVE_READ_UNIVERSE,
}: BuildPositiveReadMatchesArgs): PositiveReadMatchesResponse {
  const byKey = new Map(combos.map((combo) => [combo.key, combo]));
  const bySectionMarket = new Map<string, PositiveReadCombo[]>();
  for (const combo of combos) {
    const key = `${combo.section}:${combo.marketKey}`;
    const list = bySectionMarket.get(key);
    if (list) list.push(combo);
    else bySectionMarket.set(key, [combo]);
  }

  const grouped = new Map<string, PositiveReadMatch>();

  for (const fixture of fixtures) {
    const matched: PositiveReadCombo[] = [];
    const picks: PositiveReadPick[] = [];
    for (const section of SECTION_SOURCES) {
      const pick = studyPickForFixture(fixture, strategy, section);
      if (!pick) continue;

      let combo = byKey.get(`${section}:${pick.band}:${pick.selectionKey}`);
      // A live price can drift a band away from the cell the study measured.
      // Fall back to the nearest positive band for the same section and market,
      // and flag the drift so the label stays honest about its provenance.
      if (!combo && source === 'live') {
        const candidates = bySectionMarket.get(`${section}:${pick.selectionKey}`);
        if (candidates && candidates.length > 0) {
          combo = candidates.reduce((best, candidate) =>
            bandDistance(candidate.band, pick.band) <
            bandDistance(best.band, pick.band)
              ? candidate
              : best
          );
        }
      }
      if (!combo || matched.some((item) => item.key === combo.key)) continue;

      matched.push(combo);
      picks.push({
        comboKey: combo.key,
        label: combo.label,
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
        matchDate: fixture.matchDate,
        kickoffTime: fixture.kickoffTime,
        marketId: pick.market.id,
        marketLabel: pick.marketLabel,
        marketType: pick.market.marketType,
        odds: pick.market.odds,
        impliedProbability: pick.market.impliedProbability,
        fairProbability: pick.market.fairProbability ?? null,
        rationale: pick.market.rationale,
        bookmaker: pick.market.bookmaker,
        band: pick.band,
        studyBand: combo.band,
        bandDrift: combo.band !== pick.band,
        status: pick.status,
      });
    }
    if (matched.length === 0) continue;

    const combosForMatch = matched.sort(compareCombos);
    const pickByCombo = new Map(picks.map((pick) => [pick.comboKey, pick]));
    const home = fixture.score?.home;
    const away = fixture.score?.away;
    grouped.set(fixture.id, {
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: fixture.competition,
      country: fixture.country,
      kickoffTime: fixture.kickoffTime,
      kickoffTimestamp: fixture.kickoffTimestamp ?? null,
      status: fixture.status,
      score:
        home !== null && home !== undefined && away !== null && away !== undefined
          ? `${home}–${away}`
          : null,
      combos: combosForMatch,
      picks: combosForMatch
        .map((combo) => pickByCombo.get(combo.key))
        .filter((pick): pick is PositiveReadPick => pick !== undefined),
    });
  }

  const matches = [...grouped.values()].sort(
    (a, b) =>
      (a.kickoffTimestamp ?? 0) - (b.kickoffTimestamp ?? 0) ||
      a.homeTeam.localeCompare(b.homeTeam)
  );

  return {
    strategy,
    dateIso,
    source,
    generatedAt,
    studyGeneratedAt,
    studyExcludedDateIso,
    minSample,
    universe,
    qualifiedCount: combos.filter((combo) => combo.qualified).length,
    confirmedCount: combos.filter((combo) => combo.confirmed).length,
    availableDates,
    combos,
    matches,
    caveats: [...POSITIVE_READ_CAVEATS],
  };
}
