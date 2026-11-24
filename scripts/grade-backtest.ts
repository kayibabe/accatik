/**
 * Pick Guide grade backtest.
 *
 * Replays the app's Recommended Angle card against the same settlement rule the
 * Pick Guide's Match status column uses, then groups flat one-unit stakes by
 * the grade (High/Solid/Moderate/Speculative) the card carried at capture time.
 *
 * Usage:
 *   npx tsx scripts/grade-backtest.ts
 *   npx tsx scripts/grade-backtest.ts --include-today
 *   npx tsx scripts/grade-backtest.ts --json scripts/grade-backtest-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccaStrategy, Fixture, SettlementStatus } from '../src/types/fixtures.ts';
import { isPriced } from '../src/utils/pickResolver.ts';
import { inferPriceQuality } from '../src/utils/priceQuality.ts';
import { studyPickForFixture } from '../server/lib/combinationRoi.ts';
import { clusterRoiCi } from '../server/lib/roiPromotion.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLATE_DIR = path.join(ROOT, 'data', 'slates');
const TODAY = new Date().toISOString().slice(0, 10);
const INCLUDE_TODAY = process.argv.includes('--include-today');
const JSON_INDEX = process.argv.indexOf('--json');
const JSON_PATH = JSON_INDEX >= 0 ? process.argv[JSON_INDEX + 1] : null;

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];
const BANDS = ['High', 'Solid', 'Moderate', 'Speculative'] as const;
type Band = (typeof BANDS)[number];
type QualityMode = 'all' | 'prematch';

interface Slate {
  dateIso: string;
  fixtures: Fixture[];
}

interface Sample {
  dateIso: string;
  odds: number;
  won: boolean;
}

interface Tally {
  settled: number;
  wins: number;
  losses: number;
  voids: number;
  stake: number;
  returns: number;
  oddsSum: number;
  netPnl: number;
  samples: Sample[];
  days: Map<string, { stake: number; netPnl: number }>;
  firstDateIso: string | null;
  lastDateIso: string | null;
}

const round = (value: number, digits = 1): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

function isDecided(status: SettlementStatus): boolean {
  return status === 'Win' || status === 'Lost' || status === 'Void';
}

function isSampleFixture(fixture: Fixture): boolean {
  const home = fixture.score?.home;
  const away = fixture.score?.away;
  return (
    fixture.status === 'Finished' &&
    home !== null && home !== undefined &&
    away !== null && away !== undefined &&
    (fixture.allMarkets ?? fixture.markets).some(isPriced)
  );
}

function loadSlates(): Slate[] {
  if (!fs.existsSync(SLATE_DIR)) return [];
  const slates: Slate[] = [];
  for (const file of fs.readdirSync(SLATE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(SLATE_DIR, file), 'utf8')) as {
      dateIso?: string;
      fixtures?: Fixture[];
    };
    const dateIso = raw.dateIso ?? file.slice(0, 10);
    if (!INCLUDE_TODAY && dateIso >= TODAY) continue;
    const fixtures = (raw.fixtures ?? []).filter(isSampleFixture);
    if (fixtures.length === 0) continue;
    slates.push({ dateIso, fixtures });
  }
  return slates.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function newTally(): Tally {
  return {
    settled: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    stake: 0,
    returns: 0,
    oddsSum: 0,
    netPnl: 0,
    samples: [],
    days: new Map(),
    firstDateIso: null,
    lastDateIso: null,
  };
}

function record(
  tally: Tally,
  odds: number,
  status: SettlementStatus,
  dateIso: string
): void {
  tally.settled += 1;
  if (!tally.firstDateIso || dateIso < tally.firstDateIso) tally.firstDateIso = dateIso;
  if (!tally.lastDateIso || dateIso > tally.lastDateIso) tally.lastDateIso = dateIso;
  if (status === 'Void') {
    tally.voids += 1;
    return;
  }

  const won = status === 'Win';
  tally.wins += won ? 1 : 0;
  tally.losses += won ? 0 : 1;
  tally.stake += 1;
  tally.oddsSum += odds;
  tally.returns += won ? odds : 0;
  tally.netPnl += won ? odds - 1 : -1;
  tally.samples.push({ dateIso, odds, won });

  const day = tally.days.get(dateIso) ?? { stake: 0, netPnl: 0 };
  day.stake += 1;
  day.netPnl += won ? odds - 1 : -1;
  tally.days.set(dateIso, day);
}

function summarise(tally: Tally, band: Band, strategy: AccaStrategy, quality: QualityMode) {
  const staked = tally.wins + tally.losses;
  const avgOdds = staked > 0 ? tally.oddsSum / staked : 0;
  const stakedDays = [...tally.days.values()].filter((day) => day.stake > 0);
  const ci =
    staked > 0 && stakedDays.length >= 2
      ? clusterRoiCi(tally.samples, 2000)
      : null;
  return {
    strategy,
    quality,
    band,
    settled: tally.settled,
    staked,
    wins: tally.wins,
    losses: tally.losses,
    voids: tally.voids,
    hitRate: staked > 0 ? round((tally.wins / staked) * 100) : null,
    breakEvenHitRate: avgOdds > 0 ? round(100 / avgOdds) : null,
    avgOdds: avgOdds > 0 ? round(avgOdds, 2) : null,
    pnl: round(tally.netPnl, 2),
    roi: tally.stake > 0 ? round((tally.netPnl / tally.stake) * 100) : null,
    positiveDays: stakedDays.filter((day) => day.netPnl > 0).length,
    stakedDays: stakedDays.length,
    roiCi95: ci ? [ci[0], ci[1]] : null,
    firstDateIso: tally.firstDateIso,
    lastDateIso: tally.lastDateIso,
  };
}

function run(strategy: AccaStrategy, quality: QualityMode) {
  const slates = loadSlates();
  const tallies = new Map<Band, Tally>(BANDS.map((band) => [band, newTally()]));
  const contributingDays = new Set<string>();
  let fixturesUsed = 0;

  for (const slate of slates) {
    for (const fixture of slate.fixtures) {
      if (quality === 'prematch' && inferPriceQuality(fixture) !== 'prematch') continue;
      const pick = studyPickForFixture(fixture, strategy, 'angle');
      if (!pick || !isDecided(pick.status) || !(pick.band in Object.fromEntries(BANDS.map((b) => [b, true])))) continue;
      fixturesUsed += 1;
      contributingDays.add(slate.dateIso);
      record(tallies.get(pick.band as Band)!, pick.market.odds, pick.status, slate.dateIso);
    }
  }

  const days = [...contributingDays].sort();
  return {
    strategy,
    quality,
    dateRange: {
      first: days[0] ?? null,
      last: days[days.length - 1] ?? null,
      matchdays: days.length,
    },
    loadedSlates: slates.length,
    fixturesUsed,
    rows: BANDS.map((band) => summarise(tallies.get(band)!, band, strategy, quality)),
  };
}

const results = {
  generatedAt: new Date().toISOString(),
  excludedCurrentAndFuture: !INCLUDE_TODAY,
  stakePerPick: 1,
  voidHandling: 'Void counts as settled, returns stake, excluded from hit rate and ROI.',
  strategies: STRATEGIES.map((strategy) => ({
    strategy,
    all: run(strategy, 'all'),
    prematch: run(strategy, 'prematch'),
  })),
};

const text = JSON.stringify(results, null, 2);
if (JSON_PATH) {
  fs.mkdirSync(path.dirname(path.resolve(JSON_PATH)), { recursive: true });
  fs.writeFileSync(path.resolve(JSON_PATH), text);
  console.log(`Wrote ${JSON_PATH}`);
} else {
  console.log(text);
}
