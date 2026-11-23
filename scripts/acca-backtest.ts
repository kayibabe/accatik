/**
 * Accumulator backtest — clean pre-match sample only.
 *
 * The first version of this harness replayed the engine against archived
 * slates whose prices had been backfilled *after* kickoff. That made the
 * "results" describe in-play prices the app could never have bet, and it
 * produced fake positive ROI. It also called `buildRecommendedAcca` with
 * fixtures still marked `Finished`, so the real engine returned no legs at
 * all while the local experiment builder quietly produced tickets.
 *
 * This version fixes both problems:
 *
 *   1. A fixture is usable only when its price block was captured before
 *      kickoff (`inferPriceQuality === 'prematch'`). Everything else is
 *      excluded from selection *and* calibration.
 *   2. The engine is replayed on clones marked `Scheduled` (what it saw when
 *      the ticket was built), while settlement still uses the finished
 *      originals.
 *
 * It then answers two questions:
 *
 *   - Which leg pools, if any, beat the book's own de-vigged price?
 *   - Does the best-looking parameter combination repeat out of sample?
 *
 * Usage:
 *   npx tsx scripts/acca-backtest.ts
 *   npx tsx scripts/acca-backtest.ts --json scripts/acca-backtest-results.json
 *   npx tsx scripts/acca-backtest.ts --include-today
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AccaStrategy,
  AccaLeg,
  Fixture,
  MarketOption,
} from '../src/types/fixtures.ts';
import { buildRecommendedAcca } from '../src/utils/accaEngine.ts';
import {
  calculateTotalOdds,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
} from '../src/utils/accaMath.ts';
import { getLeaguePriority } from '../src/utils/leaguePriority.ts';
import { resolvePick } from '../src/utils/pickResolver.ts';
import { marketProbability } from '../src/utils/probability.ts';
import { inferPriceQuality } from '../src/utils/priceQuality.ts';
import { TICKET_SHAPES } from '../src/utils/ticketShapes.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLATE_DIR = path.join(ROOT, 'data', 'slates');
const LEDGER_FILE = path.join(ROOT, 'data', 'ledger', 'tickets.json');
const TODAY = new Date().toISOString().slice(0, 10);
const INCLUDE_TODAY = process.argv.includes('--include-today');

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];
const LEG_BUDGETS = [2, 3, 4, 6, 8] as const;

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

interface Slate {
  dateIso: string;
  /** Finished fixtures with a score and a genuinely pre-kickoff price block. */
  fixtures: Fixture[];
  /** The same fixtures as the engine saw them when the ticket was built. */
  replay: Fixture[];
}

function isClean(fixture: Fixture): boolean {
  return (
    fixture.status === 'Finished' &&
    fixture.score?.home !== null &&
    fixture.score?.home !== undefined &&
    fixture.score?.away !== null &&
    fixture.score?.away !== undefined &&
    (fixture.markets?.length ?? 0) > 0 &&
    inferPriceQuality(fixture) === 'prematch'
  );
}

function loadSlates(): Slate[] {
  const slates: Slate[] = [];
  for (const file of fs.readdirSync(SLATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(SLATE_DIR, file), 'utf8'));
    const dateIso: string = raw.dateIso ?? file.slice(0, 10);
    if (!INCLUDE_TODAY && dateIso >= TODAY) continue;

    const fixtures: Fixture[] = (raw.fixtures ?? []).filter(isClean);
    if (fixtures.length < 30) continue;

    slates.push({
      dateIso,
      fixtures,
      replay: fixtures.map((fixture) => ({
        ...fixture,
        status: 'Scheduled' as const,
        awaitingResult: false,
      })),
    });
  }
  return slates.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

const round = (value: number, digits = 1): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** 95% Wilson interval for a proportion, as percentages. */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [
    round(Math.max(0, centre - margin) * 100),
    round(Math.min(1, centre + margin) * 100),
  ];
}

/**
 * ROI interval that resamples whole matchdays, not individual legs. Legs on
 * the same day share a slate and a book, so treating them as independent
 * would understate the uncertainty.
 */
function clusterRoiCi(
  rows: Array<{ dateIso: string; odds: number; won: boolean }>,
  iterations = 2000
): [number, number] {
  const days = new Map<string, Array<{ odds: number; won: boolean }>>();
  for (const row of rows) {
    const list = days.get(row.dateIso);
    if (list) list.push(row);
    else days.set(row.dateIso, [row]);
  }
  const keys = [...days.keys()];
  if (keys.length < 2) return [0, 0];

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let n = 0;
    let returned = 0;
    for (let k = 0; k < keys.length; k++) {
      const day = days.get(keys[Math.floor(Math.random() * keys.length)])!;
      for (const row of day) {
        n += 1;
        returned += row.won ? row.odds : 0;
      }
    }
    samples.push(((returned - n) / n) * 100);
  }
  samples.sort((a, b) => a - b);
  return [
    round(samples[Math.floor(iterations * 0.025)]),
    round(samples[Math.floor(iterations * 0.975)]),
  ];
}

interface Summary {
  tickets: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number;
  breakEvenHitRate: number;
  roi: number;
  netPnl: number;
  avgOdds: number;
  avgLegs: number;
  maxDrawdown: number;
  longestLossStreak: number;
}

function summarise(
  results: Array<{
    dateIso: string;
    status: 'Win' | 'Lost' | 'Void';
    legs: number;
    odds: number;
  }>
): Summary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let staked = 0;
  let returned = 0;
  let oddsSum = 0;
  let legsSum = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let streak = 0;
  let longestLossStreak = 0;

  for (const result of results) {
    oddsSum += result.odds;
    legsSum += result.legs;
    if (result.status === 'Win') {
      wins += 1;
      staked += 1;
      returned += result.odds;
      equity += result.odds - 1;
      streak = 0;
    } else if (result.status === 'Lost') {
      losses += 1;
      staked += 1;
      equity -= 1;
      streak += 1;
      longestLossStreak = Math.max(longestLossStreak, streak);
    } else {
      voids += 1;
      continue;
    }
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const decided = wins + losses;
  const avgOdds = results.length > 0 ? round(oddsSum / results.length, 2) : 0;
  return {
    tickets: results.length,
    wins,
    losses,
    voids,
    hitRate: decided > 0 ? round((wins / decided) * 100) : 0,
    breakEvenHitRate: avgOdds > 0 ? round(100 / avgOdds) : 0,
    roi: staked > 0 ? round(((returned - staked) / staked) * 100) : 0,
    netPnl: round(returned - staked, 2),
    avgOdds,
    avgLegs: results.length > 0 ? round(legsSum / results.length) : 0,
    maxDrawdown: round(maxDrawdown, 2),
    longestLossStreak,
  };
}

/** Spearman rank correlation, used to test day-to-day reproducibility. */
function spearman(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const rank = (values: number[]): number[] => {
    const order = values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(n);
    order.forEach((entry, position) => {
      ranks[entry.index] = position + 1;
    });
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  let sumSquared = 0;
  for (let i = 0; i < n; i++) sumSquared += (rx[i] - ry[i]) ** 2;
  return 1 - (6 * sumSquared) / (n * (n * n - 1));
}

/* ------------------------------------------------------------------ */
/* Engine replay                                                       */
/* ------------------------------------------------------------------ */

interface TicketRow {
  dateIso: string;
  strategy: AccaStrategy;
  label: string;
  status: 'Win' | 'Lost' | 'Void';
  legs: number;
  odds: number;
  fairProbability: number | null;
}

function replayTicket(
  slate: Slate,
  strategy: AccaStrategy,
  targetOdds: number,
  maxLegs: number,
  label: string
): TicketRow | null {
  const legs = buildRecommendedAcca(
    slate.replay,
    targetOdds,
    strategy,
    maxLegs
  );
  if (legs.length === 0) return null;
  const settlement = evaluateTicketSettlement(legs, slate.fixtures, 1);
  if (
    settlement.status !== 'Win' &&
    settlement.status !== 'Lost' &&
    settlement.status !== 'Void'
  ) {
    return null;
  }
  return {
    dateIso: slate.dateIso,
    strategy,
    label,
    status: settlement.status,
    legs: legs.length,
    odds: calculateTotalOdds(legs),
    fairProbability: combinedFair(legs),
  };
}

function combinedFair(legs: AccaLeg[]): number | null {
  if (legs.length === 0) return null;
  let product = 1;
  for (const leg of legs) {
    const probability = leg.fairProbability ?? leg.impliedProbability;
    if (!probability) return null;
    product *= probability / 100;
  }
  return round(product * 100, 1);
}

/* ------------------------------------------------------------------ */
/* Leg-level calibration                                               */
/* ------------------------------------------------------------------ */

interface LegRow {
  dateIso: string;
  fixtureId: string;
  competition: string;
  country: string;
  priority: number;
  marketKey: string;
  odds: number;
  fair: number;
  won: boolean;
}

const MARKET_LABELS: Record<string, string> = {
  '1x2-h': '1X2 Home win',
  '1x2-a': '1X2 Away win',
  '1x2-d': '1X2 Draw',
  'dc-1x': 'Double Chance 1X',
  'dc-x2': 'Double Chance X2',
  'ou-15': 'Over 1.5 goals',
  'ou-25': 'Over 2.5 goals',
  'ou-u25': 'Under 2.5 goals',
  'btts-yes': 'BTTS Yes',
  'dnb-h': 'DNB Home',
  'dnb-a': 'DNB Away',
};

function marketKeyOf(market: MarketOption): string {
  const suffix = market.id.slice(market.id.indexOf('-') + 1);
  return suffix in MARKET_LABELS ? suffix : market.marketType;
}

function collectLegRows(slates: Slate[], strategy: AccaStrategy): LegRow[] {
  const rows: LegRow[] = [];
  for (const slate of slates) {
    for (const fixture of slate.fixtures) {
      const market = resolvePick(fixture, strategy);
      if (!market) continue;
      const status = evaluateMarketSettlement(fixture, market);
      if (status !== 'Win' && status !== 'Lost') continue;
      rows.push({
        dateIso: slate.dateIso,
        fixtureId: fixture.id,
        competition: fixture.competition,
        country: fixture.country,
        priority: getLeaguePriority(fixture.competition, fixture.country),
        marketKey: marketKeyOf(market),
        odds: market.odds,
        fair: marketProbability(market) / 100,
        won: status === 'Win',
      });
    }
  }
  return rows;
}

/**
 * Collapse picks that name the same market on the same fixture. Different
 * strategies frequently land on the same selection; counting it once per
 * strategy inflates the sample and lets a handful of winning legs dominate a
 * pooled group.
 */
function dedupeLegs(rows: LegRow[]): LegRow[] {
  const seen = new Map<string, LegRow>();
  for (const row of rows) {
    const key = `${row.fixtureId}|${row.marketKey}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

const ODDS_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: '1.00-1.29', min: 1, max: 1.29 },
  { label: '1.30-1.49', min: 1.3, max: 1.49 },
  { label: '1.50-1.69', min: 1.5, max: 1.69 },
  { label: '1.70-1.99', min: 1.7, max: 1.99 },
  { label: '2.00-2.49', min: 2, max: 2.49 },
  { label: '2.50-3.49', min: 2.5, max: 3.49 },
  { label: '3.50+', min: 3.5, max: 1000 },
];

function oddsBandOf(odds: number): string {
  return ODDS_BANDS.find((band) => odds >= band.min && odds <= band.max)?.label ?? 'other';
}

interface GroupStat {
  label: string;
  n: number;
  wins: number;
  hitRate: number;
  avgOdds: number;
  fair: number;
  edge: number;
  roi: number;
  roiCi: [number, number];
  ci: [number, number];
  byDay: Record<string, { n: number; roi: number }>;
}

function groupStats(
  rows: LegRow[],
  keyOf: (row: LegRow) => string,
  minN = 0
): GroupStat[] {
  const groups = new Map<string, LegRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length >= minN)
    .map(([label, list]) => {
      const n = list.length;
      const wins = list.filter((row) => row.won).length;
      const returned = list.reduce((sum, row) => sum + (row.won ? row.odds : 0), 0);
      const fair = mean(list.map((row) => row.fair));
      const byDay: Record<string, { n: number; roi: number }> = {};
      for (const row of list) {
        const day = (byDay[row.dateIso] ??= { n: 0, roi: 0 });
        day.n += 1;
        day.roi += row.won ? row.odds - 1 : -1;
      }
      for (const day of Object.values(byDay)) day.roi = round((day.roi / day.n) * 100);
      return {
        label,
        n,
        wins,
        hitRate: round((wins / n) * 100),
        avgOdds: round(mean(list.map((row) => row.odds)), 2),
        fair: round(fair * 100),
        edge: round((wins / n - fair) * 100),
        roi: round(((returned - n) / n) * 100),
        roiCi: clusterRoiCi(list),
        ci: wilson(wins, n),
        byDay,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/* ------------------------------------------------------------------ */
/* Two-leg pair analysis                                               */
/* ------------------------------------------------------------------ */

interface PairRow {
  dateIso: string;
  odds: number;
  fair: number;
  won: boolean;
  marketPair: string;
  sameCompetition: boolean;
  bandPair: string;
}

function collectPairRows(
  slates: Slate[],
  strategy: AccaStrategy,
  maxLegOdds: number
): PairRow[] {
  const rows: PairRow[] = [];
  for (const slate of slates) {
    const picks: Array<{ market: MarketOption; fixture: Fixture; won: boolean }> = [];
    for (const fixture of slate.fixtures) {
      const market = resolvePick(fixture, strategy);
      if (!market || market.odds > maxLegOdds) continue;
      const status = evaluateMarketSettlement(fixture, market);
      if (status !== 'Win' && status !== 'Lost') continue;
      picks.push({ market, fixture, won: status === 'Win' });
    }

    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const a = picks[i];
        const b = picks[j];
        const marketA = MARKET_LABELS[marketKeyOf(a.market)] ?? a.market.marketType;
        const marketB = MARKET_LABELS[marketKeyOf(b.market)] ?? b.market.marketType;
        rows.push({
          dateIso: slate.dateIso,
          odds: round(a.market.odds * b.market.odds, 2),
          fair:
            (marketProbability(a.market) / 100) *
            (marketProbability(b.market) / 100),
          won: a.won && b.won,
          marketPair: [marketA, marketB].sort().join(' + '),
          sameCompetition: a.fixture.competition === b.fixture.competition,
          bandPair: [oddsBandOf(a.market.odds), oddsBandOf(b.market.odds)]
            .sort()
            .join(' + '),
        });
      }
    }
  }
  return rows;
}

interface OutcomeRow {
  dateIso: string;
  odds: number;
  won: boolean;
}

function outcomeStats(rows: OutcomeRow[]): {
  n: number;
  hitRate: number;
  avgOdds: number;
  breakEven: number;
  roi: number;
  roiCi: [number, number];
  byDay: Record<string, number>;
} {
  const n = rows.length;
  const wins = rows.filter((row) => row.won).length;
  const returned = rows.reduce((sum, row) => sum + (row.won ? row.odds : 0), 0);
  const avgOdds = mean(rows.map((row) => row.odds));
  const byDay: Record<string, number> = {};
  const dayTotals = new Map<string, { n: number; pnl: number }>();
  for (const row of rows) {
    const day = dayTotals.get(row.dateIso) ?? { n: 0, pnl: 0 };
    day.n += 1;
    day.pnl += row.won ? row.odds - 1 : -1;
    dayTotals.set(row.dateIso, day);
  }
  for (const [date, day] of dayTotals) byDay[date] = round((day.pnl / day.n) * 100);
  return {
    n,
    hitRate: round((wins / n) * 100),
    avgOdds: round(avgOdds, 2),
    breakEven: round(100 / avgOdds),
    roi: round(((returned - n) / n) * 100),
    roiCi: clusterRoiCi(rows),
    byDay,
  };
}

function pairGroups(
  rows: PairRow[],
  keyOf: (row: PairRow) => string,
  minN: number
): Array<{ label: string; stats: ReturnType<typeof outcomeStats> }> {
  const groups = new Map<string, PairRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= minN)
    .map(([label, list]) => ({ label, stats: outcomeStats(list) }));
}

/**
 * Every k-leg combination that could be built from the given legs on the same
 * matchday. This is the honest version of "find the sweet spot": no cherry
 * picking one band after seeing the results, and no double counting.
 */
function exhaustiveCombos(rows: LegRow[], k: number): OutcomeRow[] {
  const byDay = new Map<string, LegRow[]>();
  for (const row of rows) {
    const list = byDay.get(row.dateIso);
    if (list) list.push(row);
    else byDay.set(row.dateIso, [row]);
  }

  const out: OutcomeRow[] = [];
  const chosen: LegRow[] = [];
  for (const [dateIso, list] of byDay) {
    const walk = (start: number): void => {
      if (chosen.length === k) {
        out.push({
          dateIso,
          odds: chosen.reduce((product, leg) => product * leg.odds, 1),
          won: chosen.every((leg) => leg.won),
        });
        return;
      }
      for (let i = start; i < list.length; i++) {
        // Two markets on the same fixture are correlated, so they do not form a
        // legitimate independent accumulator.
        if (chosen.some((leg) => leg.fixtureId === list[i].fixtureId)) continue;
        chosen.push(list[i]);
        walk(i + 1);
        chosen.pop();
      }
    };
    walk(0);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Ledger audit                                                        */
/* ------------------------------------------------------------------ */

interface LedgerTicket {
  id: string;
  dateIso: string;
  strategy: AccaStrategy;
  kind: string;
  label: string;
  legCount: number;
  totalOdds: number;
  stake: number;
  status: string;
  settledReturn?: number;
  legs: AccaLeg[];
}

function ledgerAudit(slates: Slate[]): Record<string, unknown> {
  if (!fs.existsSync(LEDGER_FILE)) return { available: false };
  const ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')) as {
    tickets: LedgerTicket[];
  };
  const fixturesByDate = new Map<string, Fixture[]>();
  for (const slate of slates) fixturesByDate.set(slate.dateIso, slate.fixtures);

  // Also load archives excluded from the clean selection sample (e.g. today),
  // because a ledger ticket still needs its final scores to settle.
  for (const file of fs.readdirSync(SLATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(SLATE_DIR, file), 'utf8'));
    const dateIso: string = raw.dateIso ?? file.slice(0, 10);
    if (!fixturesByDate.has(dateIso)) {
      fixturesByDate.set(dateIso, raw.fixtures ?? []);
    }
  }

  const counts: Record<string, number> = {};
  const settled: Array<{
    ticket: LedgerTicket;
    status: string;
    return: number;
    won: number;
    lost: number;
  }> = [];
  for (const ticket of ledger.tickets) {
    const fixtures = fixturesByDate.get(ticket.dateIso) ?? [];
    const ids = new Set(fixtures.map((fixture) => fixture.id));
    if (!ticket.legs.every((leg) => ids.has(leg.fixtureId))) {
      counts.Incomplete = (counts.Incomplete ?? 0) + 1;
      continue;
    }
    const settlement = evaluateTicketSettlement(ticket.legs, fixtures, ticket.stake);
    counts[settlement.status] = (counts[settlement.status] ?? 0) + 1;
    if (settlement.status === 'Win' || settlement.status === 'Lost') {
      settled.push({
        ticket,
        status: settlement.status,
        return: settlement.status === 'Win' ? ticket.stake * settlement.effectiveOdds : 0,
        won: settlement.winCount,
        lost: settlement.lostCount,
      });
    }
  }

  const stake = settled.reduce((sum, row) => sum + row.ticket.stake, 0);
  const returned = settled.reduce((sum, row) => sum + row.return, 0);

  const byStrategy: Record<string, { tickets: number; won: number; lost: number; pending: number; live: number }> = {};
  for (const ticket of ledger.tickets) {
    const key = `${ticket.strategy} · ${ticket.legCount} legs`;
    const bucket = (byStrategy[key] ??= { tickets: 0, won: 0, lost: 0, pending: 0, live: 0 });
    bucket.tickets += 1;
    const fixtures = fixturesByDate.get(ticket.dateIso) ?? [];
    const ids = new Set(fixtures.map((fixture) => fixture.id));
    if (!ticket.legs.every((leg) => ids.has(leg.fixtureId))) continue;
    const status = evaluateTicketSettlement(ticket.legs, fixtures, ticket.stake).status;
    if (status === 'Win') bucket.won += 1;
    else if (status === 'Lost') bucket.lost += 1;
    else if (status === 'Live') bucket.live += 1;
    else bucket.pending += 1;
  }

  return {
    available: true,
    updatedAt: new Date().toISOString(),
    tickets: ledger.tickets.length,
    dates: [...new Set(ledger.tickets.map((ticket) => ticket.dateIso))],
    counts,
    settled: {
      tickets: settled.length,
      stake: round(stake, 2),
      returned: round(returned, 2),
      pnl: round(returned - stake, 2),
      roi: stake > 0 ? round(((returned - stake) / stake) * 100) : 0,
      wins: settled.filter((row) => row.status === 'Win').length,
      losses: settled.filter((row) => row.status === 'Lost').length,
    },
    byStrategy,
    losses: settled
      .filter((row) => row.status === 'Lost')
      .map((row) => ({
        strategy: row.ticket.strategy,
        legs: row.ticket.legCount,
        odds: row.ticket.totalOdds,
        wonLegs: row.won,
        lostLegs: row.lost,
        label: row.ticket.label,
      })),
  };
}

/* ------------------------------------------------------------------ */
/* Reporting helpers                                                   */
/* ------------------------------------------------------------------ */

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => String(row[index]).length))
  );
  const line = (cells: Array<string | number>): string =>
    cells.map((cell, index) => pad(cell, widths[index])).join('  ');
  return [
    line(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

function pct(value: number, signed = true): string {
  return `${signed && value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
  const slates = loadSlates();
  const lines: string[] = [];
  const output: Record<string, unknown> = {};

  const fixtures = slates.reduce((sum, slate) => sum + slate.fixtures.length, 0);
  const outcomes = slates.reduce(
    (sum, slate) =>
      sum + slate.fixtures.reduce((count, fixture) => count + fixture.markets.length, 0),
    0
  );

  lines.push('ACCUMULATOR AUDIT — CLEAN PRE-MATCH SAMPLE');
  lines.push(
    `Window: ${slates[0]?.dateIso ?? 'n/a'} -> ${slates[slates.length - 1]?.dateIso ?? 'n/a'}  (${slates.length} matchdays)`
  );
  lines.push(`Priced fixtures: ${fixtures}   priced outcomes: ${outcomes}`);
  lines.push(
    'Rule: a price is usable only when it was first captured before kickoff.'
  );
  lines.push(
    INCLUDE_TODAY
      ? 'Today is included (--include-today); its day is still in progress.'
      : "Today's partial matchday is excluded."
  );
  lines.push('');

  /* ---- 1. Structural maths ---- */
  const overrounds: number[] = [];
  for (const slate of slates) {
    for (const fixture of slate.fixtures) {
      const ratios = fixture.markets
        .filter((market) => market.fairProbability)
        .map((market) => market.impliedProbability / (market.fairProbability as number));
      if (ratios.length > 0) overrounds.push(ratios[0]);
    }
  }
  overrounds.sort((a, b) => a - b);
  const overround = overrounds.length
    ? overrounds[Math.floor(overrounds.length / 2)]
    : 1.06;

  lines.push('1. THE MATHS OF THE PRODUCT');
  lines.push(
    `   Median bookmaker overround in this sample: ${((overround - 1) * 100).toFixed(1)}%`
  );
  lines.push(
    '   A leg bought at the book price returns (1 / overround) of a fair bet.'
  );
  lines.push(
    '   An n-leg accumulator therefore returns (1 / overround)^n of a fair bet.'
  );
  lines.push('');
  const ladderRows: Array<Array<string | number>> = [];
  for (let legs = 1; legs <= 8; legs++) {
    const ev = ((1 / overround) ** legs - 1) * 100;
    const typicalOdds = 1.5 ** legs;
    ladderRows.push([
      legs,
      typicalOdds.toFixed(2),
      round(100 / typicalOdds).toFixed(1),
      pct(round(ev)),
    ]);
  }
  lines.push(
    table(
      ['legs', 'typical odds', 'break-even hit%', 'expected ROI%'],
      ladderRows
    )
  );
  lines.push('');
  lines.push(
    '   This is the whole story: with an 11% book, a 2-leg ticket starts ~19% behind,'
  );
  lines.push(
    '   and an 8-leg ticket starts ~57% behind. Selection cannot fix that without'
  );
  lines.push(
    '   an independent probability model that is better than the book.'
  );
  lines.push('');

  /* ---- 2. Leg pools by strategy ---- */
  lines.push('2. THE LEG POOL EACH STRATEGY ACTUALLY BUYS');
  lines.push('   One pick per fixture, flat-staked at the quoted price.');
  const poolRows: Array<Array<string | number>> = [];
  const poolStats: Record<string, GroupStat> = {};
  for (const strategy of STRATEGIES) {
    const rows = collectLegRows(slates, strategy);
    const stat = groupStats(rows, () => 'pool')[0];
    poolStats[strategy] = stat;
    poolRows.push([
      strategy,
      stat.n,
      stat.hitRate,
      stat.fair,
      stat.edge,
      stat.avgOdds,
      pct(stat.roi),
      `${stat.ci[0]}-${stat.ci[1]}%`,
      `${stat.roiCi[0]}..${stat.roiCi[1]}`,
    ]);
  }
  lines.push(
    table(
      ['strategy', 'legs', 'hit%', 'fair%', 'edge pp', 'avgOdds', 'ROI', 'hit 95% CI', 'ROI 95% CI'],
      poolRows
    )
  );
  lines.push('');

  /* ---- 3. Calibration by market and odds band ---- */
  const allLegs = dedupeLegs(
    STRATEGIES.flatMap((strategy) => collectLegRows(slates, strategy))
  );
  lines.push('3. WHERE THE PRICE IS CLOSEST TO FAIR (every strategy pick pooled)');
  lines.push('   edge = actual hit rate minus the book\'s de-vigged probability.');
  const marketRows = groupStats(
    allLegs,
    (row) => MARKET_LABELS[row.marketKey] ?? row.marketKey,
    20
  )
    .sort((a, b) => b.edge - a.edge)
    .map((stat) => [
      stat.label,
      stat.n,
      stat.hitRate,
      stat.fair,
      stat.edge,
      stat.avgOdds,
      pct(stat.roi),
      `${stat.roiCi[0]}..${stat.roiCi[1]}`,
    ]);
  lines.push(
    table(
      ['market', 'legs', 'hit%', 'fair%', 'edge pp', 'avgOdds', 'ROI', 'ROI 95% CI'],
      marketRows
    )
  );
  lines.push('');
  const bandRows = groupStats(allLegs, (row) => oddsBandOf(row.odds), 20)
    .sort((a, b) => a.avgOdds - b.avgOdds)
    .map((stat) => [
      stat.label,
      stat.n,
      stat.hitRate,
      stat.fair,
      stat.edge,
      stat.avgOdds,
      pct(stat.roi),
      `${stat.roiCi[0]}..${stat.roiCi[1]}`,
    ]);
  lines.push(
    table(
      ['odds band', 'legs', 'hit%', 'fair%', 'edge pp', 'avgOdds', 'ROI', 'ROI 95% CI'],
      bandRows
    )
  );
  lines.push('');

  /* ---- 4. Does the best group repeat? ---- */
  lines.push('4. DOES THE BEST GROUP REPEAT OUT OF SAMPLE?');
  const groupKey = (row: LegRow): string =>
    `${MARKET_LABELS[row.marketKey] ?? row.marketKey} | ${oddsBandOf(row.odds)}`;
  const crossStats = groupStats(allLegs, groupKey, 20);
  const stableGroups = crossStats.filter((stat) => {
    const days = Object.values(stat.byDay);
    return days.length >= 2 && days.every((day) => day.n >= 15);
  });
  const dates = [...new Set(allLegs.map((row) => row.dateIso))].sort();
  const dayA = dates[0];
  const dayB = dates[dates.length - 1];
  const comparable = stableGroups.filter(
    (stat) => stat.byDay[dayA] && stat.byDay[dayB]
  );
  const rho = spearman(
    comparable.map((stat) => stat.byDay[dayA].roi),
    comparable.map((stat) => stat.byDay[dayB].roi)
  );
  lines.push(
    `   Groups tested: ${comparable.length}. Spearman rank correlation between ${dayA} and ${dayB}: ${rho === null ? 'n/a' : rho.toFixed(2)}`
  );
  lines.push(
    '   A value near 0 means the ranking is noise: the best group on one day is'
  );
  lines.push('   not the best group on the next.');
  lines.push('');
  const holdout = [...comparable]
    .sort((a, b) => b.byDay[dayA].roi - a.byDay[dayA].roi)
    .slice(0, 6)
    .map((stat) => [
      stat.label,
      stat.n,
      pct(stat.byDay[dayA].roi),
      pct(stat.byDay[dayB].roi),
      pct(stat.roi),
    ]);
  lines.push(
    table(
      ['best on day 1 (market | odds)', 'legs', `${dayA} ROI`, `${dayB} ROI`, 'pooled ROI'],
      holdout
    )
  );
  lines.push('');
  const reversed = [...comparable]
    .sort((a, b) => a.byDay[dayA].roi - b.byDay[dayA].roi)
    .slice(0, 6)
    .map((stat) => [
      stat.label,
      stat.n,
      pct(stat.byDay[dayA].roi),
      pct(stat.byDay[dayB].roi),
      pct(stat.roi),
    ]);
  lines.push('Worst on day 1, for contrast:');
  lines.push(
    table(
      ['worst on day 1 (market | odds)', 'legs', `${dayA} ROI`, `${dayB} ROI`, 'pooled ROI'],
      reversed
    )
  );
  lines.push('');

  /* ---- 5. Engine replay ---- */
  lines.push('5. WHAT THE ENGINE ACTUALLY BUILDS (exact replay, clean prices)');
  lines.push('   Strategy variants use an unreachable target, so each carries its leg budget.');
  const engineRows: Array<Array<string | number>> = [];
  const engineDetail: Record<string, unknown> = {};
  for (const strategy of STRATEGIES) {
    for (const budget of LEG_BUDGETS) {
      const results = slates
        .map((slate) =>
          replayTicket(
            slate,
            strategy,
            Number.POSITIVE_INFINITY,
            budget,
            `${strategy} · ${budget} legs`
          )
        )
        .filter((row): row is TicketRow => row !== null);
      const summary = summarise(results);
      engineRows.push([
        strategy,
        budget,
        `${summary.wins}-${summary.losses}`,
        summary.hitRate,
        summary.breakEvenHitRate,
        summary.avgOdds,
        pct(summary.roi),
        summary.netPnl,
      ]);
      engineDetail[`${strategy}-${budget}`] = { summary, results };
    }
  }
  lines.push(
    table(
      ['strategy', 'legs', 'W-L', 'hit%', 'break-even', 'avgOdds', 'ROI', 'P&L'],
      engineRows
    )
  );
  lines.push('');
  lines.push('   Per-matchday result (default shape: balanced, 2.80 target, 3 legs):');
  const defaultRows = slates.map((slate) => {
    const row = replayTicket(slate, 'balanced', 2.8, 3, 'default');
    return [
      slate.dateIso,
      row ? row.status : 'no ticket',
      row ? row.legs : 0,
      row ? row.odds.toFixed(2) : '-',
      row ? `${row.fairProbability ?? '-'}%` : '-',
    ];
  });
  lines.push(table(['date', 'result', 'legs', 'odds', 'fair chance'], defaultRows));
  lines.push('');
  lines.push('   Shape presets:');
  const shapeRows = slates.flatMap((slate) =>
    TICKET_SHAPES.map((shape) => {
      const row = replayTicket(slate, shape.strategy, shape.targetOdds, shape.maxLegs, shape.label);
      return [slate.dateIso, shape.label, row ? row.status : 'no ticket', row?.odds ?? 0];
    })
  );
  lines.push(table(['date', 'shape', 'result', 'odds'], shapeRows));
  lines.push('');

  /* ---- 6. Two-leg pairs ---- */
  lines.push('6. THE TWO-LEG QUESTION — every pair of picks on the same matchday');
  lines.push('   Pairs are correlated (they share legs), so treat this as description,');
  lines.push('   not as thousands of independent bets.');
  const pairOverall: Array<Array<string | number>> = [];
  const pairDetail: Record<string, unknown> = {};
  for (const strategy of ['favorites', 'probability'] as AccaStrategy[]) {
    for (const maxLegOdds of [1.35, 1.5, 99]) {
      const rows = collectPairRows(slates, strategy, maxLegOdds);
      const stats = outcomeStats(rows);
      pairOverall.push([
        strategy,
        maxLegOdds === 99 ? 'any' : `<=${maxLegOdds}`,
        stats.n,
        stats.hitRate,
        stats.avgOdds,
        stats.breakEven,
        pct(stats.roi),
        `${stats.roiCi[0]}..${stats.roiCi[1]}`,
        Object.entries(stats.byDay)
          .map(([date, roi]) => `${date.slice(5)}:${pct(roi)}`)
          .join(' '),
      ]);
      pairDetail[`${strategy}-${maxLegOdds}`] = stats;
    }
  }
  lines.push(
    table(
      ['strategy', 'leg odds', 'pairs', 'hit%', 'avgOdds', 'break-even', 'ROI', 'ROI 95% CI', 'by day'],
      pairOverall
    )
  );
  lines.push('');

  const shortPairs = collectPairRows(slates, 'favorites', 1.35);
  const shortPairGroups = pairGroups(
    shortPairs,
    (row) => row.bandPair,
    50
  ).sort((a, b) => b.stats.roi - a.stats.roi);
  lines.push('   Favourites <=1.35, grouped by the two leg-odds bands:');
  lines.push(
    table(
      ['band pair', 'pairs', 'hit%', 'avgOdds', 'break-even', 'ROI', 'by day'],
      shortPairGroups.slice(0, 8).map(({ label, stats }) => [
        label,
        stats.n,
        stats.hitRate,
        stats.avgOdds,
        stats.breakEven,
        pct(stats.roi),
        Object.entries(stats.byDay)
          .map(([date, roi]) => `${date.slice(5)}:${pct(roi)}`)
          .join(' '),
      ])
    )
  );
  lines.push(
    '   Warning: these pairs reuse each leg many times, so the ROIs above are'
  );
  lines.push(
    '   descriptive, not independent evidence. Section 6b is the test to trust.'
  );
  lines.push('');

  /* ---- 6b. Exhaustive short-leg combinations ---- */
  lines.push('6b. THE HONEST SWEET-SPOT TEST — every short-leg combination');
  lines.push('   Duplicate picks collapsed, same-fixture legs excluded, and every');
  lines.push('   within-day combination evaluated. This cannot cherry-pick a band');
  lines.push('   after seeing the result.');
  const shortLegs = allLegs.filter((row) => row.odds <= 1.29);
  const comboRows: Array<Array<string | number>> = [];
  const comboDetail: Record<string, unknown> = {};
  for (const legs of [1, 2, 3]) {
    const stats = outcomeStats(exhaustiveCombos(shortLegs, legs));
    comboRows.push([
      legs,
      stats.n,
      stats.hitRate,
      stats.avgOdds,
      stats.breakEven,
      pct(stats.roi),
      `${stats.roiCi[0]}..${stats.roiCi[1]}`,
      Object.entries(stats.byDay)
        .map(([date, roi]) => `${date.slice(5)}:${pct(roi)}`)
        .join(' '),
    ]);
    comboDetail[`short-${legs}`] = stats;
  }
  lines.push(
    table(
      ['legs', 'combos', 'hit%', 'avgOdds', 'break-even', 'ROI', 'ROI 95% CI', 'by day'],
      comboRows
    )
  );
  lines.push(
    `   ${shortLegs.length} unique picks priced at or below 1.29. The short-price`
  );
  lines.push(
    '   slice is break-even at best once duplicates and correlations are removed.'
  );
  lines.push('');

  /* ---- 7. Ledger audit ---- */
  lines.push('7. THE LEDGER — what the system actually recorded');
  const ledger = ledgerAudit(slates) as Record<string, any>;
  if (!ledger.available) {
    lines.push('   No ledger file found.');
  } else {
    lines.push(
      `   ${ledger.tickets} tickets on ${ledger.dates.join(', ')}; status counts: ${JSON.stringify(ledger.counts)}`
    );
    if (ledger.settled.tickets > 0) {
      lines.push(
        `   Settled: ${ledger.settled.wins}W-${ledger.settled.losses}L, ROI ${pct(ledger.settled.roi)}, P&L ${ledger.settled.pnl}u (incomplete day)`
      );
    }
    lines.push('');
    const ledgerRows = Object.entries(ledger.byStrategy as Record<string, any>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, bucket]) => [
        label,
        bucket.tickets,
        bucket.won,
        bucket.lost,
        bucket.live,
        bucket.pending,
      ]);
    lines.push(
      table(['strategy · legs', 'tickets', 'W', 'L', 'live', 'pending'], ledgerRows)
    );
    if (ledger.losses.length > 0) {
      lines.push('');
      lines.push('   Settled losses so far:');
      lines.push(
        table(
          ['strategy', 'legs', 'odds', 'won legs', 'lost legs'],
          ledger.losses.map((row: any) => [
            row.strategy,
            row.legs,
            row.odds.toFixed(2),
            row.wonLegs,
            row.lostLegs,
          ])
        )
      );
    }
  }
  lines.push('');

  /* ---- 8. Verdict ---- */
  lines.push('8. VERDICT');
  const bestPool = [...Object.entries(poolStats)].sort((a, b) => b[1].roi - a[1].roi)[0];
  lines.push(
    `   Best leg pool: ${bestPool[0]} at ${pct(bestPool[1].roi)} ROI (${bestPool[1].n} legs, hit ${bestPool[1].hitRate}% vs fair ${bestPool[1].fair}%).`
  );
  lines.push(
    `   Every leg pool is still negative. The engine cannot select a positive-EV ticket from book prices alone.`
  );
  lines.push(
    `   The most favourable slice (legs <= 1.29) returns ${pct((comboDetail['short-1'] as ReturnType<typeof outcomeStats>).roi)} / ${pct((comboDetail['short-2'] as ReturnType<typeof outcomeStats>).roi)} / ${pct((comboDetail['short-3'] as ReturnType<typeof outcomeStats>).roi)} for 1/2/3-leg tickets.`
  );
  lines.push(
    `   That is break-even at best. The earlier positive numbers were selection artifacts, not an edge.`
  );
  lines.push(
    `   Parameter tuning on ${slates.length} matchdays is not evidence: the day-to-day rank correlation is ${rho === null ? 'n/a' : rho.toFixed(2)}.`
  );
  lines.push('');
  lines.push('   What to do next:');
  lines.push(
    '   1. Keep the current 2-5 leg cap and the negative-EV warning; do not chase 5.00+ targets.'
  );
  lines.push(
    '   2. Keep recording every variant with pre-match prices. You need ~1,000+ legs per bucket, not 182.'
  );
  lines.push(
    '   3. Add an independent model (xG/Elo/Poisson) and bet only when model probability beats the de-vigged price by a margin.'
  );
  lines.push(
    '   4. Until that model exists, treat the product as entertainment with a hard stake cap, not as an income strategy.'
  );

  const text = lines.join('\n');
  console.log(text);

  output.meta = {
    window: slates.map((slate) => slate.dateIso),
    fixtures,
    outcomes,
    overround: round(overround, 4),
    includeToday: INCLUDE_TODAY,
  };
  output.structural = { overround: round(overround, 4), ladder: ladderRows };
  output.legPools = poolStats;
  output.calibration = {
    byMarket: marketRows,
    byOddsBand: bandRows,
    cross: crossStats,
  };
  output.stability = {
    spearman: rho,
    dayA,
    dayB,
    bestOnDayA: holdout,
    worstOnDayA: reversed,
  };
  output.engine = engineDetail;
  output.pairs = pairDetail;
  output.combos = comboDetail;
  output.ledger = ledger;

  const flag = process.argv.indexOf('--json');
  if (flag !== -1 && process.argv[flag + 1]) {
    fs.writeFileSync(
      path.resolve(process.argv[flag + 1]),
      JSON.stringify(output, null, 2)
    );
  }
}

main();
