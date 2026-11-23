import type {
  AccaStrategy,
  Fixture,
  MarketOption,
  SettlementStatus,
} from '../../src/types/fixtures.ts';
import type {
  CombinationRoiBand,
  CombinationRoiResponse,
  CombinationRoiRow,
  FeaturedPickSource,
  RoiBand,
} from '../../src/types/analytics.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import {
  getAnalystNote,
  resolveAnalystNoteMarket,
} from '../../src/utils/analystNote.ts';
import { resolveFeaturedPick } from '../../src/utils/featuredPickSnapshot.ts';
import {
  combinationRoiMarkets,
  resolveMarketSelection,
} from '../../src/utils/marketSelection.ts';
import { isPriced } from '../../src/utils/pickResolver.ts';
import { marketProbability } from '../../src/utils/probability.ts';
import { angleConfidence } from '../../src/utils/recommendedAngle.ts';
import { mapWithConcurrency } from './appwriteData.ts';
import { createTtlCache, registerAnalyticsCache } from './cache.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';
import { clusterRoiCi } from './roiPromotion.ts';

/**
 * Inception-to-date ROI study for the three featured cards.
 *
 * Every featured pick is rebuilt with the same resolvers the board and the
 * existing featured-picks table use, then bucketed by its fair-probability
 * confidence band and the canonical market it backed. A second pass stakes
 * every requested market directly from the full price ladder so a section's
 * performance can be compared with "just bet the market".
 *
 * The unit of analysis is a flat one-unit pick. Voids return the stake and are
 * excluded from the ROI denominator, exactly as in `pickAnalytics`. Intervals
 * resample whole matchdays: picks on one slate share a book and a set of
 * margins, so treating them as independent would understate the uncertainty.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const ARCHIVE_READ_CONCURRENCY = 4;
const STAKE_PER_PICK = 1;
/** Staked picks a cell needs before it stops being flagged as a small sample. */
export const MIN_SAMPLE = 20;
const BOOTSTRAP_ITERATIONS = 2000;

const SECTIONS: readonly FeaturedPickSource[] = ['angle', 'cover', 'note'];
const BANDS: readonly RoiBand[] = ['High', 'Solid', 'Moderate', 'Speculative'];
const MARKETS = combinationRoiMarkets();
const MARKET_KEYS = new Set(MARKETS.map((market) => market.key));
const MARKET_LABELS = new Map(MARKETS.map((market) => [market.key, market.label]));

interface Sample {
  dateIso: string;
  odds: number;
  won: boolean;
}

interface DayTally {
  stake: number;
  netPnl: number;
}

interface Tally {
  key: string;
  scope: CombinationRoiRow['scope'];
  section: FeaturedPickSource | null;
  band: CombinationRoiBand;
  marketKey: string;
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  stake: number;
  returns: number;
  oddsSum: number;
  firstDateIso: string | null;
  lastDateIso: string | null;
  days: Map<string, DayTally>;
  samples: Sample[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;

function isDecided(status: SettlementStatus): boolean {
  return status === 'Win' || status === 'Lost' || status === 'Void';
}

function newTally(
  key: string,
  scope: CombinationRoiRow['scope'],
  section: FeaturedPickSource | null,
  band: CombinationRoiBand,
  marketKey: string
): Tally {
  return {
    key,
    scope,
    section,
    band,
    marketKey,
    settled: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    stake: 0,
    returns: 0,
    oddsSum: 0,
    firstDateIso: null,
    lastDateIso: null,
    days: new Map(),
    samples: [],
  };
}

function getTally(
  map: Map<string, Tally>,
  key: string,
  scope: CombinationRoiRow['scope'],
  section: FeaturedPickSource | null,
  band: CombinationRoiBand,
  marketKey: string
): Tally {
  let tally = map.get(key);
  if (!tally) {
    tally = newTally(key, scope, section, band, marketKey);
    map.set(key, tally);
  }
  return tally;
}

function record(
  tally: Tally,
  market: MarketOption,
  status: SettlementStatus,
  dateIso: string
): void {
  if (!isDecided(status)) return;
  tally.settled += 1;
  if (!tally.firstDateIso || dateIso < tally.firstDateIso) tally.firstDateIso = dateIso;
  if (!tally.lastDateIso || dateIso > tally.lastDateIso) tally.lastDateIso = dateIso;

  if (status === 'Void') {
    tally.voids += 1;
    return;
  }

  const day = tally.days.get(dateIso) ?? { stake: 0, netPnl: 0 };
  tally.stake += STAKE_PER_PICK;
  tally.oddsSum += market.odds;
  day.stake += STAKE_PER_PICK;
  tally.samples.push({ dateIso, odds: market.odds, won: status === 'Win' });

  if (status === 'Win') {
    tally.wins += 1;
    tally.returns += STAKE_PER_PICK * market.odds;
    day.netPnl += STAKE_PER_PICK * market.odds - STAKE_PER_PICK;
  } else {
    tally.losses += 1;
    day.netPnl -= STAKE_PER_PICK;
  }
  tally.days.set(dateIso, day);
}

/** Stable per-row seed so a bootstrap figure does not jitter between reloads. */
function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function toRow(tally: Tally): CombinationRoiRow {
  const staked = tally.wins + tally.losses;
  const netPnl = round2(tally.returns - tally.stake);
  const stakedDays = [...tally.days.values()].filter((day) => day.stake > 0);
  const hasCi = staked > 0 && stakedDays.length >= 2;
  const ci = hasCi
    ? clusterRoiCi(tally.samples, BOOTSTRAP_ITERATIONS, seededRandom(`${tally.key}|${tally.samples.length}`))
    : null;

  return {
    key: tally.key,
    scope: tally.scope,
    section: tally.section,
    band: tally.band,
    marketKey: tally.marketKey,
    marketLabel: MARKET_LABELS.get(tally.marketKey) ?? tally.marketKey,
    settled: tally.settled,
    staked,
    wins: tally.wins,
    losses: tally.losses,
    voids: tally.voids,
    winRate: staked > 0 ? round1((tally.wins / staked) * 100) : null,
    avgOdds: staked > 0 ? round2(tally.oddsSum / staked) : null,
    netPnl,
    roi: tally.stake > 0 ? round1((netPnl / tally.stake) * 100) : null,
    positiveDates: stakedDays.filter((day) => day.netPnl > 0).length,
    totalDates: stakedDays.length,
    roiCiLow: ci ? ci[0] : null,
    roiCiHigh: ci ? ci[1] : null,
    firstDateIso: tally.firstDateIso,
    lastDateIso: tally.lastDateIso,
    smallSample: staked < MIN_SAMPLE,
  };
}

/**
 * The card as it was seen, not just as it was snapshotted.
 *
 * Angle and cover use the durable pick reference. The analyst note on the board
 * falls back to a board-derived line on most fixtures, while the snapshot only
 * carries provider advice; the study measures the note users actually read, so
 * derived text is resolved first and the captured reference is the fallback.
 */
function resolveStudyPick(
  fixture: Fixture,
  strategy: AccaStrategy,
  source: FeaturedPickSource
): MarketOption | null {
  if (source === 'note') {
    const visibleNote = resolveAnalystNoteMarket(fixture, getAnalystNote(fixture));
    if (visibleNote) return visibleNote;
  }
  return resolveFeaturedPick(fixture, strategy, source);
}

/** The canonical `(section, band, market)` triple for one fixture card. */
export interface StudyPick {
  market: MarketOption;
  selectionKey: string;
  marketLabel: string;
  band: RoiBand;
  status: SettlementStatus;
}

/**
 * Resolve one fixture card exactly as the ROI study does. The daily
 * positive-read feed reuses this so its labels can never drift from the cells
 * the study measured. Returns null when the card has no supported pick.
 */
export function studyPickForFixture(
  fixture: Fixture,
  strategy: AccaStrategy,
  source: FeaturedPickSource
): StudyPick | null {
  const market = resolveStudyPick(fixture, strategy, source);
  if (!market || !isPriced(market)) return null;
  const selection = resolveMarketSelection(market, fixture);
  if (!MARKET_KEYS.has(selection.key)) return null;
  return {
    market,
    selectionKey: selection.key,
    marketLabel: MARKET_LABELS.get(selection.key) ?? selection.key,
    band: angleConfidence(marketProbability(market)),
    status: evaluateMarketSettlement(fixture, market),
  };
}

function sampleFixture(fixture: Fixture): boolean {
  const home = fixture.score?.home;
  const away = fixture.score?.away;
  return (
    fixture.status === 'Finished' &&
    home !== null && home !== undefined &&
    away !== null && away !== undefined &&
    (fixture.allMarkets ?? fixture.markets).some(isPriced)
  );
}

function qualityKey(fixture: Fixture): 'prematch' | 'live' | 'unknown' {
  return fixture.priceQuality === 'prematch' || fixture.priceQuality === 'live'
    ? fixture.priceQuality
    : 'unknown';
}

const cache = createTtlCache<CombinationRoiResponse>(CACHE_TTL_MS, 8);
registerAnalyticsCache(() => cache.clear());

export interface CombinationRoiOptions {
  /**
   * Matchdays left out of the study. The daily positive-read feed uses this to
   * review an archived day without letting that day's results into the ROI that
   * labelled it, and again to build a prior-cutoff study for confirmation.
   */
  excludeDates?: readonly string[];
}

export async function computeCombinationRoi(
  strategy: AccaStrategy,
  force = false,
  options: CombinationRoiOptions = {}
): Promise<CombinationRoiResponse> {
  const excluded = new Set(
    (options.excludeDates ?? []).filter((dateIso) =>
      /^\d{4}-\d{2}-\d{2}$/.test(dateIso)
    )
  );
  // Different exclusions are different studies, so they cannot share a cache
  // entry. Sorting keeps two equivalent request orders on the same entry.
  const cacheKey = excluded.size
    ? `${strategy}|exclude=${[...excluded].sort().join(',')}`
    : strategy;
  const cached = cache.get(cacheKey);
  if (cached && !force) return cached;

  const dates = (await listArchivedSlateDates()).filter(
    (dateIso) => !excluded.has(dateIso)
  );
  const slates: (Awaited<ReturnType<typeof readArchivedSlate>> | undefined)[] =
    new Array(dates.length);
  await mapWithConcurrency(dates, ARCHIVE_READ_CONCURRENCY, async (dateIso, i) => {
    slates[i] = await readArchivedSlate(dateIso);
  });

  const tallies = new Map<string, Tally>();
  const priceQuality = { prematch: 0, live: 0, unknown: 0 };
  const usedDates = new Set<string>();
  let sampleFixtures = 0;
  let snapshotFixtures = 0;

  for (let i = 0; i < dates.length; i += 1) {
    const dateIso = dates[i];
    const slate = slates[i];
    if (!slate) continue;

    for (const fixture of slate.fixtures) {
      if (!sampleFixture(fixture)) continue;
      sampleFixtures += 1;
      usedDates.add(dateIso);
      if ((fixture.featuredPickSnapshots ?? []).length > 0) snapshotFixtures += 1;

      // The three featured cards, rebuilt with the app's own resolvers. Band is
      // the engine's own angleConfidence applied to the fair probability of the
      // exact price the card referred to.
      for (const source of SECTIONS) {
        const studyPick = studyPickForFixture(fixture, strategy, source);
        if (!studyPick || !isDecided(studyPick.status)) continue;

        const { band, selectionKey, market } = studyPick;
        record(
          getTally(tallies, `${source}:${band}:${selectionKey}`, 'section-band', source, band, selectionKey),
          market,
          studyPick.status,
          dateIso
        );
        record(
          getTally(tallies, `${source}:All:${selectionKey}`, 'section', source, 'All', selectionKey),
          market,
          studyPick.status,
          dateIso
        );
      }

      // Direct-stake control: every requested selection in the full price
      // ladder, not just the board's five headline markets.
      for (const market of fixture.allMarkets ?? fixture.markets) {
        if (!isPriced(market)) continue;
        const selection = resolveMarketSelection(market, fixture);
        if (!MARKET_KEYS.has(selection.key)) continue;
        const status = evaluateMarketSettlement(fixture, market);
        if (!isDecided(status)) continue;

        record(
          getTally(tallies, `market:${selection.key}`, 'market', null, 'All', selection.key),
          market,
          status,
          dateIso
        );
        priceQuality[qualityKey(fixture)] += 1;
      }
    }
  }

  // Emit every cell, including empty ones. The view hides empty rows by default
  // but can reveal them to show which markets the resolvers never select.
  const rows: CombinationRoiRow[] = [];
  for (const source of SECTIONS) {
    for (const band of BANDS) {
      for (const market of MARKETS) {
        rows.push(
          toRow(
            tallies.get(`${source}:${band}:${market.key}`) ??
              newTally(`${source}:${band}:${market.key}`, 'section-band', source, band, market.key)
          )
        );
      }
    }
    for (const market of MARKETS) {
      rows.push(
        toRow(
          tallies.get(`${source}:All:${market.key}`) ??
            newTally(`${source}:All:${market.key}`, 'section', source, 'All', market.key)
        )
      );
    }
  }
  for (const market of MARKETS) {
    rows.push(
      toRow(
        tallies.get(`market:${market.key}`) ??
          newTally(`market:${market.key}`, 'market', null, 'All', market.key)
      )
    );
  }

  const sortedDates = [...usedDates].sort();
  const result: CombinationRoiResponse = {
    strategy,
    generatedAt: new Date().toISOString(),
    firstDateIso: sortedDates[0] ?? null,
    lastDateIso: sortedDates[sortedDates.length - 1] ?? null,
    sampleDates: sortedDates.length,
    sampleFixtures,
    stakePerPick: STAKE_PER_PICK,
    minSample: MIN_SAMPLE,
    bands: [...BANDS],
    markets: MARKETS.map((market) => ({ key: market.key, label: market.label })),
    rows,
    priceQuality,
    snapshotFixtures,
    caveats: [
      'Observed ROI is not proven edge: a combination is only suggestive when its matchday-clustered 95% interval clears zero.',
      `Rows with fewer than ${MIN_SAMPLE} staked picks are flagged as small samples and should be treated as noise.`,
      'Featured picks before frozen snapshots existed are rebuilt from archived markets, so pick identity and price are best-effort on older dates.',
      'Research note rows settle the note shown on the board, which is often a board-derived line (usually the shortest price) rather than independent advice.',
      'Draw No Bet prices in the full ladder are miscalibrated in the feed; direct DNB ROI is a price artifact, not an exploitable result.',
      'Voids return the stake and are excluded from stake, win rate and ROI. Flat one-unit staking throughout.',
    ],
  };
  cache.set(cacheKey, result);
  return result;
}
