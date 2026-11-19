/**
 * Offline accumulator backtest.
 *
 * Replays every completed, priced matchday in data/slates through the same
 * selection engine the app uses, settles each generated ticket against the
 * archived final scores, and runs a leg-level calibration pass over every
 * priced outcome so we can see which markets actually beat the book's own
 * de-vigged price.
 *
 * Usage:
 *   npx tsx scripts/acca-backtest.ts
 *   npx tsx scripts/acca-backtest.ts --json scripts/acca-backtest-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AccaStrategy,
  AccaLeg,
  Fixture,
  MarketOption,
  MarketType,
} from '../src/types/fixtures.ts';
import { buildRecommendedAcca } from '../src/utils/accaEngine.ts';
import {
  calculateTotalOdds,
  evaluateMarketSettlement,
  evaluateTicketSettlement,
} from '../src/utils/accaMath.ts';
import { getLeaguePriority } from '../src/utils/leaguePriority.ts';
import { scoreMarket } from '../src/utils/pickResolver.ts';
import { marketProbability } from '../src/utils/probability.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLATE_DIR = path.join(ROOT, 'data', 'slates');

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

interface Slate {
  dateIso: string;
  fixtures: Fixture[];
  /** Only fixtures whose prices were captured before kickoff (valid for backtests). */
  preMatchFixtures: Fixture[];
}

/**
 * A slate is usable only if a decent number of its fixtures carry both a final
 * score and the pre-match prices that were captured for them. Older archives
 * (before pricing was captured) are skipped instead of pretending they lost.
 */
function loadSlates(): Slate[] {
  const slates: Slate[] = [];
  for (const file of fs.readdirSync(SLATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(SLATE_DIR, file), 'utf8'));
    const all: Fixture[] = raw.fixtures ?? [];
    const priced: Fixture[] = all.filter(
      (f) => f.status === 'Finished' && (f.markets?.length ?? 0) > 0
    );
    if (priced.length < 50) continue;
    const preMatchFixtures = priced.filter(
      (f) =>
        f.pricedAt &&
        f.kickoffTimestamp &&
        Date.parse(f.pricedAt) < f.kickoffTimestamp
    );
    slates.push({
      dateIso: raw.dateIso ?? file.slice(0, 10),
      fixtures: priced,
      preMatchFixtures,
    });
  }
  return slates.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

const round = (v: number, d = 2): number =>
  Math.round(v * 10 ** d) / 10 ** d;

interface TicketResult {
  dateIso: string;
  status: 'Win' | 'Lost' | 'Void';
  legs: number;
  odds: number;
  won: number;
  lost: number;
  voided: number;
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

function summarise(results: TicketResult[]): Summary {
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

  for (const r of results) {
    oddsSum += r.odds;
    legsSum += r.legs;
    if (r.status === 'Win') {
      wins += 1;
      staked += 1;
      returned += r.odds;
      equity += r.odds - 1;
      streak = 0;
    } else if (r.status === 'Lost') {
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
  const avgOdds = results.length > 0 ? round(oddsSum / results.length) : 0;
  return {
    tickets: results.length,
    wins,
    losses,
    voids,
    hitRate: decided > 0 ? round((wins / decided) * 100, 1) : 0,
    breakEvenHitRate: avgOdds > 0 ? round(100 / avgOdds, 1) : 0,
    roi: staked > 0 ? round(((returned - staked) / staked) * 100, 1) : 0,
    netPnl: round(returned - staked),
    avgOdds,
    avgLegs: results.length > 0 ? round(legsSum / results.length, 1) : 0,
    maxDrawdown: round(maxDrawdown),
    longestLossStreak,
  };
}

/** 95% Wilson interval for a proportion, as percentages. */
function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [
    round(Math.max(0, centre - margin) * 100, 1),
    round(Math.min(1, centre + margin) * 100, 1),
  ];
}

/* ------------------------------------------------------------------ */
/* Engine backtest (exactly what the app builds today)                 */
/* ------------------------------------------------------------------ */

function runTicket(
  slates: Slate[],
  strategy: AccaStrategy,
  targetOdds: number,
  maxLegs: number
): TicketResult[] {
  const out: TicketResult[] = [];
  for (const slate of slates) {
    const legs = buildRecommendedAcca(
      slate.fixtures,
      targetOdds,
      strategy,
      maxLegs
    );
    if (legs.length === 0) continue;
    const settlement = evaluateTicketSettlement(legs, slate.fixtures, 1);
    if (
      settlement.status !== 'Win' &&
      settlement.status !== 'Lost' &&
      settlement.status !== 'Void'
    ) {
      continue;
    }
    out.push({
      dateIso: slate.dateIso,
      status: settlement.status,
      legs: legs.length,
      odds: round(calculateTotalOdds(legs)),
      won: settlement.winCount,
      lost: settlement.lostCount,
      voided: settlement.voidCount,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Leg-level calibration                                               */
/* ------------------------------------------------------------------ */

interface LegObservation {
  dateIso: string;
  fixtureId: string;
  competition: string;
  country: string;
  marketKey: string;
  marketType: MarketType;
  odds: number;
  fair: number;
  home: boolean;
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
  const id = market.id;
  const suffix = id.slice(id.indexOf('-') + 1);
  return suffix in MARKET_LABELS ? suffix : market.marketType;
}

function collectLegObservations(
  slates: Slate[],
  pickFor: (fixture: Fixture) => MarketOption | null
): LegObservation[] {
  const rows: LegObservation[] = [];
  for (const slate of slates) {
    for (const fixture of slate.fixtures) {
      const market = pickFor(fixture);
      if (!market) continue;
      const status = evaluateMarketSettlement(fixture, market);
      if (status !== 'Win' && status !== 'Lost') continue;
      const key = marketKeyOf(market);
      rows.push({
        dateIso: slate.dateIso,
        fixtureId: fixture.id,
        competition: fixture.competition,
        country: fixture.country,
        marketKey: key,
        marketType: market.marketType,
        odds: market.odds,
        fair: market.fairProbability ?? (1 / market.odds) * 100,
        home: /(^|[^a-z])home([^a-z]|$)/i.test(market.label),
        won: status === 'Win',
      });
    }
  }
  return rows;
}

const ODDS_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '1.00-1.29', min: 1, max: 1.29 },
  { label: '1.30-1.49', min: 1.3, max: 1.49 },
  { label: '1.50-1.69', min: 1.5, max: 1.69 },
  { label: '1.70-1.99', min: 1.7, max: 1.99 },
  { label: '2.00-2.49', min: 2, max: 2.49 },
  { label: '2.50-3.49', min: 2.5, max: 3.49 },
  { label: '3.50+', min: 3.5, max: 1000 },
];

function oddsBandOf(odds: number): string {
  return (
    ODDS_BUCKETS.find((b) => odds >= b.min && odds <= b.max)?.label ?? 'other'
  );
}

interface GroupStat {
  label: string;
  legs: number;
  wins: number;
  hitRate: number;
  avgOdds: number;
  fair: number;
  edge: number;
  roi: number;
  /** ROI bootstrap interval, resampling whole matchdays. */
  roiCi: [number, number];
  ci: [number, number];
}

function groupStats(
  rows: LegObservation[],
  keyOf: (row: LegObservation) => string,
  minLegs = 0
): GroupStat[] {
  const groups = new Map<string, LegObservation[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .filter(([, list]) => list.length >= minLegs)
    .map(([label, list]) => {
      const n = list.length;
      const wins = list.filter((r) => r.won).length;
      const returned = list.reduce((s, r) => s + (r.won ? r.odds : 0), 0);
      const fair = list.reduce((s, r) => s + r.fair / 100, 0) / n;
      return {
        label,
        legs: n,
        wins,
        hitRate: round((wins / n) * 100, 1),
        avgOdds: round(list.reduce((s, r) => s + r.odds, 0) / n),
        fair: round(fair * 100, 1),
        edge: round((wins / n - fair) * 100, 1),
        roi: round(((returned - n) / n) * 100, 1),
        roiCi: clusterRoiCi(list),
        ci: wilson(wins, n),
      };
    })
    .sort((a, b) => b.legs - a.legs);
}

/** Resample matchdays (not legs) to respect same-day correlation. */
function clusterRoiCi(rows: LegObservation[], iterations = 2000): [number, number] {
  const days = new Map<string, LegObservation[]>();
  for (const r of rows) {
    const list = days.get(r.dateIso);
    if (list) list.push(r);
    else days.set(r.dateIso, [r]);
  }
  const keys = [...days.keys()];
  if (keys.length < 3) return [0, 0];

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let n = 0;
    let ret = 0;
    for (let k = 0; k < keys.length; k++) {
      const day = days.get(keys[Math.floor(Math.random() * keys.length)])!;
      for (const r of day) {
        n += 1;
        ret += r.won ? r.odds : 0;
      }
    }
    samples.push(((ret - n) / n) * 100);
  }
  samples.sort((a, b) => a - b);
  return [
    round(samples[Math.floor(iterations * 0.025)], 1),
    round(samples[Math.floor(iterations * 0.975)], 1),
  ];
}

/* ------------------------------------------------------------------ */
/* Parameterised ticket builder (in-memory experiment only)            */
/* ------------------------------------------------------------------ */

interface AccaParams {
  strategy: AccaStrategy;
  targetOdds: number;
  maxLegs: number;
  marketKeys?: string[];
  minLegOdds: number;
  maxLegOdds: number;
  minFair: number;
  topLeaguesOnly: boolean;
  upgradeToTarget: boolean;
}

const DEFAULT_PARAMS: AccaParams = {
  strategy: 'balanced',
  targetOdds: 5,
  maxLegs: 8,
  minLegOdds: 1.05,
  maxLegOdds: 35,
  minFair: 0,
  topLeaguesOnly: false,
  upgradeToTarget: true,
};

function legFrom(fixture: Fixture, market: MarketOption): AccaLeg {
  return {
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    competition: fixture.competition,
    matchDate: fixture.matchDate,
    kickoffTime: fixture.kickoffTime,
    marketId: market.id,
    marketLabel: market.label,
    marketType: market.marketType,
    odds: market.odds,
    impliedProbability: market.impliedProbability,
    fairProbability: market.fairProbability,
    rationale: market.rationale,
    bookmaker: market.bookmaker,
    locked: false,
  };
}

function buildTicket(fixtures: Fixture[], params: AccaParams): AccaLeg[] {
  const candidates: Array<{
    fixture: Fixture;
    market: MarketOption;
    band: number;
    leagueRank: number;
  }> = [];

  for (const fixture of fixtures) {
    if (fixture.markets.length === 0) continue;
    if (params.topLeaguesOnly) {
      if (getLeaguePriority(fixture.competition, fixture.country) > 24) continue;
    }

    const allowed = fixture.markets.filter(
      (m) =>
        Number.isFinite(m.odds) &&
        m.odds > params.minLegOdds &&
        m.odds <= params.maxLegOdds &&
        (!params.marketKeys || params.marketKeys.includes(marketKeyOf(m))) &&
        marketProbability(m) >= params.minFair
    );
    if (allowed.length === 0) continue;

    let market: MarketOption;
    if (params.strategy === 'balanced') {
      market =
        allowed.find((m) => m.id === fixture.recommendedPickId) ??
        allowed.reduce((best, m) =>
          marketProbability(m) > marketProbability(best) ? m : best
        );
    } else if (params.strategy === 'probability') {
      market = allowed.reduce((best, m) =>
        marketProbability(m) > marketProbability(best) ? m : best
      );
    } else {
      market = allowed.reduce((best, m) =>
        scoreMarket(fixture, m, params.strategy) >
        scoreMarket(fixture, best, params.strategy)
          ? m
          : best
      );
    }

    candidates.push({
      fixture,
      market,
      band: Math.round(scoreMarket(fixture, market, params.strategy) * 20),
      leagueRank: getLeaguePriority(fixture.competition, fixture.country),
    });
  }

  candidates.sort((a, b) => {
    if (b.band !== a.band) return b.band - a.band;
    if (a.leagueRank !== b.leagueRank) return a.leagueRank - b.leagueRank;
    return (a.fixture.kickoffTimestamp ?? 0) - (b.fixture.kickoffTimestamp ?? 0);
  });

  const legs: AccaLeg[] = [];
  let product = 1;
  for (const c of candidates) {
    if (legs.length >= params.maxLegs) break;
    if (legs.length > 0 && product >= params.targetOdds) break;
    legs.push(legFrom(c.fixture, c.market));
    product *= c.market.odds;
  }

  if (params.upgradeToTarget && product < params.targetOdds) {
    for (let i = 0; i < legs.length && product < params.targetOdds; i++) {
      const fixture = fixtures.find((f) => f.id === legs[i].fixtureId);
      if (!fixture) continue;
      const upgrade = fixture.markets
        .filter(
          (m) =>
            m.odds > legs[i].odds &&
            m.odds <= Math.min(3.4, params.maxLegOdds) &&
            (!params.marketKeys || params.marketKeys.includes(marketKeyOf(m)))
        )
        .sort((a, b) => a.odds - b.odds)[0];
      if (!upgrade) continue;
      product = (product / legs[i].odds) * upgrade.odds;
      legs[i] = legFrom(fixture, upgrade);
    }
  }

  return legs;
}

function runParamTicket(
  slates: Slate[],
  params: AccaParams
): TicketResult[] {
  const out: TicketResult[] = [];
  for (const slate of slates) {
    const legs = buildTicket(slate.fixtures, params);
    if (legs.length === 0) continue;
    const settlement = evaluateTicketSettlement(legs, slate.fixtures, 1);
    if (
      settlement.status !== 'Win' &&
      settlement.status !== 'Lost' &&
      settlement.status !== 'Void'
    ) {
      continue;
    }
    out.push({
      dateIso: slate.dateIso,
      status: settlement.status,
      legs: legs.length,
      odds: round(calculateTotalOdds(legs)),
      won: settlement.winCount,
      lost: settlement.lostCount,
      voided: settlement.voidCount,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reporting helpers                                                   */
/* ------------------------------------------------------------------ */

function pad(value: string | number, width: number): string {
  return String(value).padStart(width);
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const line = (cells: Array<string | number>): string =>
    cells.map((c, i) => pad(c, widths[i])).join('  ');
  return [
    line(headers),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...rows.map(line),
  ].join('\n');
}

function main(): void {
  const slates = loadSlates();
  const allFixtures = slates.reduce((n, s) => n + s.fixtures.length, 0);
  const allMarkets = slates.reduce(
    (n, s) => n + s.fixtures.reduce((m, f) => m + f.markets.length, 0),
    0
  );

  const lines: string[] = [];
  const out: Record<string, unknown> = {};

  lines.push(
    `Backtest window: ${slates[0]?.dateIso} -> ${slates[slates.length - 1]?.dateIso} (${slates.length} priced matchdays)`
  );
  lines.push(
    `Priced fixtures: ${allFixtures}   priced outcome rows: ${allMarkets}`
  );
  const contaminated = slates.reduce(
    (n, s) => n + (s.fixtures.length - s.preMatchFixtures.length),
    0
  );
  lines.push('');
  lines.push(
    '!! PRICE-QUALITY WARNING: ' +
      `${contaminated}/${allFixtures} priced fixtures were first captured AFTER kickoff,`
  );
  lines.push(
    '   so their odds are in-play/final, not the pre-match prices a ticket was built on.'
  );
  lines.push(
    '   Sections 1-8 describe engine COMPOSITION only; their ROI is not a valid edge measure.'
  );
  lines.push(
    '   Section 9 repeats the checks on the pre-kickoff subset, which is the only valid sample.'
  );
  lines.push('');

  /* ---- 1. Baseline ---- */
  lines.push('1. WHAT THE APP BUILDS TODAY — one 5.00+ ticket per matchday, 1u flat');
  lines.push('   [composition view only: these prices are post-kickoff for 11-10..11-16]');
  const baseline = STRATEGIES.map((strategy) => {
    const results = runTicket(slates, strategy, 5, 8);
    return { strategy, results, summary: summarise(results) };
  });
  lines.push(
    table(
      [
        'strategy',
        'W-L-V',
        'hit%',
        'break-even',
        'avgOdds',
        'legs',
        'ROI%',
        'P&L',
        'maxLossStreak',
        '95% CI',
      ],
      baseline.map(({ strategy, summary: s }) => [
        strategy,
        `${s.wins}-${s.losses}-${s.voids}`,
        s.hitRate,
        s.breakEvenHitRate,
        s.avgOdds,
        s.avgLegs,
        s.roi,
        s.netPnl,
        s.longestLossStreak,
        `${wilson(s.wins, s.wins + s.losses)[0]}-${wilson(s.wins, s.wins + s.losses)[1]}%`,
      ])
    )
  );
  lines.push('');

  /* ---- 2. Target/legs sweep with the real engine ---- */
  lines.push('2. TARGET ODDS x MAX LEGS (real engine, all strategies pooled per row)');
  const targetRows: Array<Array<string | number>> = [];
  for (const targetOdds of [2, 3, 4, 5, 8, 12, 20]) {
    for (const maxLegs of [2, 3, 4, 5, 6, 8]) {
      const results = STRATEGIES.flatMap((s) =>
        runTicket(slates, s, targetOdds, maxLegs)
      );
      const s = summarise(results);
      targetRows.push([
        targetOdds.toFixed(2),
        maxLegs,
        s.tickets,
        `${s.wins}-${s.losses}`,
        s.hitRate,
        s.breakEvenHitRate,
        s.avgOdds,
        s.avgLegs,
        s.roi,
        s.netPnl,
      ]);
    }
  }
  lines.push(
    table(
      ['target', 'maxLegs', 'tickets', 'W-L', 'hit%', 'break-even', 'avgOdds', 'legs', 'ROI%', 'P&L'],
      targetRows
    )
  );
  lines.push('');
  lines.push('The same, per strategy, at the app\'s three target buttons (max 8 legs):');
  const perStrategy: Array<Array<string | number>> = [];
  for (const strategy of STRATEGIES) {
    for (const targetOdds of [5, 8, 12]) {
      const s = summarise(runTicket(slates, strategy, targetOdds, 8));
      perStrategy.push([
        strategy,
        targetOdds.toFixed(2),
        `${s.wins}-${s.losses}`,
        s.hitRate,
        s.breakEvenHitRate,
        s.avgOdds,
        s.avgLegs,
        s.roi,
        s.netPnl,
      ]);
    }
  }
  lines.push(
    table(
      ['strategy', 'target', 'W-L', 'hit%', 'break-even', 'avgOdds', 'legs', 'ROI%', 'P&L'],
      perStrategy
    )
  );
  lines.push('');

  /* ---- 3. Market calibration: every priced outcome ---- */
  lines.push('3. EVERY PRICED OUTCOME IN THE ARCHIVE — is the book beatable?');
  lines.push('   [CONTAMINATED for 11-10..11-16; see section 9 for the clean sample]');
  lines.push('   edge = actual hit rate minus de-vigged fair probability (pp).');
  lines.push('   ROI = flat-staking every leg at the quoted price.');
  const allOutcomes: LegObservation[] = [];
  for (const slate of slates) {
    for (const fixture of slate.fixtures) {
      for (const market of fixture.markets) {
        const status = evaluateMarketSettlement(fixture, market);
        if (status !== 'Win' && status !== 'Lost') continue;
        allOutcomes.push({
          dateIso: slate.dateIso,
          fixtureId: fixture.id,
          competition: fixture.competition,
          country: fixture.country,
          marketKey: marketKeyOf(market),
          marketType: market.marketType,
          odds: market.odds,
          fair: market.fairProbability ?? (1 / market.odds) * 100,
          home: /home/i.test(market.label),
          won: status === 'Win',
        });
      }
    }
  }

  lines.push(
    table(
      ['market', 'legs', 'hit%', 'avgOdds', 'fair%', 'edge pp', 'ROI%', 'ROI 95% CI'],
      groupStats(allOutcomes, (r) => MARKET_LABELS[r.marketKey] ?? r.marketKey, 30)
        .sort((a, b) => b.edge - a.edge)
        .map((s) => [
          s.label,
          s.legs,
          s.hitRate,
          s.avgOdds,
          s.fair,
          s.edge,
          s.roi,
          `${s.roiCi[0]}..${s.roiCi[1]}`,
        ])
    )
  );
  lines.push('');
  lines.push(
    table(
      ['odds band', 'legs', 'hit%', 'avgOdds', 'fair%', 'edge pp', 'ROI%', 'ROI 95% CI'],
      groupStats(allOutcomes, (r) => oddsBandOf(r.odds), 30)
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((s) => [
          s.label,
          s.legs,
          s.hitRate,
          s.avgOdds,
          s.fair,
          s.edge,
          s.roi,
          `${s.roiCi[0]}..${s.roiCi[1]}`,
        ])
    )
  );
  lines.push('');
  lines.push('Market x odds band (n >= 60), sorted by edge:');
  const cross = groupStats(
    allOutcomes,
    (r) => `${MARKET_LABELS[r.marketKey] ?? r.marketKey} | ${oddsBandOf(r.odds)}`,
    60
  ).sort((a, b) => b.edge - a.edge);
  lines.push(
    table(
      ['group', 'legs', 'hit%', 'fair%', 'edge pp', 'ROI%', 'ROI 95% CI'],
      cross.map((s) => [
        s.label,
        s.legs,
        s.hitRate,
        s.fair,
        s.edge,
        s.roi,
        `${s.roiCi[0]}..${s.roiCi[1]}`,
      ])
    )
  );
  lines.push('');

  /* ---- 4. What each strategy actually picks ---- */
  lines.push('4. WHAT EACH STRATEGY ACTUALLY PICKS (one pick per fixture, ~800 legs/strategy)');
  const strategyPools = STRATEGIES.map((strategy) => {
    const rows = collectLegObservations(slates, (fixture) =>
      pickForStrategy(fixture, strategy)
    );
    return { strategy, rows, summary: legPoolSummary(rows) };
  });
  lines.push(
    table(
      ['strategy', 'legs', 'hit%', 'avgOdds', 'fair%', 'edge pp', 'leg ROI%', 'ROI 95% CI'],
      strategyPools.map(({ strategy, summary: s }) => [
        strategy,
        s.legs,
        s.hitRate,
        s.avgOdds,
        s.fair,
        s.edge,
        s.roi,
        `${s.roiCi[0]}..${s.roiCi[1]}`,
      ])
    )
  );
  lines.push('');

  /* ---- 5. Parameter sweep ---- */
  lines.push('5. PARAMETER SWEEP — which filters produce a positive leg pool?');
  lines.push('   "leg ROI" is the flat return of every fixture pick under that filter.');
  lines.push('   "proj acca ROI" = (1 + leg ROI)^legs - 1, the compounding effect.');
  const marketSets: { label: string; keys: string[] }[] = [
    { label: 'any', keys: [] },
    { label: 'goals', keys: ['ou-15', 'ou-25', 'btts-yes'] },
    { label: 'ou15+dc', keys: ['ou-15', 'dc-1x', 'dc-x2'] },
    { label: 'ou15', keys: ['ou-15'] },
    { label: 'dc', keys: ['dc-1x', 'dc-x2'] },
    { label: '1x2-home', keys: ['1x2-h'] },
    { label: '1x2', keys: ['1x2-h', '1x2-a'] },
  ];
  const oddsBands: { label: string; min: number; max: number }[] = [
    { label: 'any', min: 1.05, max: 35 },
    { label: '1.05-1.35', min: 1.05, max: 1.35 },
    { label: '1.25-1.55', min: 1.25, max: 1.55 },
    { label: '1.35-1.75', min: 1.35, max: 1.75 },
    { label: '1.55-2.00', min: 1.55, max: 2.0 },
    { label: '1.80-2.40', min: 1.8, max: 2.4 },
  ];

  const sweep: Array<{
    strategy: AccaStrategy;
    marketSet: string;
    oddsBand: string;
    topLeagues: boolean;
    pool: GroupStat;
    tickets: number;
    wins: number;
    losses: number;
    hitRate: number;
    avgOdds: number;
    roi: number;
  }> = [];

  for (const strategy of STRATEGIES) {
    for (const marketSet of marketSets) {
      for (const band of oddsBands) {
        for (const topLeagues of [false, true]) {
          const params: AccaParams = {
            ...DEFAULT_PARAMS,
            strategy,
            marketKeys: marketSet.keys.length ? marketSet.keys : undefined,
            minLegOdds: band.min,
            maxLegOdds: band.max,
            topLeaguesOnly: topLeagues,
          };
          const rows = collectLegObservations(slates, (fixture) =>
            pickForParams(fixture, params)
          );
          if (rows.length < 150) continue;
          const results = runParamTicket(slates, { ...params, targetOdds: 5, maxLegs: 8 });
          const s = summarise(results);
          sweep.push({
            strategy,
            marketSet: marketSet.label,
            oddsBand: band.label,
            topLeagues,
            pool: legPoolSummary(rows),
            tickets: s.tickets,
            wins: s.wins,
            losses: s.losses,
            hitRate: s.hitRate,
            avgOdds: s.avgOdds,
            roi: s.roi,
          });
        }
      }
    }
  }

  const positivePools = [...sweep]
    .filter((s) => s.pool.roi > 0)
    .sort((a, b) => b.pool.roi - a.pool.roi);

  lines.push('Positive leg-pool ROI (the only configs that can survive compounding):');
  lines.push(
    table(
      ['strategy', 'markets', 'leg odds', 'topLg', 'legs', 'hit%', 'fair%', 'edge pp', 'leg ROI%', 'ROI CI', '5.00+ tickets W-L', 'ticket ROI%'],
      positivePools.slice(0, 25).map((s) => [
        s.strategy,
        s.marketSet,
        s.oddsBand,
        s.topLeagues ? 'yes' : 'no',
        s.pool.legs,
        s.pool.hitRate,
        s.pool.fair,
        s.pool.edge,
        s.pool.roi,
        `${s.pool.roiCi[0]}..${s.pool.roiCi[1]}`,
        `${s.wins}-${s.losses}`,
        s.roi,
      ])
    )
  );
  lines.push('');
  lines.push('Best 15 by projected acca ROI ((1+legROI)^legs-1, 6 legs):');
  const projected = [...sweep]
    .map((s) => ({
      ...s,
      projectedRoi: round(((1 + s.pool.roi / 100) ** 6 - 1) * 100, 1),
    }))
    .sort((a, b) => b.projectedRoi - a.projectedRoi);
  lines.push(
    table(
      ['strategy', 'markets', 'leg odds', 'topLg', 'legs', 'leg ROI%', 'proj 6-leg ROI%', '5.00+ actual W-L', 'actual ROI%'],
      projected.slice(0, 15).map((s) => [
        s.strategy,
        s.marketSet,
        s.oddsBand,
        s.topLeagues ? 'yes' : 'no',
        s.pool.legs,
        s.pool.roi,
        s.projectedRoi,
        `${s.wins}-${s.losses}`,
        s.roi,
      ])
    )
  );
  lines.push('');
  lines.push('Worst 8 by projected acca ROI:');
  lines.push(
    table(
      ['strategy', 'markets', 'leg odds', 'topLg', 'legs', 'leg ROI%', 'proj 6-leg ROI%'],
      projected.slice(-8).map((s) => [
        s.strategy,
        s.marketSet,
        s.oddsBand,
        s.topLeagues ? 'yes' : 'no',
        s.pool.legs,
        s.pool.roi,
        s.projectedRoi,
      ])
    )
  );
  lines.push('');

  /* ---- 6. Matchday detail for the default ---- */
  lines.push('6. MATCHDAY DETAIL — balanced, 5.00+, max 8 legs (the app default)');
  const detail = runTicket(slates, 'balanced', 5, 8);
  lines.push(
    table(
      ['date', 'result', 'legs', 'odds', 'W-L-V'],
      detail.map((r) => [
        r.dateIso,
        r.status,
        r.legs,
        r.odds.toFixed(2),
        `${r.won}-${r.lost}-${r.voided}`,
      ])
    )
  );
  lines.push('');
  lines.push('Same-ticket leg detail (market, odds, result):');
  for (const slate of slates) {
    const legs = buildRecommendedAcca(slate.fixtures, 5, 'balanced', 8);
    const byId = new Map(slate.fixtures.map((f) => [f.id, f]));
    const parts = legs.map((leg) => {
      const fixture = byId.get(leg.fixtureId);
      const status = fixture
        ? evaluateMarketSettlement(fixture, {
            id: leg.marketId,
            label: leg.marketLabel,
            marketType: leg.marketType,
          })
        : 'Pending';
      return `${MARKET_LABELS[leg.marketId.slice(leg.marketId.indexOf('-') + 1)] ?? leg.marketType}@${leg.odds.toFixed(2)}:${status}`;
    });
    lines.push(`${slate.dateIso}  ${parts.join('  ')}`);
  }

  /* ---- 7. Focused sweet-spot grid, no forced odds upgrade ---- */
  lines.push('');
  lines.push('7. SWEET-SPOT GRID — no forced upgrade to the target (honest odds)');
  const focused: Array<{
    strategy: AccaStrategy;
    targetOdds: number;
    maxLegs: number;
    summary: Summary;
  }> = [];
  for (const strategy of STRATEGIES) {
    for (const targetOdds of [1.6, 1.8, 2, 2.5, 3, 4]) {
      for (const maxLegs of [2, 3, 4, 5]) {
        const results = runParamTicket(slates, {
          ...DEFAULT_PARAMS,
          strategy,
          targetOdds,
          maxLegs,
          upgradeToTarget: false,
        });
        focused.push({
          strategy,
          targetOdds,
          maxLegs,
          summary: summarise(results),
        });
      }
    }
  }
  const renderFocused = (rows: typeof focused): string =>
    table(
      ['strategy', 'target', 'maxLegs', 'W-L', 'hit%', 'break-even', 'avgOdds', 'legs', 'ROI%', 'P&L'],
      rows.map((f) => [
        f.strategy,
        f.targetOdds.toFixed(2),
        f.maxLegs,
        `${f.summary.wins}-${f.summary.losses}`,
        f.summary.hitRate,
        f.summary.breakEvenHitRate,
        f.summary.avgOdds,
        f.summary.avgLegs,
        f.summary.roi,
        f.summary.netPnl,
      ])
    );

  lines.push('Highest hit rate (closest thing to "more wins than losses"):');
  lines.push(
    renderFocused(
      [...focused].sort((a, b) => b.summary.hitRate - a.summary.hitRate).slice(0, 12)
    )
  );
  lines.push('');
  lines.push('Best ROI:');
  lines.push(
    renderFocused([...focused].sort((a, b) => b.summary.roi - a.summary.roi).slice(0, 12))
  );
  lines.push('');
  lines.push('The 2-3 leg region in full:');
  lines.push(
    renderFocused(
      focused
        .filter((f) => [2, 3].includes(f.maxLegs))
        .sort((a, b) => a.targetOdds - b.targetOdds || a.maxLegs - b.maxLegs)
    )
  );
  lines.push('');

  /* ---- 8. Counterfactual: keep the same picks, cut the leg count ---- */
  lines.push('8. SAME PICKS, FEWER LEGS — top-k legs by fair probability per matchday');
  const counterRows: Array<Array<string | number>> = [];
  for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const results: TicketResult[] = [];
    for (const slate of slates) {
      const all = buildRecommendedAcca(slate.fixtures, 12, 'balanced', 8).filter(
        (leg) => Boolean(leg.fairProbability)
      );
      const chosen = [...all]
        .sort((a, b) => (b.fairProbability ?? 0) - (a.fairProbability ?? 0))
        .slice(0, k);
      if (chosen.length === 0) continue;
      const settlement = evaluateTicketSettlement(chosen, slate.fixtures, 1);
      if (
        settlement.status !== 'Win' &&
        settlement.status !== 'Lost' &&
        settlement.status !== 'Void'
      ) {
        continue;
      }
      results.push({
        dateIso: slate.dateIso,
        status: settlement.status,
        legs: chosen.length,
        odds: round(calculateTotalOdds(chosen)),
        won: settlement.winCount,
        lost: settlement.lostCount,
        voided: settlement.voidCount,
      });
    }
    const s = summarise(results);
    counterRows.push([
      k,
      `${s.wins}-${s.losses}`,
      s.hitRate,
      s.breakEvenHitRate,
      s.avgOdds,
      s.roi,
      s.netPnl,
    ]);
  }
  lines.push(
    table(
      ['legs', 'W-L', 'hit%', 'break-even', 'avgOdds', 'ROI%', 'P&L'],
      counterRows
    )
  );
  lines.push('');

  lines.push('Legs won per matchday on the default 5.00+ ticket:');
  const legsWon = detail.map((r) => `${r.dateIso} ${r.won}/${r.legs}`);
  lines.push(legsWon.join('   '));

  /* ---- 9. Clean pre-match-only subset ---- */
  lines.push('');
  lines.push('9. DATA INTEGRITY CHECK — prices captured before kickoff only');
  const cleanSlates = slates
    .map((s) => ({ dateIso: s.dateIso, fixtures: s.preMatchFixtures, preMatchFixtures: s.preMatchFixtures }))
    .filter((s) => s.fixtures.length >= 30);
  const cleanFixtures = cleanSlates.reduce((n, s) => n + s.fixtures.length, 0);
  lines.push(
    `Clean matchdays: ${cleanSlates.map((s) => `${s.dateIso} (${s.fixtures.length})`).join(', ') || 'none'}`
  );
  lines.push(`Clean priced fixtures: ${cleanFixtures}`);
  if (cleanFixtures > 0) {
    const cleanOutcomes: LegObservation[] = [];
    for (const slate of cleanSlates) {
      for (const fixture of slate.fixtures) {
        for (const market of fixture.markets) {
          const status = evaluateMarketSettlement(fixture, market);
          if (status !== 'Win' && status !== 'Lost') continue;
          cleanOutcomes.push({
            dateIso: slate.dateIso,
            fixtureId: fixture.id,
            competition: fixture.competition,
            country: fixture.country,
            marketKey: marketKeyOf(market),
            marketType: market.marketType,
            odds: market.odds,
            fair: market.fairProbability ?? (1 / market.odds) * 100,
            home: /home/i.test(market.label),
            won: status === 'Win',
          });
        }
      }
    }
    lines.push('');
    lines.push('Clean market calibration:');
    lines.push(
      table(
        ['market', 'legs', 'hit%', 'avgOdds', 'fair%', 'edge pp', 'ROI%', '95% CI'],
        groupStats(cleanOutcomes, (r) => MARKET_LABELS[r.marketKey] ?? r.marketKey, 20)
          .sort((a, b) => b.edge - a.edge)
          .map((s) => [
            s.label,
            s.legs,
            s.hitRate,
            s.avgOdds,
            s.fair,
            s.edge,
            s.roi,
            `${s.ci[0]}-${s.ci[1]}%`,
          ])
      )
    );
    lines.push('');
    lines.push('Clean odds-band calibration:');
    lines.push(
      table(
        ['band', 'legs', 'hit%', 'avgOdds', 'fair%', 'edge pp', 'ROI%', '95% CI'],
        groupStats(cleanOutcomes, (r) => oddsBandOf(r.odds), 20)
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((s) => [
            s.label,
            s.legs,
            s.hitRate,
            s.avgOdds,
            s.fair,
            s.edge,
            s.roi,
            `${s.ci[0]}-${s.ci[1]}%`,
          ])
      )
    );
    lines.push('');
    lines.push('Clean pre-match 5.00+ tickets (engine default):');
    const cleanBaseline = STRATEGIES.map((strategy) => {
      const results = runTicket(cleanSlates, strategy, 5, 8);
      return { strategy, results, summary: summarise(results) };
    });
    lines.push(
      table(
        ['strategy', 'W-L', 'hit%', 'avgOdds', 'legs', 'ROI%'],
        cleanBaseline.map(({ strategy, summary: s }) => [
          strategy,
          `${s.wins}-${s.losses}`,
          s.hitRate,
          s.avgOdds,
          s.avgLegs,
          s.roi,
        ])
      )
    );
    for (const slate of cleanSlates) {
      const legs = buildRecommendedAcca(slate.fixtures, 5, 'balanced', 8);
      const byId = new Map(slate.fixtures.map((f) => [f.id, f]));
      lines.push(
        `${slate.dateIso}  ` +
          legs
            .map((leg) => {
              const fixture = byId.get(leg.fixtureId);
              const status = fixture
                ? evaluateMarketSettlement(fixture, {
                    id: leg.marketId,
                    label: leg.marketLabel,
                    marketType: leg.marketType,
                  })
                : 'Pending';
              return `${MARKET_LABELS[leg.marketId.slice(leg.marketId.indexOf('-') + 1)] ?? leg.marketType}@${leg.odds.toFixed(2)}:${status}`;
            })
            .join('  ')
      );
    }
  }

  out.meta = {
    slates: slates.map((s) => s.dateIso),
    fixtures: allFixtures,
    outcomes: allMarkets,
  };  out.baseline = Object.fromEntries(
    baseline.map(({ strategy, summary, results }) => [
      strategy,
      { summary, results },
    ])
  );
  out.calibration = {
    byMarket: groupStats(allOutcomes, (r) => MARKET_LABELS[r.marketKey] ?? r.marketKey, 30),
    byOddsBand: groupStats(allOutcomes, (r) => oddsBandOf(r.odds), 30),
    cross,
  };
  out.strategyPools = strategyPools;
  out.sweep = sweep;
  out.detail = detail;
  out.focused = focused;
  out.counterfactual = counterRows;

  const text = lines.join('\n');
  console.log(text);

  const flag = process.argv.indexOf('--json');
  if (flag !== -1 && process.argv[flag + 1]) {
    fs.writeFileSync(
      path.resolve(process.argv[flag + 1]),
      JSON.stringify(out, null, 2)
    );
  }
}

/* ------------------------------------------------------------------ */
/* Small helpers used above                                            */
/* ------------------------------------------------------------------ */

function pickForStrategy(
  fixture: Fixture,
  strategy: AccaStrategy
): MarketOption | null {
  // Mirrors resolvePick without importing the private sort helpers.
  const priced = fixture.markets.filter((m) => m.odds > 1);
  if (priced.length === 0) return null;
  if (strategy === 'probability') {
    return priced.reduce((best, m) =>
      marketProbability(m) > marketProbability(best) ? m : best
    );
  }
  if (strategy === 'balanced') {
    return (
      priced.find((m) => m.id === fixture.recommendedPickId) ??
      priced.reduce((best, m) =>
        marketProbability(m) > marketProbability(best) ? m : best
      )
    );
  }
  return priced.reduce((best, m) =>
    scoreMarket(fixture, m, strategy) > scoreMarket(fixture, best, strategy)
      ? m
      : best
  );
}

function pickForParams(
  fixture: Fixture,
  params: AccaParams
): MarketOption | null {
  if (params.topLeaguesOnly) {
    if (getLeaguePriority(fixture.competition, fixture.country) > 24) return null;
  }
  const allowed = fixture.markets.filter(
    (m) =>
      m.odds > params.minLegOdds &&
      m.odds <= params.maxLegOdds &&
      (!params.marketKeys || params.marketKeys.includes(marketKeyOf(m)))
  );
  if (allowed.length === 0) return null;
  const preferred = pickForStrategy(fixture, params.strategy);
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed.reduce((best, m) =>
    marketProbability(m) > marketProbability(best) ? m : best
  );
}

function legPoolSummary(rows: LegObservation[]): GroupStat {
  const stats = groupStats(rows, () => 'pool');
  return (
    stats[0] ?? {
      label: 'pool',
      legs: 0,
      wins: 0,
      hitRate: 0,
      avgOdds: 0,
      fair: 0,
      edge: 0,
      roi: 0,
      roiCi: [0, 0] as [number, number],
      ci: [0, 0] as [number, number],
    }
  );
}

main();
