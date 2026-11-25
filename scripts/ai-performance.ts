import 'dotenv/config';
import { computeAiPerformance } from '../server/lib/aiPerformance.ts';

/**
 * Offline report for the archived AI Desk history.
 *
 *   npm run ai:performance
 *   npm run ai:performance -- 2026-11-01 2026-11-30 ai-ensemble-1.0
 *   npm run ai:performance -- --from=2026-11-01 --to=2026-11-30
 *
 * The archive is written by normal AI Desk requests, so run this after the
 * matchdays in question have settled in the slate archive.
 */
const args = process.argv.slice(2);
const named = (flag: string): string | undefined => {
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};
const positional = args.filter((arg) => !arg.includes('='));
const isoDate = (value: string | undefined): string | undefined =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

const fromDateIso = isoDate(named('--from') ?? positional[0]);
const toDateIso = isoDate(named('--to') ?? positional[1]);
const modelVersion = named('--model') ?? positional[2];

async function main(): Promise<void> {
  const report = await computeAiPerformance({
    fromDateIso,
    toDateIso,
    modelVersion,
  });

  const { sample } = report;
  console.log(
    `[ai-performance] ${sample.dates} dates · ${sample.snapshots} snapshots · ` +
      `${sample.archivedPicks} archived picks · ${sample.dedupedPicks} graded picks · ` +
      `${sample.settled} settled · ${sample.pending} pending · ${sample.voids} void · ` +
      `${sample.reconstructed} reconstructed snapshots`
  );
  if (report.modelVersion) console.log(`[ai-performance] model ${report.modelVersion}`);

  console.table(
    report.rows.map((row) => ({
      Band: row.label,
      Settled: row.settled,
      Wins: row.wins,
      Losses: row.losses,
      'Hit rate': row.hitRate === null ? '—' : `${row.hitRate.toFixed(1)}%`,
      ROI: row.roiPct === null ? '—' : `${row.roiPct > 0 ? '+' : ''}${row.roiPct.toFixed(1)}%`,
      Profit: `${row.profitUnits > 0 ? '+' : ''}${row.profitUnits.toFixed(2)}u`,
      'Avg score': row.avgAiScore === null ? '—' : row.avgAiScore.toFixed(1),
    }))
  );
}

main().catch((error) => {
  console.error('[ai-performance] failed', error);
  process.exitCode = 1;
});
