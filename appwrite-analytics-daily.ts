import type { AccaStrategy } from './src/types/fixtures.ts';
import {
  computeCombinationRoi,
} from './server/lib/combinationRoi.ts';
import { computePickAnalytics } from './server/lib/pickAnalytics.ts';
import { refreshAnalyticsArchives } from './server/lib/analyticsRefresh.ts';
import {
  databasesFromHeaders,
  setDataDatabases,
} from './server/lib/appwriteData.ts';
import { DEFAULT_MAX_LEGS, DEFAULT_TARGET_ODDS } from './server/api.ts';
import { computeTicketAnalytics } from './server/lib/ticketAnalytics.ts';

/**
 * Scheduled daily refresh for every table on the analytics page.
 *
 * Runs after the slate prewarm (02:00/18:00 UTC) and the ROI promotion snapshot
 * (03:00 UTC), so finished results are already in the feed. It first merges any
 * results the feed published since the last slate visit, then warms the flat-
 * stake scans for every strategy. The site rebuilds from the durable archive on
 * demand, so warming is a latency optimisation rather than a second source of
 * truth. Appwrite cron is UTC: `0 4 * * *` is 06:00 CAT.
 */

const STRATEGIES: readonly AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

interface AppwriteRequest {
  headers?: Record<string, unknown>;
}

interface AppwriteResponse {
  json(
    body: unknown,
    statusCode?: number,
    headers?: Record<string, string>
  ): unknown;
}

interface AppwriteContext {
  req: AppwriteRequest;
  res: AppwriteResponse;
  log: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
}

export default async function main({
  req,
  res,
  log,
  error,
}: AppwriteContext): Promise<unknown> {
  const started = Date.now();
  try {
    setDataDatabases(databasesFromHeaders(req.headers));

    const refresh = await refreshAnalyticsArchives({
      lookbackDays: 14,
      maxDates: 7,
      force: true,
    });
    log('[analytics-daily] archive refresh', refresh);

    const warmed: string[] = [];
    for (const strategy of STRATEGIES) {
      const picks = await computePickAnalytics(strategy, true);
      const roi = await computeCombinationRoi(strategy, true);
      const tickets = await computeTicketAnalytics(
        strategy,
        DEFAULT_TARGET_ODDS,
        DEFAULT_MAX_LEGS,
        true
      );
      warmed.push(
        `${strategy}: ${picks.sampleDates} dates, ${picks.marketPicks} market picks, ${roi.rows.filter((row) => row.staked > 0).length} ROI cells, ${tickets.matchdays} replay days`
      );
    }

    const ok = refresh.errors.length === 0;
    return res.json(
      {
        ok,
        tookMs: Date.now() - started,
        refresh,
        warmed,
      },
      ok ? 200 : 207
    );
  } catch (err) {
    error('[analytics-daily] unexpected failure', err);
    return res.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Daily analytics refresh failed.',
      },
      500
    );
  }
}
