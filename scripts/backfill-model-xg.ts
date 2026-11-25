import 'dotenv/config';
import { promises as fs } from 'node:fs';
import type { Fixture } from '../src/types/fixtures.ts';
import {
  decisionLogDir,
  readDecisionFile,
} from '../server/lib/frameworkDecisionLog.ts';
import {
  listArchivedSlateDates,
  readArchivedSlate,
  writeArchivedSlate,
} from '../server/lib/slateArchive.ts';

/**
 * One-off migration: copies framework expected goals from the immutable
 * decision log onto archived slates, so settled matches keep showing the xG
 * projection the user saw before kickoff.
 *
 * The archive strips `fixture.framework`, but the decision log retains one
 * record per assessed market with its `model.lambdaHome/lambdaAway`. Records
 * are grouped by (date, fixtureId) and the latest `decidedAt` wins.
 *
 * Usage (stop the app server first):
 *   npx tsx scripts/backfill-model-xg.ts                 # dry run
 *   npx tsx scripts/backfill-model-xg.ts --write         # apply
 *   npx tsx scripts/backfill-model-xg.ts --date=2026-11-22 --write
 *   npx tsx scripts/backfill-model-xg.ts --write --force # replace existing xG
 *
 * Safe to re-run: fixtures that already carry model xG are left alone unless
 * --force is supplied. Only `modelXgHome` / `modelXgAway` are added; prices,
 * picks and results are untouched.
 */

interface ModelXg {
  home: number;
  away: number;
}

interface DecisionXg {
  xg: ModelXg;
  decidedAt: string;
  decisionId: string;
}

function usable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

async function listDecisionDates(): Promise<string[]> {
  try {
    const names = await fs.readdir(decisionLogDir());
    return names
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

async function collectModelXg(
  dates: string[]
): Promise<{ byFixture: Map<string, DecisionXg>; filesRead: number }> {
  const byFixture = new Map<string, DecisionXg>();
  let filesRead = 0;

  for (const dateIso of dates) {
    const file = await readDecisionFile(dateIso);
    if (!file) continue;
    filesRead += 1;

    for (const record of file.decisions) {
      const model = record.model;
      if (
        !model ||
        !usable(model.lambdaHome) ||
        !usable(model.lambdaAway)
      ) {
        continue;
      }

      const key = `${dateIso}:${record.fixtureId}`;
      const existing = byFixture.get(key);
      if (
        !existing ||
        record.decidedAt > existing.decidedAt ||
        (record.decidedAt === existing.decidedAt &&
          record.decisionId > existing.decisionId)
      ) {
        byFixture.set(key, {
          xg: { home: model.lambdaHome, away: model.lambdaAway },
          decidedAt: record.decidedAt,
          decisionId: record.decisionId,
        });
      }
    }
  }

  return { byFixture, filesRead };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const force = args.includes('--force');
  const dateArg = args.find((arg) => arg.startsWith('--date='));
  const onlyDate = dateArg?.slice('--date='.length);

  if (onlyDate && !/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) {
    throw new Error(`Invalid --date value: ${onlyDate}`);
  }
  if (write) {
    console.warn(
      '[backfill] writing archives. Stop the app server first so a cached slate cannot overwrite this migration.'
    );
  }

  const archiveDates = onlyDate
    ? [onlyDate]
    : await listArchivedSlateDates();
  const decisionDates = new Set(await listDecisionDates());
  const overlappingDates = archiveDates.filter((date) => decisionDates.has(date));
  const { byFixture, filesRead } = await collectModelXg(overlappingDates);

  let slatesScanned = 0;
  let slatesChanged = 0;
  let fixturesUpdated = 0;
  let alreadyPresent = 0;
  let noDecision = 0;
  const samples: Array<{ dateIso: string; fixtureId: string; home: number; away: number }> = [];

  for (const dateIso of archiveDates) {
    const slate = await readArchivedSlate(dateIso);
    if (!slate) continue;
    slatesScanned += 1;

    let changed = false;
    const fixtures: Fixture[] = slate.fixtures.map((fixture) => {
      if (
        !force &&
        usable(fixture.modelXgHome) &&
        usable(fixture.modelXgAway)
      ) {
        alreadyPresent += 1;
        return fixture;
      }

      const found = byFixture.get(`${dateIso}:${fixture.id}`);
      if (!found) {
        noDecision += 1;
        return fixture;
      }

      changed = true;
      fixturesUpdated += 1;
      if (samples.length < 5) {
        samples.push({
          dateIso,
          fixtureId: fixture.id,
          home: found.xg.home,
          away: found.xg.away,
        });
      }
      return {
        ...fixture,
        modelXgHome: found.xg.home,
        modelXgAway: found.xg.away,
      };
    });

    if (!changed) continue;
    slatesChanged += 1;
    if (write) {
      await writeArchivedSlate({ ...slate, fixtures });
      console.log(`[backfill] wrote ${dateIso}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? 'write' : 'dry-run',
        archiveDates: archiveDates.length,
        decisionFilesRead: filesRead,
        slatesScanned,
        slatesChanged,
        fixturesUpdated,
        alreadyPresent,
        noDecision,
        samples,
      },
      null,
      2
    )
  );

  if (!write && slatesChanged > 0) {
    console.log('Dry run only. Re-run with --write to apply these changes.');
  }
}

main().catch((error) => {
  console.error('[backfill] failed', error);
  process.exitCode = 1;
});
