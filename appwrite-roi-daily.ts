import type { AccaStrategy } from './src/types/fixtures.ts';
import { buildRoiAcca } from './src/utils/roiAcca.ts';
import { runDailyRoiPromotion } from './server/lib/roiRegistry.ts';
import { readArchivedSlate } from './server/lib/slateArchive.ts';
import { recordRoiShadowTickets } from './server/lib/ticketLedger.ts';
import { getTodayIsoDate } from './server/lib/time.ts';
import {
  databasesFromHeaders,
  setDataDatabases,
} from './server/lib/appwriteData.ts';

/**
 * Scheduled Appwrite Function entrypoint for the daily ROI snapshot.
 *
 * Runs after the 02:00/18:00 UTC slate prewarm so the newest matchday and its
 * settled results are already in the archive. Appwrite cron is UTC: the
 * configured `0 3 * * *` is 05:00 CAT, the recommended post-prewarm slot.
 * Strategies run sequentially to keep the archive reads and Appwrite writes
 * deterministic.
 */

const STRATEGIES: AccaStrategy[] = [
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

    const today = getTodayIsoDate();
    const archive = await readArchivedSlate(today);

    const results: Array<{
      strategy: AccaStrategy;
      ok: boolean;
      snapshotDateIso?: string;
      promoted?: number;
      transitions?: number;
      entries?: number;
      error?: string;
    }> = [];

    for (const strategy of STRATEGIES) {
      try {
        const result = await runDailyRoiPromotion(strategy);
        results.push({
          strategy,
          ok: true,
          snapshotDateIso: result.snapshotDateIso,
          promoted: result.promotedKeys.length,
          transitions: result.transitions.length,
          entries: result.entries.length,
        });
        log(`[roi-daily] ${strategy} promoted ${result.promotedKeys.length} rows`, result.transitions);

        if (archive) {
          const draft = buildRoiAcca(archive.fixtures, result.entries, strategy, {
            targetOdds: 5,
            maxLegs: 8,
          });
          if (draft.legs.length > 0) {
            const recorded = await recordRoiShadowTickets(
              today,
              archive.fixtures,
              [
                {
                  strategy,
                  label: `ROI research · ${draft.legs.length} legs`,
                  targetOdds: draft.targetOdds,
                  maxLegs: 8,
                  legs: draft.legs,
                },
              ]
            );
            log(`[roi-daily] ${strategy} shadow ROI ticket`, recorded);
          }
        }
      } catch (strategyError) {
        results.push({
          strategy,
          ok: false,
          error: strategyError instanceof Error ? strategyError.message : String(strategyError),
        });
        error(`[roi-daily] ${strategy} failed`, strategyError);
      }
    }

    const ok = results.every((result) => result.ok);
    return res.json(
      { ok, tookMs: Date.now() - started, results },
      ok ? 200 : 500
    );
  } catch (err) {
    error('[roi-daily] unexpected failure', err);
    return res.json(
      { ok: false, error: err instanceof Error ? err.message : 'ROI snapshot failed.' },
      500
    );
  }
}
