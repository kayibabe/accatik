import 'dotenv/config';
import type { AccaStrategy } from '../src/types/fixtures.ts';
import { buildRoiAcca } from '../src/utils/roiAcca.ts';
import { runDailyRoiPromotion } from '../server/lib/roiRegistry.ts';
import { readArchivedSlate } from '../server/lib/slateArchive.ts';
import { recordRoiShadowTickets } from '../server/lib/ticketLedger.ts';
import { getTodayIsoDate } from '../server/lib/time.ts';

/**
 * Local daily ROI snapshot.
 *
 * Run after the slate prewarm so the newest matchday and its settled results
 * are already in the archive. Strategies run sequentially to keep the archive
 * reads and research writes deterministic.
 */
const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

async function main(): Promise<void> {
  const started = Date.now();
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
      console.log(`[roi-daily] ${strategy} promoted ${result.promotedKeys.length} rows`, result.transitions);

      if (archive) {
        const draft = buildRoiAcca(archive.fixtures, result.entries, strategy, {
          targetOdds: 5,
          maxLegs: 8,
        });
        if (draft.legs.length > 0) {
          const recorded = await recordRoiShadowTickets(today, archive.fixtures, [
            {
              strategy,
              label: `ROI research · ${draft.legs.length} legs`,
              targetOdds: draft.targetOdds,
              maxLegs: 8,
              legs: draft.legs,
            },
          ]);
          console.log(`[roi-daily] ${strategy} shadow ROI ticket`, recorded);
        }
      }
    } catch (error) {
      results.push({
        strategy,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`[roi-daily] ${strategy} failed`, error);
    }
  }

  const ok = results.every((result) => result.ok);
  console.log(JSON.stringify({ ok, tookMs: Date.now() - started, results }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[roi-daily] unexpected failure', error);
  process.exitCode = 1;
});
