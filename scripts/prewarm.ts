import 'dotenv/config';
import { prewarmSlate } from '../server/api.ts';
import { addDaysToIsoDate, getTodayIsoDate } from '../server/lib/time.ts';

/**
 * Local slate prewarm.
 *
 * Warms today's and tomorrow's matchdays so the first UI request is an archive
 * read rather than a full API-Football build. The two dates are warmed
 * sequentially on purpose: a cold build is expensive and the two should not
 * compete for the same upstream quota.
 */
async function main(): Promise<void> {
  const started = Date.now();
  const today = getTodayIsoDate();
  const dates = [today, addDaysToIsoDate(today, 1)];
  const results: Array<{ dateIso: string; status: number; body: unknown }> = [];

  for (const dateIso of dates) {
    const result = await prewarmSlate(dateIso);
    results.push({ dateIso, status: result.status, body: result.body });
    if (result.status >= 400) {
      console.error(`[prewarm] ${dateIso} failed`, result.body);
    } else {
      console.log(`[prewarm] ${dateIso} ready`, result.body);
    }
  }

  const ok = results.every((result) => result.status < 400);
  console.log(JSON.stringify({ ok, tookMs: Date.now() - started, results }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[prewarm] unexpected failure', error);
  process.exitCode = 1;
});
