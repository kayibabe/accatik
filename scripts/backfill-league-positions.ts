import 'dotenv/config';
import { buildRecommendedAcca } from '../src/utils/accaEngine.ts';
import { getApiFootballLimits } from '../server/lib/apiFootball.ts';
import { getTodayIsoDate } from '../server/lib/time.ts';
import {
  readArchivedSlate,
  writeArchivedSlate,
} from '../server/lib/slateArchive.ts';
import {
  clearStandingsCache,
  enrichWithStandings,
} from '../server/lib/standings.ts';

/**
 * One-off helper to add league positions to an already archived matchday.
 *
 * The normal slate request does this automatically, but a server that was
 * running before the standings feature was added will not have populated its
 * cached/archive copy. Run this after stopping the app server:
 *
 *   npx tsx scripts/backfill-league-positions.ts
 *   npx tsx scripts/backfill-league-positions.ts --date=2026-11-25 --write
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const dateArg = args.find((arg) => arg.startsWith('--date='));
  const dateIso = dateArg?.slice('--date='.length) ?? getTodayIsoDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(`Invalid --date value: ${dateIso}`);
  }

  const slate = await readArchivedSlate(dateIso);
  if (!slate) throw new Error(`No archive found for ${dateIso}`);

  const fixtures = slate.fixtures.map((fixture) => ({ ...fixture }));
  const picked = new Set(
    buildRecommendedAcca(fixtures, 2.8, 'balanced', 3).map(
      (leg) => leg.fixtureId
    )
  );

  clearStandingsCache();
  await enrichWithStandings(fixtures, picked, true);

  const withPositions = fixtures.filter(
    (fixture) =>
      fixture.positionHome !== undefined || fixture.positionAway !== undefined
  );
  const sample = withPositions
    .filter((fixture) => fixture.homeTeam === 'Homeboyz')
    .map((fixture) => ({
      fixtureId: fixture.id,
      home: fixture.positionHome,
      away: fixture.positionAway,
    }));
  const pickedSample = fixtures
    .filter((fixture) => picked.has(fixture.id))
    .map((fixture) => ({
      fixtureId: fixture.id,
      match: `${fixture.homeTeam} vs ${fixture.awayTeam}`,
      home: fixture.positionHome,
      away: fixture.positionAway,
    }));

  console.log(
    JSON.stringify(
      {
        dateIso,
        mode: write ? 'write' : 'dry-run',
        quota: getApiFootballLimits(),
        fixtures: fixtures.length,
        withPositions: withPositions.length,
        sample,
        pickedSample,
      },
      null,
      2
    )
  );

  if (write && withPositions.length > 0) {
    await writeArchivedSlate({ ...slate, fixtures });
    console.log(`[standings] wrote ${dateIso}`);
  } else if (!write) {
    console.log('Dry run only. Re-run with --write to apply these changes.');
  }
}

main().catch((error) => {
  console.error('[standings] failed', error);
  process.exitCode = 1;
});
