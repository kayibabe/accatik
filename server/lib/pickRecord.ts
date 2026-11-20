import type {
  AccaStrategy,
  Fixture,
  PickRecordEntry,
  PickRecordsResponse,
  SettlementStatus,
} from '../../src/types/fixtures.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import { resolveAnalystNoteMarket } from '../../src/utils/analystNote.ts';
import { buildRecommendedAngle } from '../../src/utils/recommendedAngle.ts';
import { createTtlCache } from './cache.ts';
import { listArchivedSlateDates, readArchivedSlate } from './slateArchive.ts';

/**
 * Hit rates for the three per-match picks shown on the board.
 *
 * Every archived slate keeps its prices and its final score, so the pick can be
 * rebuilt with the *current* strategy and settled from the score that actually
 * happened. Void picks are reported but excluded from the hit rate.
 */
const MAX_SAMPLE_DATES = 30;
const RECORD_TTL_MS = 10 * 60 * 1000;

type Tally = Pick<PickRecordEntry, 'settled' | 'wins' | 'losses' | 'voids'>;

const emptyTally = (): Tally => ({ settled: 0, wins: 0, losses: 0, voids: 0 });

function record(tally: Tally, status: SettlementStatus): void {
  tally.settled += 1;
  if (status === 'Win') tally.wins += 1;
  else if (status === 'Lost') tally.losses += 1;
  else if (status === 'Void') tally.voids += 1;
}

function toEntry(
  key: PickRecordEntry['key'],
  label: string,
  tally: Tally
): PickRecordEntry {
  const decided = tally.wins + tally.losses;
  return {
    key,
    label,
    ...tally,
    hitRate: decided > 0 ? Math.round((tally.wins / decided) * 1000) / 10 : null,
  };
}

function sampleFixture(fixture: Fixture): boolean {
  return (
    fixture.status === 'Finished' &&
    fixture.markets.length > 0 &&
    fixture.score?.home !== null &&
    fixture.score?.home !== undefined &&
    fixture.score?.away !== null &&
    fixture.score?.away !== undefined
  );
}

const cache = createTtlCache<PickRecordsResponse>(RECORD_TTL_MS, 8);

export async function computePickRecords(
  strategy: AccaStrategy
): Promise<PickRecordsResponse> {
  const cached = cache.get(strategy);
  if (cached) return cached;

  const dates = (await listArchivedSlateDates()).slice(0, MAX_SAMPLE_DATES);
  const angle = emptyTally();
  const cover = emptyTally();
  const note = emptyTally();
  let sampleDates = 0;
  let sampleFixtures = 0;

  for (const dateIso of dates) {
    const slate = await readArchivedSlate(dateIso);
    if (!slate) continue;

    let usedDate = false;
    for (const fixture of slate.fixtures) {
      if (!sampleFixture(fixture)) continue;
      const recommended = buildRecommendedAngle(fixture, strategy);
      if (!recommended) continue;

      sampleFixtures += 1;
      usedDate = true;
      record(angle, evaluateMarketSettlement(fixture, recommended.market));
      if (recommended.cover) {
        record(cover, evaluateMarketSettlement(fixture, recommended.cover));
      }
      const noteMarket = resolveAnalystNoteMarket(fixture, fixture.modelAdvice);
      if (noteMarket) {
        record(note, evaluateMarketSettlement(fixture, noteMarket));
      }
    }
    if (usedDate) sampleDates += 1;
  }

  const result: PickRecordsResponse = {
    strategy,
    sampleDates,
    sampleFixtures,
    records: [
      toEntry('angle', 'Recommended Angle', angle),
      toEntry('cover', 'Safer cover', cover),
      toEntry('note', 'Analyst note', note),
    ],
    generatedAt: new Date().toISOString(),
  };
  cache.set(strategy, result);
  return result;
}
