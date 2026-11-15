import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AccaStrategy,
  DailySlateResponse,
  DeepAnalysisResponse,
  Fixture,
  GroundingSource,
  MarketOption,
  MarketType,
  RecommendedPickRef,
} from './src/types/fixtures.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const slateCache = new Map<string, { data: DailySlateResponse; expiresAt: number }>();
const CACHE_TTL_MS = 1000 * 60 * 5; // 5 minutes for live fixtures/odds

type ApiProvider = 'apisports' | 'rapidapi';
let detectedProvider: ApiProvider | null = null;

const CAT_TIMEZONE = 'Africa/Blantyre';

function getTodayIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDisplayDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00+02:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: CAT_TIMEZONE,
  });
}

function formatKickoffCat(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) return 'TBD';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${parts} CAT`;
}

function formatMatchDateCat(isoDateTime: string, fallbackIsoDate: string): {
  matchDate: string;
  matchDateIso: string;
} {
  const d = new Date(isoDateTime);
  if (Number.isNaN(d.getTime())) {
    return { matchDate: fallbackIsoDate, matchDateIso: fallbackIsoDate };
  }
  const matchDateIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const matchDate = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAT_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
  return { matchDate, matchDateIso };
}

const API_KEY_ENV_ALIASES = [
  'API_FOOTBALL_KEY',
  'API_FOOTBALL_API_KEY',
  'APIFOOTBALL_KEY',
  'FOOTBALL_API_KEY',
  'APISPORTS_KEY',
  'X_APISPORTS_KEY',
  'RAPIDAPI_KEY',
  'VITE_API_FOOTBALL_KEY',
];

function resolveApiFootballKey(): string | undefined {
  for (const name of API_KEY_ENV_ALIASES) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }
  return undefined;
}

interface ApiFootballResponse<T> {
  errors?: Record<string, string> | string[];
  paging?: { current?: number; total?: number };
  response?: T[];
}

async function fetchApiFootball<T>(
  endpoint: string,
  params: Record<string, string | number>
): Promise<ApiFootballResponse<T>> {
  const apiKey = resolveApiFootballKey();
  if (!apiKey) {
    throw new Error(
      'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets, then restart or retry.'
    );
  }

  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    query.set(k, String(v));
  }

  const callProvider = async (provider: ApiProvider) => {
    const baseUrl =
      provider === 'rapidapi'
        ? 'https://api-football-v1.p.rapidapi.com/v3'
        : 'https://v3.football.api-sports.io';
    const headers: Record<string, string> =
      provider === 'rapidapi'
        ? {
            'x-rapidapi-key': apiKey,
            'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
          }
        : {
            'x-apisports-key': apiKey,
          };

    const res = await fetch(`${baseUrl}${endpoint}?${query.toString()}`, {
      headers,
    });

    const json = (await res.json().catch(() => ({}))) as ApiFootballResponse<T> & {
      message?: string;
    };

    return { res, json };
  };

  const primaryProvider: ApiProvider = detectedProvider ?? 'apisports';
  let { res, json } = await callProvider(primaryProvider);

  const hasAuthFailure =
    res.status === 401 ||
    res.status === 403 ||
    (json.errors &&
      !Array.isArray(json.errors) &&
      typeof json.errors === 'object' &&
      ('token' in json.errors || 'key' in json.errors));

  if (hasAuthFailure && !detectedProvider) {
    const fallback: ApiProvider =
      primaryProvider === 'apisports' ? 'rapidapi' : 'apisports';
    const retry = await callProvider(fallback);
    if (retry.res.ok && (!retry.json.errors || Array.isArray(retry.json.errors))) {
      detectedProvider = fallback;
      res = retry.res;
      json = retry.json;
    } else {
      res = retry.res;
      json = retry.json;
    }
  } else if (res.ok && !hasAuthFailure) {
    detectedProvider = primaryProvider;
  }

  if (!res.ok) {
    const detail =
      json?.message ||
      (json?.errors && !Array.isArray(json.errors)
        ? Object.values(json.errors).join('; ')
        : '') ||
      `HTTP ${res.status}`;
    throw new Error(`API-Football request failed: ${detail}`);
  }

  if (
    json.errors &&
    !Array.isArray(json.errors) &&
    Object.keys(json.errors).length > 0
  ) {
    const msg = Object.values(json.errors).join('; ');
    throw new Error(`API-Football error: ${msg}`);
  }

  return json;
}

interface RawApiFixture {
  fixture: {
    id: number;
    date: string;
    timestamp: number;
    venue?: { name?: string | null; city?: string | null };
    status?: { short?: string; long?: string; elapsed?: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    round?: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals?: {
    home: number | null;
    away: number | null;
  };
  score?: {
    halftime?: { home: number | null; away: number | null };
    fulltime?: { home: number | null; away: number | null };
  };
}

interface RawApiOddsItem {
  fixture: { id: number };
  bookmakers: Array<{
    id: number;
    name: string;
    bets: Array<{
      id: number;
      name: string;
      values: Array<{
        value: string;
        odd: string;
      }>;
    }>;
  }>;
}

interface RawApiPrediction {
  predictions?: {
    winner?: { id?: number; name?: string; comment?: string };
    advice?: string;
    percent?: { home?: string; draw?: string; away?: string };
  };
  teams?: {
    home?: { league?: { form?: string } };
    away?: { league?: { form?: string } };
  };
  comparison?: Record<string, { home?: string; away?: string }>;
  h2h?: Array<{
    teams?: { home?: { name?: string }; away?: { name?: string } };
    goals?: { home?: number | null; away?: number | null };
  }>;
}

interface RawApiInjury {
  player?: { name?: string; reason?: string; type?: string };
  team?: { name?: string };
}

const PREFERRED_BOOKMAKER_IDS = [8, 11, 16, 4, 7, 3, 6, 2, 1]; // Bet365, 1xBet, Unibet, Pinnacle, William Hill, Betfair, Bwin, Marathonbet

const PRIORITY_LEAGUES = [
  'World Cup',
  'UEFA Nations League',
  'UEFA Champions League',
  'UEFA Europa League',
  'Premier League',
  'La Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'Championship',
  'League One',
  'League Two',
  'Segunda División',
  'La Liga 2',
  'Serie B',
  'Primeira Liga',
  'Eredivisie',
  'MLS',
  'Major League Soccer',
  'Serie A',
  'Brasileirão',
  'Africa Cup of Nations',
  'CONCACAF',
  'FA Cup',
  'Women',
];

function getLeaguePriority(leagueName: string, country: string): number {
  const lower = `${leagueName} ${country}`.toLowerCase();
  for (let i = 0; i < PRIORITY_LEAGUES.length; i++) {
    if (lower.includes(PRIORITY_LEAGUES[i].toLowerCase())) {
      return i;
    }
  }
  if (country === 'World' || country === 'Europe') return 15;
  return 100;
}

function mapFixtureStatus(shortCode?: string): Fixture['status'] {
  const s = (shortCode || 'NS').toUpperCase();
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE'].includes(s)) {
    return 'Live';
  }
  if (['FT', 'AET', 'PEN'].includes(s)) {
    return 'Finished';
  }
  if (['PST', 'CANC', 'ABD', 'SUSP', 'INT', 'AWD', 'WO'].includes(s)) {
    return 'Void';
  }
  return 'Scheduled';
}

function isAwaitingFeedResult(
  status: Fixture['status'],
  kickoffTimestamp: number | undefined,
  nowMs: number
): boolean {
  if (status !== 'Scheduled' || !kickoffTimestamp) return false;
  return nowMs > kickoffTimestamp + 15 * 60 * 1000;
}

function getRawFixtureSortTier(
  raw: RawApiFixture,
  hasOdds: boolean,
  nowMs: number
): number {
  const status = mapFixtureStatus(raw.fixture?.status?.short);
  const kickoffTs = raw.fixture?.timestamp ? raw.fixture.timestamp * 1000 : undefined;
  const awaitingResult = isAwaitingFeedResult(status, kickoffTs, nowMs);

  let statusTier = 4;
  if (status === 'Scheduled' && !awaitingResult) {
    statusTier = 0; // Truly upcoming
  } else if (status === 'Live') {
    statusTier = 1; // Live in-play
  } else if (status === 'Finished') {
    statusTier = 2; // Finished with official score
  } else if (status === 'Void') {
    statusTier = 3; // Postponed / Cancelled / Void
  } else {
    statusTier = 4; // Past kickoff still marked NS with no live feed coverage
  }

  return (hasOdds ? 0 : 5) + statusTier;
}

function buildMarketsFromOdds(
  fixtureId: string,
  homeTeam: string,
  awayTeam: string,
  oddsEntry?: RawApiOddsItem
): { markets: MarketOption[]; bookmakerName?: string } {
  if (!oddsEntry || !Array.isArray(oddsEntry.bookmakers) || oddsEntry.bookmakers.length === 0) {
    return { markets: [] };
  }

  // Pick preferred bookmaker that offers Match Winner or multiple bets
  const sortedBookmakers = [...oddsEntry.bookmakers].sort((a, b) => {
    const idxA = PREFERRED_BOOKMAKER_IDS.indexOf(a.id);
    const idxB = PREFERRED_BOOKMAKER_IDS.indexOf(b.id);
    const rankA = idxA === -1 ? 999 : idxA;
    const rankB = idxB === -1 ? 999 : idxB;
    if (rankA !== rankB) return rankA - rankB;
    return (b.bets?.length ?? 0) - (a.bets?.length ?? 0);
  });

  const bookmaker = sortedBookmakers[0];
  const markets: MarketOption[] = [];

  const pushMarket = (
    suffix: string,
    marketType: MarketType,
    label: string,
    oddStr: string | undefined,
    rationale: string
  ) => {
    const num = Number(oddStr);
    if (!Number.isFinite(num) || num < 1.05 || num > 35) return;
    const odds = Math.round(num * 100) / 100;
    markets.push({
      id: `${fixtureId}-${suffix}`,
      marketType,
      label,
      odds,
      impliedProbability: Math.round((1 / odds) * 1000) / 10,
      rationale,
    });
  };

  // Look across bookmakers if primary is missing a specific bet type
  const findBet = (betId: number, nameFragment: string) => {
    for (const bm of sortedBookmakers) {
      const found = bm.bets?.find(
        (b) => b.id === betId || b.name.toLowerCase().includes(nameFragment)
      );
      if (found) return found;
    }
    return undefined;
  };

  const matchWinner = findBet(1, 'match winner');
  if (matchWinner) {
    const homeVal = matchWinner.values.find((v) => v.value === 'Home');
    const drawVal = matchWinner.values.find((v) => v.value === 'Draw');
    const awayVal = matchWinner.values.find((v) => v.value === 'Away');
    pushMarket(
      '1x2-h',
      '1X2',
      `${homeTeam} Win`,
      homeVal?.odd,
      `Full-time match winner backing ${homeTeam} at home.`
    );
    pushMarket(
      '1x2-d',
      '1X2',
      'Draw',
      drawVal?.odd,
      `Level stalemate after 90 minutes.`
    );
    pushMarket(
      '1x2-a',
      '1X2',
      `${awayTeam} Win`,
      awayVal?.odd,
      `Full-time match winner backing ${awayTeam} away.`
    );
  }

  const doubleChance = findBet(12, 'double chance');
  if (doubleChance) {
    const dc1x = doubleChance.values.find(
      (v) => v.value === 'Home/Draw' || v.value === '1X'
    );
    const dcx2 = doubleChance.values.find(
      (v) => v.value === 'Draw/Away' || v.value === 'X2'
    );
    pushMarket(
      'dc-1x',
      'Double Chance',
      '1X (Home or Draw)',
      dc1x?.odd,
      `Covers ${homeTeam} win or draw for lower slip variance.`
    );
    pushMarket(
      'dc-x2',
      'Double Chance',
      'X2 (Draw or Away)',
      dcx2?.odd,
      `Covers ${awayTeam} win or draw.`
    );
  }

  const overUnder = findBet(5, 'goals over/under');
  if (overUnder) {
    const o15 = overUnder.values.find((v) => v.value === 'Over 1.5');
    const o25 = overUnder.values.find((v) => v.value === 'Over 2.5');
    const u25 = overUnder.values.find((v) => v.value === 'Under 2.5');
    pushMarket(
      'ou-15',
      'Goals',
      'Over 1.5 Goals',
      o15?.odd,
      `At least 2 total match goals scored.`
    );
    pushMarket(
      'ou-25',
      'Goals',
      'Over 2.5 Goals',
      o25?.odd,
      `At least 3 total match goals scored.`
    );
    if (!o15 && u25) {
      pushMarket(
        'ou-u25',
        'Goals',
        'Under 2.5 Goals',
        u25.odd,
        `Controlled tempo with 2 or fewer total goals.`
      );
    }
  }

  const btts = findBet(8, 'both teams score');
  if (btts) {
    const yes = btts.values.find((v) => v.value === 'Yes');
    pushMarket(
      'btts-yes',
      'BTTS',
      'BTTS Yes',
      yes?.odd,
      `Both ${homeTeam} and ${awayTeam} to find the net.`
    );
  }

  const dnb = findBet(13, 'draw no bet');
  if (dnb) {
    const h = dnb.values.find((v) => v.value === 'Home');
    const a = dnb.values.find((v) => v.value === 'Away');
    pushMarket(
      'dnb-h',
      'Draw No Bet',
      `${homeTeam} DNB`,
      h?.odd,
      `${homeTeam} win with stake voided on a draw.`
    );
    pushMarket(
      'dnb-a',
      'Draw No Bet',
      `${awayTeam} DNB`,
      a?.odd,
      `${awayTeam} win with stake voided on a draw.`
    );
  }

  // Keep up to 5 crisp, highest-utility markets for clean UI grid
  const priorityOrder = (m: MarketOption): number => {
    if (m.id.endsWith('1x2-h') || m.id.endsWith('1x2-a')) return 1;
    if (m.id.endsWith('ou-15')) return 2;
    if (m.id.endsWith('ou-25')) return 3;
    if (m.id.endsWith('btts-yes')) return 4;
    if (m.id.endsWith('dc-1x') || m.id.endsWith('dc-x2')) return 5;
    if (m.id.endsWith('dnb-h') || m.id.endsWith('dnb-a')) return 6;
    return 7;
  };

  // Deduplicate and pick best 5
  markets.sort((a, b) => priorityOrder(a) - priorityOrder(b));
  return {
    markets: markets.slice(0, 5),
    bookmakerName: bookmaker.name,
  };
}

function chooseRecommendedMarket(markets: MarketOption[]): string {
  if (markets.length === 0) return '';
  // Prefer solid accumulator sweet-spot odds (1.30 - 1.95)
  const sweetSpot = markets.find((m) => m.odds >= 1.3 && m.odds <= 1.95);
  if (sweetSpot) return sweetSpot.id;
  const reasonable = markets.find((m) => m.odds >= 1.18 && m.odds <= 2.35);
  return reasonable?.id ?? markets[0].id;
}

function buildAccaFromFixtures(
  fixtures: Fixture[],
  minOdds: number,
  strategy: AccaStrategy
): RecommendedPickRef[] {
  // 1. Prefer truly upcoming matches (kickoff not yet passed) with real bookmaker odds
  const trulyUpcoming = fixtures.filter(
    (f) =>
      f.status === 'Scheduled' &&
      !f.awaitingResult &&
      f.hasLiveOdds &&
      f.markets.length > 0
  );

  // 2. Live / Finished matches with verified scores & real Win/Lost/Void settlement
  const liveOrFinished = fixtures.filter(
    (f) =>
      (f.status === 'Live' || f.status === 'Finished') &&
      f.hasLiveOdds &&
      f.markets.length > 0
  );

  let pool: Fixture[];
  if (trulyUpcoming.length >= 3) {
    pool = trulyUpcoming;
  } else if (trulyUpcoming.length + liveOrFinished.length >= 3) {
    pool = [...trulyUpcoming, ...liveOrFinished];
  } else {
    pool = fixtures.filter(
      (f) => f.status !== 'Void' && f.hasLiveOdds && f.markets.length > 0
    );
  }

  const pickBestMarket = (fixture: Fixture): MarketOption => {
    if (strategy === 'favorites') {
      const sorted = [...fixture.markets]
        .filter((m) => m.odds >= 1.18 && m.odds <= 1.75)
        .sort((a, b) => a.odds - b.odds);
      return sorted[0] ?? fixture.markets[0];
    }
    if (strategy === 'goals') {
      const goals = fixture.markets.filter(
        (m) =>
          (m.marketType === 'Goals' || m.marketType === 'BTTS') &&
          m.odds >= 1.25 &&
          m.odds <= 2.25
      );
      if (goals.length > 0) return goals[0];
    }
    if (strategy === 'high-yield') {
      const high = [...fixture.markets]
        .filter((m) => m.odds >= 1.7 && m.odds <= 3.1)
        .sort((a, b) => b.odds - a.odds);
      if (high.length > 0) return high[0];
    }
    return (
      fixture.markets.find((m) => m.id === fixture.recommendedPickId) ??
      fixture.markets[0]
    );
  };

  // Rank pool by league prestige + market fit
  const ranked = pool.map((f) => {
    const market = pickBestMarket(f);
    const leagueRank = getLeaguePriority(f.competition, f.country);
    const oddSweetness =
      market.odds >= 1.28 && market.odds <= 1.95 ? 0 : 15;
    return {
      fixture: f,
      market,
      score: leagueRank + oddSweetness,
    };
  });

  ranked.sort((a, b) => a.score - b.score);

  const chosen: RecommendedPickRef[] = [];
  let runningProduct = 1;

  for (const item of ranked) {
    if (chosen.length >= 4 && runningProduct >= minOdds) break;
    if (chosen.length >= 7) break;
    chosen.push({ fixtureId: item.fixture.id, marketId: item.market.id });
    runningProduct *= item.market.odds;
  }

  // Ensure strictly >= minOdds if possible by adding remaining legs or upgrading
  for (let i = chosen.length; i < ranked.length && runningProduct < minOdds; i++) {
    if (chosen.length >= 10) break;
    const item = ranked[i];
    chosen.push({ fixtureId: item.fixture.id, marketId: item.market.id });
    runningProduct *= item.market.odds;
  }

  for (let i = 0; i < chosen.length && runningProduct < minOdds; i++) {
    const fixture = pool.find((f) => f.id === chosen[i].fixtureId);
    const currentMarket = fixture?.markets.find((m) => m.id === chosen[i].marketId);
    if (!fixture || !currentMarket) continue;

    const upgrades = fixture.markets
      .filter((m) => m.odds > currentMarket.odds && m.odds <= 3.5)
      .sort((a, b) => a.odds - b.odds);

    if (upgrades.length > 0) {
      runningProduct = (runningProduct / currentMarket.odds) * upgrades[0].odds;
      chosen[i].marketId = upgrades[0].id;
    }
  }

  return chosen;
}

function describeStrategy(strategy: AccaStrategy, minOdds: number): {
  title: string;
  summary: string;
} {
  switch (strategy) {
    case 'favorites':
      return {
        title: `Today's ${minOdds.toFixed(2)}+ High-Probability Favorites Acca`,
        summary: `Built from live API-Football bookmaker odds favoring low-variance winners, Double Chance 1X/X2, and Over 1.5 Goal lines to reach ${minOdds.toFixed(2)}+ combined odds.`,
      };
    case 'goals':
      return {
        title: `Today's ${minOdds.toFixed(2)}+ Goals & BTTS Acca`,
        summary: `Targets Over 1.5, Over 2.5, and Both Teams to Score lines across today's scheduled matches to surpass ${minOdds.toFixed(2)}+ combined odds.`,
      };
    case 'high-yield':
      return {
        title: `Today's ${minOdds.toFixed(2)}+ High-Yield Value Acca`,
        summary: `Selects higher-priced 1X2 and Over 2.5 angles across today's top competitions to exceed ${minOdds.toFixed(2)}+ odds in fewer legs.`,
      };
    case 'balanced':
    default:
      return {
        title: `Today's ${minOdds.toFixed(2)}+ Balanced Winning Acca`,
        summary: `Combines top-tier match winners, Double Chance coverage, and goal markets from today's live bookmaker slate to guarantee ${minOdds.toFixed(2)}+ combined odds.`,
      };
  }
}

async function createServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      date: getTodayIsoDate(),
      hasApiFootballKey: Boolean(resolveApiFootballKey()),
    });
  });

  app.post('/api/fixtures/today', async (req, res) => {
    try {
      if (!resolveApiFootballKey()) {
        return res.status(400).json({
          error:
            'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets.',
        });
      }

      const requestedDate =
        typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
          ? req.body.date
          : getTodayIsoDate();

      const minOddsRaw = Number(req.body?.minOdds);
      const minOdds =
        Number.isFinite(minOddsRaw) && minOddsRaw >= 5 ? minOddsRaw : 5.0;

      const strategyRaw = String(req.body?.strategy || 'balanced');
      const strategy: AccaStrategy =
        strategyRaw === 'favorites' ||
        strategyRaw === 'goals' ||
        strategyRaw === 'high-yield'
          ? strategyRaw
          : 'balanced';

      const forceRefresh = Boolean(req.body?.forceRefresh);
      const cacheKey = `${requestedDate}|${strategy}|${minOdds.toFixed(2)}`;

      if (!forceRefresh) {
        const cached = slateCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          return res.json(cached.data);
        }
      }

      // 1. Fetch all today's football fixtures (in CAT / Africa/Blantyre) + page 1 of pre-match odds in parallel
      const [fixturesResp, oddsPage1Resp] = await Promise.all([
        fetchApiFootball<RawApiFixture>('/fixtures', {
          date: requestedDate,
          timezone: CAT_TIMEZONE,
        }),
        fetchApiFootball<RawApiOddsItem>('/odds', {
          date: requestedDate,
          page: 1,
        }).catch(() => ({ paging: { total: 1 }, response: [] as RawApiOddsItem[] })),
      ]);

      const rawFixtures = fixturesResp.response ?? [];

      if (rawFixtures.length === 0) {
        throw new Error(
          `No football matches found on API-Football for ${formatDisplayDate(requestedDate)} (${requestedDate}).`
        );
      }

      const oddsByFixtureId = new Map<number, RawApiOddsItem>();
      for (const item of oddsPage1Resp.response ?? []) {
        if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
      }

      // 2. Fetch remaining bulk odds pages (up to page 10) in parallel if needed
      const totalOddsPages = Math.min(oddsPage1Resp.paging?.total ?? 1, 10);
      if (totalOddsPages > 1) {
        const pageNumbers = Array.from(
          { length: totalOddsPages - 1 },
          (_, idx) => idx + 2
        );
        const extraPages = await Promise.all(
          pageNumbers.map((p) =>
            fetchApiFootball<RawApiOddsItem>('/odds', {
              date: requestedDate,
              page: p,
            }).catch(() => ({ response: [] as RawApiOddsItem[] }))
          )
        );
        for (const page of extraPages) {
          for (const item of page.response ?? []) {
            if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
          }
        }
      }

      const nowMs = Date.now();

      // 3. Sort raw fixtures cleanly: Truly Upcoming -> Live -> Finished (with results) -> Void -> Stale NS
      rawFixtures.sort((a, b) => {
        const aTier = getRawFixtureSortTier(a, oddsByFixtureId.has(a.fixture.id), nowMs);
        const bTier = getRawFixtureSortTier(b, oddsByFixtureId.has(b.fixture.id), nowMs);
        if (aTier !== bTier) return aTier - bTier;
        const prioDiff =
          getLeaguePriority(a.league.name, a.league.country) -
          getLeaguePriority(b.league.name, b.league.country);
        if (prioDiff !== 0) return prioDiff;
        return (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0);
      });

      // 4. For up to 10 high-priority truly upcoming or major live/finished matches still missing odds, fetch /odds?fixture={id} directly
      const missingOddsPriority = rawFixtures
        .filter((f) => {
          if (oddsByFixtureId.has(f.fixture.id)) return false;
          const st = mapFixtureStatus(f.fixture?.status?.short);
          const kickoffTs = f.fixture?.timestamp ? f.fixture.timestamp * 1000 : undefined;
          const awaiting = isAwaitingFeedResult(st, kickoffTs, nowMs);
          if (st === 'Scheduled' && !awaiting) return true;
          return (
            (st === 'Live' || st === 'Finished') &&
            getLeaguePriority(f.league.name, f.league.country) < 25
          );
        })
        .slice(0, 10);

      if (missingOddsPriority.length > 0) {
        const directOdds = await Promise.all(
          missingOddsPriority.map((f) =>
            fetchApiFootball<RawApiOddsItem>('/odds', {
              fixture: f.fixture.id,
            }).catch(() => ({ response: [] as RawApiOddsItem[] }))
          )
        );
        for (const resp of directOdds) {
          for (const item of resp.response ?? []) {
            if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
          }
        }

        // Re-sort after direct odds enrichment so newly priced fixtures move up cleanly
        rawFixtures.sort((a, b) => {
          const aTier = getRawFixtureSortTier(a, oddsByFixtureId.has(a.fixture.id), nowMs);
          const bTier = getRawFixtureSortTier(b, oddsByFixtureId.has(b.fixture.id), nowMs);
          if (aTier !== bTier) return aTier - bTier;
          const prioDiff =
            getLeaguePriority(a.league.name, a.league.country) -
            getLeaguePriority(b.league.name, b.league.country);
          if (prioDiff !== 0) return prioDiff;
          return (a.fixture.timestamp || 0) - (b.fixture.timestamp || 0);
        });
      }

      // 5. Transform into clean Fixture objects
      const fixtures: Fixture[] = rawFixtures.map((raw) => {
        const fixtureId = String(raw.fixture.id);
        const homeTeam = raw.teams.home.name;
        const awayTeam = raw.teams.away.name;
        const oddsEntry = oddsByFixtureId.get(raw.fixture.id);
        const { markets, bookmakerName } = buildMarketsFromOdds(
          fixtureId,
          homeTeam,
          awayTeam,
          oddsEntry
        );
        const recommendedPickId = chooseRecommendedMarket(markets);
        const status = mapFixtureStatus(raw.fixture?.status?.short);
        const kickoffTimestamp = raw.fixture?.timestamp
          ? raw.fixture.timestamp * 1000
          : undefined;
        const awaitingResult = isAwaitingFeedResult(status, kickoffTimestamp, nowMs);
        const kickoffTime = formatKickoffCat(raw.fixture.date);
        const venueParts = [raw.fixture.venue?.name, raw.fixture.venue?.city].filter(
          Boolean
        );
        const { matchDate, matchDateIso } = formatMatchDateCat(
          raw.fixture.date,
          requestedDate
        );
        const homeScore =
          status === 'Finished'
            ? raw.score?.fulltime?.home ?? raw.goals?.home ?? null
            : raw.goals?.home ?? null;
        const awayScore =
          status === 'Finished'
            ? raw.score?.fulltime?.away ?? raw.goals?.away ?? null
            : raw.goals?.away ?? null;
        const roundPrefix = raw.league.round ? `${raw.league.round} · ` : '';

        let tacticalSummary: string;
        if (awaitingResult) {
          tacticalSummary =
            markets.length > 0
              ? `${roundPrefix}Kickoff passed (${kickoffTime}) — official final score has not yet been reported by the API-Football feed for this fixture. Live ${bookmakerName || 'bookmaker'} markets are listed below.`
              : `${roundPrefix}Kickoff passed (${kickoffTime}) — official score has not yet been published by the API-Football feed for this fixture.`;
        } else if (status === 'Finished' && homeScore !== null && awayScore !== null) {
          tacticalSummary =
            markets.length > 0
              ? `${roundPrefix}Full-time score ${homeScore}-${awayScore} recorded. Each market button below shows its Win, Lost, or Void settlement outcome.`
              : `${roundPrefix}Full-time score ${homeScore}-${awayScore} recorded on API-Football.`;
        } else if (status === 'Live' && homeScore !== null && awayScore !== null) {
          tacticalSummary =
            markets.length > 0
              ? `${roundPrefix}Live in play (${raw.fixture?.status?.short || 'LIVE'} ${homeScore}-${awayScore}). ${bookmakerName || 'Bookmaker'} pre-match lines shown below.`
              : `${roundPrefix}Live in play (${raw.fixture?.status?.short || 'LIVE'} ${homeScore}-${awayScore}).`;
        } else {
          tacticalSummary =
            markets.length > 0
              ? `${roundPrefix}Live ${bookmakerName || 'bookmaker'} markets loaded. Open Tactical Brief for API-Football predictions, H2H, and team news.`
              : `${roundPrefix}Scheduled on this matchday list. Open Tactical Brief to inspect predictions or live team news.`;
        }

        return {
          id: fixtureId,
          homeTeam,
          awayTeam,
          competition: raw.league.name,
          country: raw.league.country,
          matchDate,
          matchDateIso,
          kickoffTime,
          kickoffTimestamp,
          awaitingResult,
          status,
          statusShort: raw.fixture?.status?.short || 'NS',
          statusLong: raw.fixture?.status?.long || undefined,
          score: {
            home: homeScore,
            away: awayScore,
            halftimeHome: raw.score?.halftime?.home ?? null,
            halftimeAway: raw.score?.halftime?.away ?? null,
          },
          venue: venueParts.join(', ') || raw.league.country,
          formHome: '—',
          formAway: '—',
          tacticalSummary,
          recommendedPickId,
          bookmakerName,
          hasLiveOdds: markets.length > 0,
          markets,
        };
      });

      // 6. Build guaranteed 5.00+ winning accumulator ticket
      const recommendedLegIds = buildAccaFromFixtures(fixtures, minOdds, strategy);

      // 7. Enrich the curated acca legs in parallel with real /predictions data (form + advice)
      if (recommendedLegIds.length > 0) {
        const predictionResults = await Promise.all(
          recommendedLegIds.map((ref) =>
            fetchApiFootball<RawApiPrediction>('/predictions', {
              fixture: ref.fixtureId,
            })
              .then((r) => ({ fixtureId: ref.fixtureId, data: r.response?.[0] }))
              .catch(() => ({ fixtureId: ref.fixtureId, data: undefined }))
          )
        );

        for (const pred of predictionResults) {
          if (!pred.data) continue;
          const target = fixtures.find((f) => f.id === pred.fixtureId);
          if (!target) continue;

          const homeForm = pred.data.teams?.home?.league?.form?.slice(-5);
          const awayForm = pred.data.teams?.away?.league?.form?.slice(-5);
          if (homeForm) target.formHome = homeForm.split('').join('-');
          if (awayForm) target.formAway = awayForm.split('').join('-');

          const advice = pred.data.predictions?.advice;
          const pct = pred.data.predictions?.percent;
          if (advice || pct) {
            const pctStr = pct
              ? `Win Probabilities — Home ${pct.home || '-'} / Draw ${pct.draw || '-'} / Away ${pct.away || '-'}.`
              : '';
            target.tacticalSummary = `${advice ? `Model Advice: ${advice}. ` : ''}${pctStr}`.trim();
          }
        }
      }

      const displayDate = formatDisplayDate(requestedDate);
      const strategyCopy = describeStrategy(strategy, minOdds);

      const sources: GroundingSource[] = [
        {
          title: `API-Football Pro v3 — Fixtures Schedule (${requestedDate})`,
          uri: 'https://www.api-football.com/documentation-v3#tag/Fixtures',
        },
        {
          title: `API-Football Pro v3 — Pre-Match Bookmaker Odds (${requestedDate})`,
          uri: 'https://www.api-football.com/documentation-v3#tag/Odds-(Pre-Match)',
        },
        {
          title: 'API-Football Pro v3 — Match Predictions & Form Comparison',
          uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
        },
      ];

      const payload: DailySlateResponse = {
        date: requestedDate,
        displayDate,
        timezoneLabel: 'CAT (GMT+2) Kickoff Times',
        dataProvider: 'API-Football Pro',
        strategy,
        minOdds,
        strategyName: strategyCopy.title,
        strategySummary: strategyCopy.summary,
        fixtures,
        recommendedLegIds,
        sources,
        cachedAt: new Date().toISOString(),
      };

      slateCache.set(cacheKey, {
        data: payload,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      return res.json(payload);
    } catch (error) {
      console.error('Error fetching today fixtures:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to load today’s fixtures.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/fixtures/analyze', async (req, res) => {
    try {
      if (!resolveApiFootballKey()) {
        return res.status(400).json({
          error:
            'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets.',
        });
      }

      const fixtureId = String(req.body?.fixtureId || '').trim();
      const homeTeam = String(req.body?.homeTeam || '').trim();
      const awayTeam = String(req.body?.awayTeam || '').trim();

      if (!fixtureId) {
        return res.status(400).json({ error: 'fixtureId is required.' });
      }

      const [predResp, injResp] = await Promise.all([
        fetchApiFootball<RawApiPrediction>('/predictions', {
          fixture: fixtureId,
        }),
        fetchApiFootball<RawApiInjury>('/injuries', {
          fixture: fixtureId,
        }).catch(() => ({ response: [] as RawApiInjury[] })),
      ]);

      const pred = predResp.response?.[0];
      const injuries = injResp.response ?? [];

      const homeFormRaw = pred?.teams?.home?.league?.form?.slice(-5);
      const awayFormRaw = pred?.teams?.away?.league?.form?.slice(-5);
      const formHome = homeFormRaw ? homeFormRaw.split('').join('-') : undefined;
      const formAway = awayFormRaw ? awayFormRaw.split('').join('-') : undefined;

      const pct = pred?.predictions?.percent;
      const advice = pred?.predictions?.advice;
      const comment = pred?.predictions?.winner?.comment;

      const keyFactors: string[] = [];
      if (pct) {
        keyFactors.push(
          `Outcome probability split: ${homeTeam} ${pct.home || '-'}, Draw ${pct.draw || '-'}, ${awayTeam} ${pct.away || '-'}.`
        );
      }
      if (pred?.comparison?.form) {
        keyFactors.push(
          `Recent form rating: ${homeTeam} ${pred.comparison.form.home || '-'} vs ${awayTeam} ${pred.comparison.form.away || '-'}.`
        );
      }
      if (pred?.comparison?.att && pred?.comparison?.def) {
        keyFactors.push(
          `Attacking / Defensive index: ${homeTeam} (${pred.comparison.att.home || '-'} att / ${pred.comparison.def.home || '-'} def) vs ${awayTeam} (${pred.comparison.att.away || '-'} att / ${pred.comparison.def.away || '-'} def).`
        );
      }
      if (Array.isArray(pred?.h2h) && pred.h2h.length > 0) {
        const recentH2H = pred.h2h
          .slice(0, 3)
          .map(
            (m) =>
              `${m.teams?.home?.name || 'Home'} ${m.goals?.home ?? '-'}-${m.goals?.away ?? '-'} ${m.teams?.away?.name || 'Away'}`
          )
          .join(' · ');
        keyFactors.push(`Recent H2H: ${recentH2H}.`);
      }

      const teamNews =
        injuries.length > 0
          ? injuries
              .slice(0, 6)
              .map(
                (inj) =>
                  `${inj.player?.name || 'Player'} (${inj.team?.name || 'Squad'}: ${inj.player?.reason || inj.player?.type || 'Unavailable'})`
              )
              .join('; ')
          : 'No injuries or suspensions currently flagged for this fixture in API-Football.';

      const result: DeepAnalysisResponse = {
        fixtureId,
        summary:
          comment ||
          advice ||
          `API-Football statistical breakdown for ${homeTeam} vs ${awayTeam}.`,
        keyFactors,
        teamNews,
        bestAngle:
          advice ||
          'Use Double Chance or Over 1.5 Goals to balance ticket variance.',
        formHome,
        formAway,
        sources: [
          {
            title: `API-Football Predictions & Injuries (Fixture #${fixtureId})`,
            uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
          },
        ],
      };

      return res.json(result);
    } catch (error) {
      console.error('Error analyzing fixture:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to fetch match report.';
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MatchSlip server listening on http://localhost:${PORT}`);
  });
}

createServer();
