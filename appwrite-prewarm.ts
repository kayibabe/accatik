import { prewarmSlate } from './server/api.ts';
import {
  databasesFromHeaders,
  setDataDatabases,
} from './server/lib/appwriteData.ts';
import { addDaysToIsoDate, getTodayIsoDate } from './server/lib/time.ts';

/**
 * Scheduled Appwrite Function entrypoint.
 *
 * Warm today's and tomorrow's matchdays before people open the app, so the
 * first request is an archive read rather than a ~20-call API-Football build.
 * The two dates are warmed sequentially on purpose: a cold build is expensive
 * and the two should not compete for the same upstream quota. Appwrite cron is
 * UTC, so the configured 02:00/18:00 runs are 04:00/20:00 CAT.
 */

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
    // Scheduled executions do not go through the HTTP API handler, so wire the
    // data layer here as well. databasesFromHeaders falls back to the function's
    // APPWRITE_API_KEY secret when no per-execution key is present.
    setDataDatabases(databasesFromHeaders(req.headers));

    const today = getTodayIsoDate();
    const dates = [today, addDaysToIsoDate(today, 1)];
    const results: Array<{ dateIso: string; status: number; body: unknown }> = [];

    for (const dateIso of dates) {
      const result = await prewarmSlate(dateIso);
      results.push({ dateIso, status: result.status, body: result.body });
      if (result.status >= 400) {
        error(`[prewarm] ${dateIso} failed`, result.body);
      } else {
        log(`[prewarm] ${dateIso} ready`, result.body);
      }
    }

    const ok = results.every((result) => result.status < 400);
    return res.json(
      { ok, tookMs: Date.now() - started, results },
      ok ? 200 : 500
    );
  } catch (err) {
    error('[prewarm] unexpected failure', err);
    return res.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Prewarm failed.',
      },
      500
    );
  }
}
