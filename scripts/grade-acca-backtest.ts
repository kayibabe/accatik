/**
 * Grade-filtered accumulator replay.
 *
 * Answers the follow-up to scripts/grade-backtest.ts: can a negative-ROI set of
 * single picks be turned profitable by grouping them into accumulators, and if
 * so, which grade bands should be allowed?
 *
 * Two views are produced:
 *   1. engine — one deterministic ticket per matchday, built by the real
 *      accumulator engine from the fixtures whose angle grade passed the filter.
 *   2. combos — aggregate of every within-day combination of the same filtered
 *      legs. These tickets overlap heavily, so they are descriptive only.
 *
 * Both views replay only genuinely pre-kickoff prices and settle with the app's
 * evaluateTicketSettlement, the same engine behind Match status.
 *
 * Usage:
 *   npx tsx scripts/grade-acca-backtest.ts
 *   npx tsx scripts/grade-acca-backtest.ts --json scripts/grade-acca-results.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccaStrategy,
  Fixture,
  MarketOption,
  SettlementStatus,
} from '../src/types/fixtures.ts';
import { buildRecommendedAcca, legFromMarket } from '../src/utils/accaEngine.ts';
import { evaluateTicketSettlement } from '../src/utils/accaMath.ts';
import { isPriced } from '../src/utils/pickResolver.ts';
import { inferPriceQuality } from '../src/utils/priceQuality.ts';
import { studyPickForFixture } from '../server/lib/combinationRoi.ts';
import { clusterRoiCi } from '../server/lib/roiPromotion.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLATE_DIR = path.join(ROOT, 'data', 'slates');
const TODAY = new Date().toISOString().slice(0, 10);
const JSON_INDEX = process.argv.indexOf('--json');
const JSON_PATH = JSON_INDEX >= 0 ? process.argv[JSON_INDEX + 1] : null;

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];
const LEG_COUNTS = [2, 3, 4, 5] as const;
const GRADE_SETS = [
  { label: 'High', bands: ['High'] },
  { label: 'Solid', bands: ['Solid'] },
  { label: 'Moderate', bands: ['Moderate'] },
  { label: 'Speculative', bands: ['Speculative'] },
  { label: 'High+Solid', bands: ['High', 'Solid'] },
  { label: 'High+Solid+Moderate', bands: ['High', 'Solid', 'Moderate'] },
  { label: 'All grades', bands: ['High', 'Solid', 'Moderate', 'Speculative'] },
] as const;

type Band = 'High' | 'Solid' | 'Moderate' | 'Speculative';
type GradeSetLabel = (typeof GRADE_SETS)[number]['label'];

interface Pick {
  fixture: Fixture;
  market: MarketOption;
  band: Band;
  won: boolean;
  void: boolean;
}

interface Slate {
  dateIso: string;
  fixtures: Fixture[];
}

interface EngineRow {
  dateIso: string;
  status: 'Win' | 'Lost' | 'Void';
  odds: number;
  legs: number;
}

interface AccaSummary {
  strategy: string;
  gradeSet: GradeSetLabel;
  legs: number;
  tickets: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  avgOdds: number | null;
  roi: number | null;
  pnl: number;
  roiCi95: [number, number] | null;
  positiveDays: number;
  stakeDays: number;
}

interface ComboRow {
  strategy: string;
  gradeSet: GradeSetLabel;
  legs: number;
  combos: number;
  wins: number;
  hitRate: number | null;
  avgOdds: number | null;
  roi: number | null;
  pnl: number;
  positiveDays: number;
  settledDays: number;
}

const round = (value: number, digits = 1): number =>
  Math.round(value * 10 ** digits) / 10 ** digits;

function isDecided(status: SettlementStatus): boolean {
  return status === 'Win' || status === 'Lost' || status === 'Void';
}

function isClean(fixture: Fixture): boolean {
  const home = fixture.score?.home;
  const away = fixture.score?.away;
  return (
    fixture.status === 'Finished' &&
    home !== null &&
    home !== undefined &&
    away !== null &&
    away !== undefined &&
    (fixture.allMarkets ?? fixture.markets).some(isPriced) &&
    inferPriceQuality(fixture) === 'prematch'
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
    if (dateIso >= TODAY) continue;
    const fixtures = (raw.fixtures ?? []).filter(isClean);
    if (fixtures.length === 0) continue;
    slates.push({ dateIso, fixtures });
  }
  return slates.sort((a, b) => a.dateIso.localeCompare(b.dateIso));
}

function collectPicks(slate: Slate, strategy: AccaStrategy): Pick[] {
  const picks: Pick[] = [];
  for (const fixture of slate.fixtures) {
    const study = studyPickForFixture(fixture, strategy, 'angle');
    if (!study || !isDecided(study.status)) continue;
    picks.push({
      fixture,
      market: study.market,
      band: study.band as Band,
      won: study.status === 'Win',
      void: study.status === 'Void',
    });
  }
  return picks;
}

function allowed(band: Band, gradeSet: GradeSetLabel): boolean {
  const set = GRADE_SETS.find((entry) => entry.label === gradeSet)!;
  return (set.bands as readonly string[]).includes(band);
}

function summariseEngine(
  strategy: AccaStrategy,
  gradeSet: GradeSetLabel,
  legs: number,
  rows: EngineRow[]
): AccaSummary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let oddsSum = 0;
  let returns = 0;
  const byDay = new Map<string, { stake: number; pnl: number }>();
  const samples: Array<{ dateIso: string; odds: number; won: boolean }> = [];

  for (const row of rows) {
    oddsSum += row.odds;
    if (row.status === 'Void') {
      voids += 1;
      continue;
    }
    const won = row.status === 'Win';
    wins += won ? 1 : 0;
    losses += won ? 0 : 1;
    returns += won ? row.odds : 0;
    samples.push({ dateIso: row.dateIso, odds: row.odds, won });
    const day = byDay.get(row.dateIso) ?? { stake: 0, pnl: 0 };
    day.stake += 1;
    day.pnl += won ? row.odds - 1 : -1;
    byDay.set(row.dateIso, day);
  }

  const staked = wins + losses;
  const pnl = round(returns - staked, 2);
  const ci = staked > 0 && byDay.size >= 2 ? clusterRoiCi(samples, 2000) : null;
  return {
    strategy,
    gradeSet,
    legs,
    tickets: rows.length,
    wins,
    losses,
    voids,
    hitRate: staked > 0 ? round((wins / staked) * 100) : null,
    avgOdds: staked > 0 ? round(oddsSum / staked, 2) : null,
    roi: staked > 0 ? round(((returns - staked) / staked) * 100) : null,
    pnl,
    roiCi95: ci ? [round(ci[0]), round(ci[1])] : null,
    positiveDays: [...byDay.values()].filter((day) => day.pnl > 0).length,
    stakeDays: [...byDay.values()].filter((day) => day.stake > 0).length,
  };
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/** Sum of products over all k-combinations, via dynamic programming. */
function elementarySymmetric(values: number[], k: number): number {
  const dp = new Array<number>(k + 1).fill(0);
  dp[0] = 1;
  values.forEach((value, index) => {
    for (let j = Math.min(k, index + 1); j >= 1; j -= 1) {
      dp[j] += dp[j - 1] * value;
    }
  });
  return dp[k] ?? 0;
}

function summariseCombos(
  strategy: AccaStrategy,
  gradeSet: GradeSetLabel,
  legs: number,
  byDay: Array<{ dateIso: string; picks: Pick[] }>
): ComboRow {
  let combos = 0;
  let wins = 0;
  let oddsSum = 0;
  let returns = 0;
  let positiveDays = 0;
  let settledDays = 0;

  for (const day of byDay) {
    const eligible = day.picks.filter((pick) => !pick.void && allowed(pick.band, gradeSet));
    if (eligible.length < legs) continue;
    const dayCombos = choose(eligible.length, legs);
    const dayOdds = elementarySymmetric(eligible.map((pick) => pick.market.odds), legs);
    const dayReturns = elementarySymmetric(
      eligible.map((pick) => (pick.won ? pick.market.odds : 0)),
      legs
    );
    const dayWins = choose(eligible.filter((pick) => pick.won).length, legs);
    combos += dayCombos;
    wins += dayWins;
    oddsSum += dayOdds;
    returns += dayReturns;
    settledDays += 1;
    if (dayReturns > dayCombos) positiveDays += 1;
  }

  const pnl = round(returns - combos, 2);
  return {
    strategy,
    gradeSet,
    legs,
    combos,
    wins,
    hitRate: combos > 0 ? round((wins / combos) * 100) : null,
    avgOdds: combos > 0 ? round(oddsSum / combos, 2) : null,
    roi: combos > 0 ? round(((returns - combos) / combos) * 100) : null,
    pnl,
    positiveDays,
    settledDays,
  };
}

const slates = loadSlates();
const engineRows: AccaSummary[] = [];
const comboRows: ComboRow[] = [];

for (const strategy of STRATEGIES) {
  const picksByDate = slates.map((slate) => ({
    dateIso: slate.dateIso,
    picks: collectPicks(slate, strategy),
  }));

  for (const gradeSet of GRADE_SETS) {
    for (const legs of LEG_COUNTS) {
      const tickets: EngineRow[] = [];
      for (const day of picksByDate) {
        const eligible = day.picks.filter(
          (pick) => !pick.void && allowed(pick.band, gradeSet.label)
        );
        if (eligible.length < legs) continue;

        const replay = eligible.map((pick) => ({
          ...pick.fixture,
          markets: [pick.market],
          allMarkets: undefined,
          status: 'Scheduled' as const,
          awaitingResult: false,
        }));
        const built = buildRecommendedAcca(replay, 1000, strategy, legs);
        if (built.length === 0) continue;
        const settlement = evaluateTicketSettlement(
          built,
          eligible.map((pick) => pick.fixture),
          1
        );
        const status = settlement.status;
        if (status !== 'Win' && status !== 'Lost' && status !== 'Void') continue;
        tickets.push({
          dateIso: day.dateIso,
          status,
          odds: settlement.effectiveOdds,
          legs: built.length,
        });
      }
      if (tickets.length > 0) {
        engineRows.push(summariseEngine(strategy, gradeSet.label, legs, tickets));
      }
      comboRows.push(summariseCombos(strategy, gradeSet.label, legs, picksByDate));
    }
  }
}

const results = {
  generatedAt: new Date().toISOString(),
  window: {
    first: slates[0]?.dateIso ?? null,
    last: slates[slates.length - 1]?.dateIso ?? null,
    matchdays: slates.length,
  },
  priceFilter: 'inferPriceQuality === prematch',
  stakePerTicket: 1,
  note:
    'Engine rows are one deterministic ticket per matchday. Combo rows aggregate every within-day combination and are descriptive because tickets overlap.',
  engineRows,
  comboRows,
};

const text = JSON.stringify(results, null, 2);
if (JSON_PATH) {
  fs.mkdirSync(path.dirname(path.resolve(JSON_PATH)), { recursive: true });
  fs.writeFileSync(path.resolve(JSON_PATH), text);
  console.log(`Wrote ${JSON_PATH}`);
} else {
  console.log(text);
}
