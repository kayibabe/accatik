import 'dotenv/config';
import type { AccaStrategy, Fixture } from '../src/types/fixtures.ts';
import type { AiDeskAccumulatorRecord } from '../server/lib/aiDeskArchive.ts';
import { SOURCE_LINKS } from '../server/api.ts';
import {
  AI_MODEL_VERSION,
  buildAiAccumulator,
  buildBriefing,
} from '../server/lib/aiBriefing.ts';
import {
  AI_DESK_BACKFILL_SUFFIX,
  aiAccumulatorConfigKey,
  recordAiBriefing,
} from '../server/lib/aiDeskArchive.ts';
import { attachFrameworkAssessments } from '../server/lib/frameworkAssessment.ts';
import { getFrameworkHistory } from '../server/lib/frameworkHistory.ts';
import { applyFrameworkSlateControls } from '../server/lib/frameworkSlate.ts';
import { getMarketCalibration } from '../server/lib/marketCalibration.ts';
import { computeCombinationRoi } from '../server/lib/combinationRoi.ts';
import { computePickAnalytics } from '../server/lib/pickAnalytics.ts';
import { buildQualifiedPicksResponse } from '../server/lib/qualifiedPicks.ts';
import { readRoiRegistry } from '../server/lib/roiRegistry.ts';
import {
  listArchivedSlateDates,
  readArchivedSlate,
} from '../server/lib/slateArchive.ts';
import { getLedgerSummary } from '../server/lib/ticketLedger.ts';
import { formatDisplayDate } from '../server/lib/time.ts';

/**
 * Replays the free AI Desk ensemble over every archived matchday.
 *
 * This is a reconstruction, not a time machine: prices, model output and final
 * scores come from the frozen slate archive, and framework evidence is capped
 * at the pre-kickoff decision time. Analytics, ROI registry and ledger are the
 * current workbench snapshots, and optional LLM narratives are not replayed.
 * Reconstructed snapshots carry a `+backfill` model-version suffix so they can
 * be separated from live captures in /api/ai/performance.
 *
 *   npm run ai:backfill
 *   npm run ai:backfill -- 2026-11-01 2026-11-30
 */
const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];
const RISK_MODES = ['conservative', 'balanced', 'aggressive'] as const;
const TARGET_ODDS = 2.8;
const MAX_LEGS = 3;
const MIN_SCORE = 60;
const BACKFILL_MODEL_VERSION = `${AI_MODEL_VERSION}${AI_DESK_BACKFILL_SUFFIX}`;

const args = process.argv.slice(2);
const isoDate = (value: string | undefined): string | undefined =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
const fromDateIso = isoDate(args[0]);
const toDateIso = isoDate(args[1]);

function decisionTimeFor(
  dateIso: string,
  capturedAt: string,
  fixtures: Fixture[]
): number {
  const kickoffs = fixtures
    .map((fixture) => fixture.kickoffTimestamp)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const captured = Date.parse(capturedAt);
  const candidates = [
    kickoffs.length > 0 ? Math.min(...kickoffs) - 2 * 60 * 60 * 1000 : Number.NaN,
    captured,
    Date.parse(`${dateIso}T12:00:00.000Z`),
  ].filter((value) => Number.isFinite(value));
  return candidates.length > 0 ? Math.min(...candidates) : Date.now();
}

/** Archived slates hold final scores; the ensemble needs the pre-match view. */
function asPrematch(fixture: Fixture): Fixture {
  const copy = structuredClone(fixture) as Fixture;
  return {
    ...copy,
    status: 'Scheduled',
    statusShort: 'NS',
    statusLong: undefined,
    awaitingResult: false,
    score: { home: null, away: null, halftimeHome: null, halftimeAway: null },
  };
}

async function main(): Promise<void> {
  const started = Date.now();
  const allDates = await listArchivedSlateDates();
  const dates = allDates.filter(
    (dateIso) =>
      (!fromDateIso || dateIso >= fromDateIso) &&
      (!toDateIso || dateIso <= toDateIso)
  );

  const [frameworkHistory, calibration, ledger] = await Promise.all([
    getFrameworkHistory(),
    getMarketCalibration(),
    getLedgerSummary(),
  ]);
  const workbench = await Promise.all(
    STRATEGIES.map(async (strategy) => ({
      strategy,
      analytics: await computePickAnalytics(strategy, true),
      combination: await computeCombinationRoi(strategy, true),
      registry: await readRoiRegistry(strategy),
    }))
  );

  let datesWritten = 0;
  let snapshotsWritten = 0;
  let picksWritten = 0;
  const failures: Array<{ dateIso: string; error: string }> = [];

  for (const dateIso of dates) {
    try {
      const slate = await readArchivedSlate(dateIso);
      if (!slate || slate.fixtures.length === 0) continue;
      const decisionMs = decisionTimeFor(dateIso, slate.capturedAt, slate.fixtures);
      const scope = {
        dateIso,
        strategy: 'balanced' as AccaStrategy,
        marketFilter: 'all',
        competitionFilter: 'all',
      };
      let wroteDate = false;

      for (const input of workbench) {
        try {
          const assessed = attachFrameworkAssessments(
            slate.fixtures.map(asPrematch),
            frameworkHistory,
            decisionMs,
            calibration
          );
          // Replay must not rewrite the durable framework decision log.
          const controlled = await applyFrameworkSlateControls(
            assessed,
            dateIso,
            decisionMs,
            false
          );
          const qualified = buildQualifiedPicksResponse(
            dateIso,
            controlled.fixtures,
            input.registry,
            input.strategy,
            decisionMs
          );
          const briefing = buildBriefing({
            fixtures: controlled.fixtures,
            dateIso,
            displayDate: formatDisplayDate(dateIso),
            strategy: input.strategy,
            marketFilter: 'all',
            competitionFilter: 'all',
            analytics: input.analytics,
            combination: input.combination,
            registry: input.registry,
            qualified,
            ledger,
            calibration,
            sources: SOURCE_LINKS(dateIso),
            narrativeProvider: null,
            narrativeNote:
              'Reconstructed from the archived pre-match slate. Optional language-model notes were not replayed.',
            nowMs: decisionMs,
          });
          if (briefing.picks.length === 0) continue;

          briefing.modelVersion = BACKFILL_MODEL_VERSION;
          const accumulators: AiDeskAccumulatorRecord[] = RISK_MODES.map((riskMode) => {
            const config = {
              riskMode,
              targetOdds: TARGET_ODDS,
              maxLegs: MAX_LEGS,
              minScore: MIN_SCORE,
            };
            const ticket = buildAiAccumulator({
              dateIso,
              picks: briefing.picks,
              targetOdds: config.targetOdds,
              maxLegs: config.maxLegs,
              riskMode: config.riskMode,
              minScore: config.minScore,
            });
            return {
              configKey: aiAccumulatorConfigKey(config),
              ...config,
              generatedAt: briefing.generatedAt,
              ticket: { ...ticket, minScore: config.minScore },
            };
          });

          await recordAiBriefing(
            { ...scope, strategy: input.strategy },
            briefing,
            Date.now(),
            accumulators
          );
          snapshotsWritten += 1;
          picksWritten += briefing.picks.length;
          wroteDate = true;
        } catch (error) {
          failures.push({
            dateIso: `${dateIso}/${input.strategy}`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (wroteDate) datesWritten += 1;
    } catch (error) {
      failures.push({
        dateIso,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    `[ai-backfill] ${datesWritten}/${dates.length} dates · ${snapshotsWritten} snapshots · ` +
      `${picksWritten} picks · ${failures.length} failures · ${Date.now() - started}ms`
  );
  if (failures.length > 0) {
    console.error('[ai-backfill] failures', failures);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[ai-backfill] unexpected failure', error);
  process.exitCode = 1;
});
