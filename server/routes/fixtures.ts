import { Router } from 'express';
import type { Request, Response } from 'express';
import type {
  DailySlateResponse,
  DeepAnalysisResponse,
  Fixture,
  GroundingSource,
  RecommendedPickRef,
} from '../../src/types/fixtures.ts';
import { buildRecommendedAcca } from '../../src/utils/accaEngine.ts';
import { describeStrategy, isAccaStrategy } from '../../src/utils/strategy.ts';
import type {
  RawApiFixture,
  RawApiInjury,
  RawApiOddsItem,
  RawApiPrediction,
} from '../lib/apiFootball.ts';
import { fetchApiFootball, resolveApiFootballKey } from '../lib/apiFootball.ts';
import { createSingleFlight, createTtlCache } from '../lib/cache.ts';
import {
  isSlateSettled,
  mergeArchivedPrices,
  readArchivedSlate,
  writeArchivedSlate,
} from '../lib/slateArchive.ts';
import {
  isAwaitingFeedResult,
  mapFixtureStatus,
  sortRawFixtures,
  toFixture,
} from '../lib/markets.ts';
import { CAT_TIMEZONE, formatDisplayDate, getTodayIsoDate } from '../lib/time.ts';

const SLATE_TTL_MS = 1000 * 60 * 5;
const PREDICTION_TTL_MS = 1000 * 60 * 30;
const ANALYSIS_TTL_MS = 1000 * 60 * 10;
const FIXTURE_INDEX_TTL_MS = 1000 * 60 * 60 * 6;

/** Raw slates are cached by date only: strategy and target odds never change the API payload. */
interface LoadedSlate {
  fixtures: Fixture[];
  capturedAt: string;
  source: 'live' | 'archive';
}

const slateCache = createTtlCache<LoadedSlate>(SLATE_TTL_MS, 60);
const predictionCache = createTtlCache<RawApiPrediction | null>(
  PREDICTION_TTL_MS,
  400
);
const analysisCache = createTtlCache<DeepAnalysisResponse>(ANALYSIS_TTL_MS, 200);
const fixtureIndex = createTtlCache<{
  homeTeam: string;
  awayTeam: string;
  competition: string;
}>(FIXTURE_INDEX_TTL_MS, 4000);

const slateFlight = createSingleFlight<LoadedSlate>();
const predictionFlight = createSingleFlight<RawApiPrediction | null>();

const MISSING_KEY_MESSAGE =
  'API_FOOTBALL_KEY is not configured. Please add your API-Football Pro key as API_FOOTBALL_KEY in Settings > Secrets.';

function hasApiKey(res: Response): boolean {
  if (resolveApiFootballKey()) return true;
  res.status(400).json({ error: MISSING_KEY_MESSAGE });
  return false;
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : fallback;
}

/** API-Football quotes model percentages as strings ("45%"). */
function parsePercent(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

async function fetchOddsForDate(
  dateIso: string
): Promise<Map<number, RawApiOddsItem>> {
  const oddsByFixtureId = new Map<number, RawApiOddsItem>();

  const firstPage = await fetchApiFootball<RawApiOddsItem>('/odds', {
    date: dateIso,
    page: 1,
  }).catch(() => ({ paging: { total: 1 }, response: [] as RawApiOddsItem[] }));

  for (const item of firstPage.response ?? []) {
    if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
  }

  const totalPages = Math.min(firstPage.paging?.total ?? 1, 10);
  if (totalPages > 1) {
    const pages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, idx) =>
        fetchApiFootball<RawApiOddsItem>('/odds', {
          date: dateIso,
          page: idx + 2,
        }).catch(() => ({ response: [] as RawApiOddsItem[] }))
      )
    );
    for (const page of pages) {
      for (const item of page.response ?? []) {
        if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
      }
    }
  }

  return oddsByFixtureId;
}

/**
 * The date-wide odds feed only covers so many pages; fill in the highest-value
 * fixtures that are still unpriced with a targeted /odds?fixture= call.
 */
async function enrichMissingOdds(
  rawFixtures: RawApiFixture[],
  oddsByFixtureId: Map<number, RawApiOddsItem>,
  nowMs: number
): Promise<void> {
  const missing = rawFixtures
    .filter((raw) => {
      if (oddsByFixtureId.has(raw.fixture.id)) return false;
      const status = mapFixtureStatus(raw.fixture?.status?.short);
      const kickoffTs = raw.fixture?.timestamp
        ? raw.fixture.timestamp * 1000
        : undefined;
      const awaiting = isAwaitingFeedResult(status, kickoffTs, nowMs);
      if (status === 'Scheduled' && !awaiting) return true;
      return status === 'Live' || status === 'Finished';
    })
    .slice(0, 10);

  if (missing.length === 0) return;

  const responses = await Promise.all(
    missing.map((raw) =>
      fetchApiFootball<RawApiOddsItem>('/odds', {
        fixture: raw.fixture.id,
      }).catch(() => ({ response: [] as RawApiOddsItem[] }))
    )
  );

  for (const response of responses) {
    for (const item of response.response ?? []) {
      if (item.fixture?.id) oddsByFixtureId.set(item.fixture.id, item);
    }
  }
}

async function buildSlate(dateIso: string): Promise<Fixture[]> {
  const [fixturesResp, oddsByFixtureId] = await Promise.all([
    fetchApiFootball<RawApiFixture>('/fixtures', {
      date: dateIso,
      timezone: CAT_TIMEZONE,
    }),
    fetchOddsForDate(dateIso),
  ]);

  const rawFixtures = fixturesResp.response ?? [];
  if (rawFixtures.length === 0) {
    throw new Error(
      `No football matches found on API-Football for ${formatDisplayDate(
        dateIso
      )} (${dateIso}).`
    );
  }

  const nowMs = Date.now();
  await enrichMissingOdds(rawFixtures, oddsByFixtureId, nowMs);

  const pricedIds = new Set(oddsByFixtureId.keys());
  const fixtures = sortRawFixtures(rawFixtures, pricedIds, nowMs).map((raw) =>
    toFixture(raw, oddsByFixtureId.get(raw.fixture.id), dateIso, nowMs)
  );

  indexFixtures(fixtures);
  return fixtures;
}

/** Remembers team names so /analyze works even for archived matchdays. */
function indexFixtures(fixtures: Fixture[]): void {
  for (const fixture of fixtures) {
    fixtureIndex.set(fixture.id, {
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: fixture.competition,
    });
  }
}

/**
 * Cache → archive → API, in that order.
 *
 * - A settled matchday is served from disk and never costs another API call.
 * - A requested-but-unsettled matchday refreshes results, but prices already
 *   archived for a kicked-off fixture are preserved.
 * - If the API fails, an archived slate is served instead of an error page.
 */
async function getSlate(dateIso: string): Promise<LoadedSlate> {
  const cached = slateCache.get(dateIso);
  if (cached) return cached;

  return slateFlight.run(dateIso, async () => {
    const archived = await readArchivedSlate(dateIso);
    const nowMs = Date.now();

    if (archived && isSlateSettled(archived.fixtures, nowMs)) {
      indexFixtures(archived.fixtures);
      const sealed: LoadedSlate = {
        fixtures: archived.fixtures,
        capturedAt: archived.capturedAt,
        source: 'archive',
      };
      slateCache.set(dateIso, sealed);
      return sealed;
    }

    let fixtures: Fixture[];
    try {
      const fresh = await buildSlate(dateIso);
      fixtures = archived
        ? mergeArchivedPrices(archived.fixtures, fresh)
        : fresh;
    } catch (error) {
      if (!archived) throw error;
      console.warn(
        `[slate] API-Football failed for ${dateIso}; serving the archive instead.`,
        error
      );
      indexFixtures(archived.fixtures);
      const fallback: LoadedSlate = {
        fixtures: archived.fixtures,
        capturedAt: archived.capturedAt,
        source: 'archive',
      };
      slateCache.set(dateIso, fallback);
      return fallback;
    }

    const capturedAt = archived?.capturedAt ?? new Date().toISOString();
    const pricedAt = new Date().toISOString();
    for (const fixture of fixtures) {
      // Scheduled prices keep moving; kicked-off prices are frozen with the
      // timestamp that belongs to them.
      if (
        fixture.markets.length > 0 &&
        (!fixture.pricedAt || fixture.status === 'Scheduled')
      ) {
        fixture.pricedAt = pricedAt;
      }
    }

    indexFixtures(fixtures);
    await writeArchivedSlate({
      dateIso,
      capturedAt,
      updatedAt: new Date().toISOString(),
      fixtures,
    }).catch((error) => {
      // A read-only disk must not take the app down.
      console.warn(`[slate] could not archive ${dateIso}`, error);
    });

    const loaded: LoadedSlate = {
      fixtures,
      capturedAt,
      source: 'live',
    };
    slateCache.set(dateIso, loaded);
    return loaded;
  });
}

async function fetchPrediction(fixtureId: string): Promise<RawApiPrediction | null> {
  const cached = predictionCache.get(fixtureId);
  if (cached !== undefined) return cached;

  return predictionFlight.run(fixtureId, async () => {
    const response = await fetchApiFootball<RawApiPrediction>('/predictions', {
      fixture: fixtureId,
    }).catch(() => null);

    const prediction = response?.response?.[0] ?? null;
    predictionCache.set(fixtureId, prediction);
    return prediction;
  });
}

/**
 * Attaches form and model advice to the curated legs. Works on the per-request
 * fixture copies so the cached slate is never mutated.
 */
async function enrichWithPredictions(
  fixtures: Fixture[],
  fixtureIds: string[]
): Promise<void> {
  const uniqueIds = [...new Set(fixtureIds)];
  if (uniqueIds.length === 0) return;

  const predictions = await Promise.all(
    uniqueIds.map(async (fixtureId) => ({
      fixtureId,
      data: await fetchPrediction(fixtureId),
    }))
  );

  for (const { fixtureId, data } of predictions) {
    if (!data) continue;
    const target = fixtures.find((fixture) => fixture.id === fixtureId);
    if (!target) continue;

    const homeForm = data.teams?.home?.league?.form?.slice(-5);
    const awayForm = data.teams?.away?.league?.form?.slice(-5);
    if (homeForm) target.formHome = homeForm.split('').join('-');
    if (awayForm) target.formAway = awayForm.split('').join('-');

    const advice = data.predictions?.advice;
    const pct = data.predictions?.percent;

    // Kept in their own fields: overwriting `tacticalSummary` made the seven
    // ticket fixtures read differently from the rest of the board.
    if (advice) target.modelAdvice = advice;
    if (pct) {
      target.modelProbabilities = {
        home: parsePercent(pct.home),
        draw: parsePercent(pct.draw),
        away: parsePercent(pct.away),
      };
    }
  }
}

const SOURCE_LINKS = (dateIso: string): GroundingSource[] => [
  {
    title: `API-Football Pro v3 — Fixtures Schedule (${dateIso})`,
    uri: 'https://www.api-football.com/documentation-v3#tag/Fixtures',
  },
  {
    title: `API-Football Pro v3 — Pre-Match Bookmaker Odds (${dateIso})`,
    uri: 'https://www.api-football.com/documentation-v3#tag/Odds-(Pre-Match)',
  },
  {
    title: 'API-Football Pro v3 — Match Predictions & Form Comparison',
    uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
  },
];

export const fixturesRouter = Router();

fixturesRouter.post('/today', async (req: Request, res: Response) => {
  if (!hasApiKey(res)) return;

  try {
    const requestedDate =
      typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
        ? req.body.date
        : getTodayIsoDate();

    const minOddsRaw = Number(req.body?.minOdds);
    const minOdds =
      Number.isFinite(minOddsRaw) && minOddsRaw >= 5 ? minOddsRaw : 5.0;

    const strategy = isAccaStrategy(req.body?.strategy)
      ? req.body.strategy
      : 'balanced';

    if (Boolean(req.body?.forceRefresh)) {
      slateCache.delete(requestedDate);
    }

    const loaded = await getSlate(requestedDate);
    // Shallow copies: prediction enrichment writes to these, not to the cache.
    const fixtures = loaded.fixtures.map((fixture) => ({ ...fixture }));

    const legs = buildRecommendedAcca(fixtures, minOdds, strategy, 7);

    // Sealed matchdays are served from disk with zero upstream calls, which
    // includes skipping the prediction feed: the match is already over.
    if (loaded.source === 'live') {
      await enrichWithPredictions(
        fixtures,
        legs.map((leg) => leg.fixtureId)
      );

      if (fixtures.some((f) => f.modelProbabilities || f.modelAdvice)) {
        await writeArchivedSlate({
          dateIso: requestedDate,
          capturedAt: loaded.capturedAt,
          updatedAt: new Date().toISOString(),
          fixtures,
        }).catch((error) => {
          console.warn(`[slate] could not archive models for ${requestedDate}`, error);
        });
      }
    }

    const recommendedLegIds: RecommendedPickRef[] = legs.map((leg) => ({
      fixtureId: leg.fixtureId,
      marketId: leg.marketId,
    }));

    const strategyCopy = describeStrategy(strategy, minOdds);

    const payload: DailySlateResponse = {
      date: requestedDate,
      displayDate: formatDisplayDate(requestedDate),
      timezoneLabel: 'CAT (GMT+2) Kickoff Times',
      dataProvider: 'API-Football Pro',
      strategy,
      minOdds,
      strategyName: strategyCopy.title,
      strategySummary: strategyCopy.summary,
      fixtures,
      recommendedLegIds,
      sources: SOURCE_LINKS(requestedDate),
      cachedAt: new Date().toISOString(),
      slateSource: loaded.source,
      capturedAt: loaded.capturedAt,
    };

    res.json(payload);
  } catch (error) {
    console.error('Error fetching today fixtures:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to load today’s fixtures.';
    res.status(500).json({ error: message });
  }
});

fixturesRouter.post('/analyze', async (req: Request, res: Response) => {
  if (!hasApiKey(res)) return;

  try {
    const fixtureId = String(req.body?.fixtureId || '').trim();
    if (!/^\d+$/.test(fixtureId)) {
      res.status(400).json({ error: 'fixtureId is required.' });
      return;
    }

    if (!Boolean(req.body?.forceRefresh)) {
      const cached = analysisCache.get(fixtureId);
      if (cached) {
        res.json(cached);
        return;
      }
    }

    // Prefer team names cached from the live slate; client-supplied labels are
    // only a fallback and are length-capped.
    const known = fixtureIndex.get(fixtureId);
    const homeTeam = known?.homeTeam ?? cleanLabel(req.body?.homeTeam, 'Home');
    const awayTeam = known?.awayTeam ?? cleanLabel(req.body?.awayTeam, 'Away');

    const [pred, injResp] = await Promise.all([
      fetchPrediction(fixtureId),
      fetchApiFootball<RawApiInjury>('/injuries', {
        fixture: fixtureId,
      }).catch(() => ({ response: [] as RawApiInjury[] })),
    ]);

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
        advice || 'Use Double Chance or Over 1.5 Goals to balance ticket variance.',
      formHome,
      formAway,
      sources: [
        {
          title: `API-Football Predictions & Injuries (Fixture #${fixtureId})`,
          uri: 'https://www.api-football.com/documentation-v3#tag/Predictions',
        },
      ],
    };

    analysisCache.set(fixtureId, result);
    res.json(result);
  } catch (error) {
    console.error('Error analyzing fixture:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to fetch match report.';
    res.status(500).json({ error: message });
  }
});
