import 'dotenv/config';
import type { AccaStrategy } from '../src/types/fixtures.ts';
import { computeCombinationRoi } from '../server/lib/combinationRoi.ts';
import { computePickAnalytics } from '../server/lib/pickAnalytics.ts';
import { refreshAnalyticsArchives } from '../server/lib/analyticsRefresh.ts';
import { DEFAULT_MAX_LEGS, DEFAULT_TARGET_ODDS } from '../server/api.ts';
import { computeTicketAnalytics } from '../server/lib/ticketAnalytics.ts';

/**
 * Local daily analytics refresh.
 *
 * Run after the slate prewarm and ROI snapshot so finished results are already
 * in the feed. Merges any results published since the last slate visit, then
 * warms the flat-stake scans for every strategy. The site rebuilds from the
 * durable archive on demand, so this is a latency optimisation rather than a
 * second source of truth.
 */
const STRATEGIES: readonly AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];

async function main(): Promise<void> {
  const started = Date.now();
  const refresh = await refreshAnalyticsArchives({
    lookbackDays: 14,
    maxDates: 7,
    force: true,
  });
  console.log('[analytics-daily] archive refresh', refresh);

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
  console.log(JSON.stringify({ ok, tookMs: Date.now() - started, refresh, warmed }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[analytics-daily] unexpected failure', error);
  process.exitCode = 1;
});
