import type { AccaStrategy, Fixture } from '../../src/types/fixtures.ts';
import type {
  CombinationRoiResponse,
  FeaturedPickSource,
  PositiveReadCombo,
  PositiveReadMatch,
  PositiveReadMatchesResponse,
  PositiveReadPick,
  RoiBand,
} from '../../src/types/analytics.ts';
import { FEATURED_SOURCE_LABELS } from '../../src/utils/featuredPickLabels.ts';
import { studyPickForFixture } from './combinationRoi.ts';

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
  'A positive read is descriptive, not proven edge: consider the row’s matchday-clustered interval before treating it as a signal.',
  'Rows below the study’s minimum sample are still included, matching the table’s Positive toggle, and are badged as small samples.',
  'Bands are the engine’s confidence label for the fair probability of the frozen pre-match price, not a guarantee of the outcome.',
  'Live mode prices a card from the current book, so its band can differ from the archived price that produced the study.',
  'Adding a pick copies the price shown here into your slip. Archive uses the frozen pre-match price; switch to Live for the current book.',
];

function compareCombos(a: PositiveReadCombo, b: PositiveReadCombo): number {
  return (
    BAND_ORDER[a.band] - BAND_ORDER[b.band] ||
    a.sectionLabel.localeCompare(b.sectionLabel) ||
    a.marketLabel.localeCompare(b.marketLabel)
  );
}

/** The study rows that the table's Positive toggle would show. */
export function positiveCombosFromStudy(study: CombinationRoiResponse): PositiveReadCombo[] {
  const combos: PositiveReadCombo[] = [];
  for (const row of study.rows) {
    if (row.scope !== 'section-band' || !row.section || row.band === 'All') continue;
    if (row.roi === null || row.roi <= 0) continue;
    const sectionLabel = FEATURED_SOURCE_LABELS[row.section];
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
    });
  }
  return combos.sort(compareCombos);
}

export function buildPositiveReadMatchesResponse({
  strategy,
  dateIso,
  source,
  fixtures,
  combos,
  availableDates,
  generatedAt = new Date().toISOString(),
}: {
  strategy: AccaStrategy;
  dateIso: string;
  source: 'archive' | 'live';
  fixtures: Fixture[];
  combos: PositiveReadCombo[];
  availableDates: string[];
  generatedAt?: string;
}): PositiveReadMatchesResponse {
  const byKey = new Map(combos.map((combo) => [combo.key, combo]));
  const grouped = new Map<string, PositiveReadMatch>();

  for (const fixture of fixtures) {
    const matched: PositiveReadCombo[] = [];
    const picks: PositiveReadPick[] = [];
    for (const section of SECTION_SOURCES) {
      const pick = studyPickForFixture(fixture, strategy, section);
      if (!pick) continue;
      const combo = byKey.get(`${section}:${pick.band}:${pick.selectionKey}`);
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
    availableDates,
    combos,
    matches,
    caveats: [...POSITIVE_READ_CAVEATS],
  };
}
