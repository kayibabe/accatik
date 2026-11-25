import type {
  AiPerformanceResponse,
  AiPerformanceRow,
  AiPick,
} from '../../src/types/ai.ts';
import type { SettlementStatus } from '../../src/types/fixtures.ts';
import { evaluateMarketSettlement } from '../../src/utils/accaMath.ts';
import {
  isBackfilledModelVersion,
  listAiDeskDates,
  readAiDeskArchive,
} from './aiDeskArchive.ts';
import { readArchivedSlate, type ArchivedSlate } from './slateArchive.ts';

/**
 * Grades archived AI Desk picks against the settled slates already on disk.
 *
 * A single pick is counted once per matchday even if the desk was refreshed
 * several times: the newest snapshot wins. Void markets are reported but stay
 * out of the hit rate and ROI denominators; a flat one-unit stake is used so
 * ROI is comparable across score bands without staking-policy assumptions.
 */

export interface AiPerformanceQuery {
  fromDateIso?: string;
  toDateIso?: string;
  modelVersion?: string;
}

const SCORE_BANDS = [
  { key: 'score-90', label: '90–100', min: 90 },
  { key: 'score-80', label: '80–89', min: 80 },
  { key: 'score-70', label: '70–79', min: 70 },
  { key: 'score-60', label: '60–69', min: 60 },
  { key: 'score-00', label: 'Below 60', min: 0 },
] as const;

interface Tally {
  decided: number;
  wins: number;
  losses: number;
  voids: number;
  profitUnits: number;
  oddsSum: number;
  scoreSum: number;
}

const emptyTally = (): Tally => ({
  decided: 0,
  wins: 0,
  losses: 0,
  voids: 0,
  profitUnits: 0,
  oddsSum: 0,
  scoreSum: 0,
});

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function scoreBandKey(score: number): string {
  return (SCORE_BANDS.find((band) => score >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]).key;
}

function addPick(tally: Tally, pick: AiPick, status: SettlementStatus): void {
  if (status === 'Void') {
    tally.voids += 1;
    return;
  }
  if (status !== 'Win' && status !== 'Lost') return;

  tally.decided += 1;
  tally.oddsSum += pick.odds;
  tally.scoreSum += pick.aiScore;
  if (status === 'Win') {
    tally.wins += 1;
    tally.profitUnits += pick.odds;
  } else {
    tally.losses += 1;
    tally.profitUnits -= 1;
  }
}

function toRow(key: string, label: string, tally: Tally): AiPerformanceRow {
  return {
    key,
    label,
    settled: tally.decided,
    wins: tally.wins,
    losses: tally.losses,
    voids: tally.voids,
    hitRate:
      tally.decided > 0 ? round((tally.wins / tally.decided) * 100, 1) : null,
    roiPct:
      tally.decided > 0
        ? round((tally.profitUnits / tally.decided) * 100, 1)
        : null,
    profitUnits: round(tally.profitUnits, 2),
    avgOdds: tally.decided > 0 ? round(tally.oddsSum / tally.decided, 2) : null,
    avgAiScore: tally.decided > 0 ? round(tally.scoreSum / tally.decided, 1) : null,
  };
}

interface ArchivedPick {
  dateIso: string;
  generatedAt: string;
  pick: AiPick;
}

export async function computeAiPerformance(
  query: AiPerformanceQuery = {}
): Promise<AiPerformanceResponse> {
  const dates = (await listAiDeskDates()).filter(
    (dateIso) =>
      (!query.fromDateIso || dateIso >= query.fromDateIso) &&
      (!query.toDateIso || dateIso <= query.toDateIso)
  );

  const byPick = new Map<string, ArchivedPick>();
  let snapshots = 0;
  let reconstructed = 0;
  let archivedPicks = 0;

  for (const dateIso of dates) {
    const archive = await readAiDeskArchive(dateIso);
    if (!archive) continue;
    for (const snapshot of archive.snapshots) {
      if (
        query.modelVersion &&
        snapshot.modelVersion !== query.modelVersion
      ) {
        continue;
      }
      snapshots += 1;
      if (isBackfilledModelVersion(snapshot.modelVersion)) reconstructed += 1;
      archivedPicks += snapshot.picks.length;
      for (const pick of snapshot.picks) {
        const key = `${dateIso}|${pick.fixtureId}|${pick.marketId}`;
        const previous = byPick.get(key);
        if (!previous || snapshot.generatedAt > previous.generatedAt) {
          byPick.set(key, { dateIso, generatedAt: snapshot.generatedAt, pick });
        }
      }
    }
  }

  const overall = emptyTally();
  const bandTallies = new Map<string, Tally>(
    SCORE_BANDS.map((band) => [band.key, emptyTally()])
  );
  const slates = new Map<string, Promise<ArchivedSlate | null>>();
  let pending = 0;

  for (const entry of byPick.values()) {
    let slatePromise = slates.get(entry.dateIso);
    if (!slatePromise) {
      slatePromise = readArchivedSlate(entry.dateIso);
      slates.set(entry.dateIso, slatePromise);
    }
    const slate = await slatePromise;
    const fixture = slate?.fixtures.find((item) => item.id === entry.pick.fixtureId);
    if (!fixture) {
      pending += 1;
      continue;
    }

    const market = [...(fixture.allMarkets ?? []), ...fixture.markets].find(
      (item) => item.id === entry.pick.marketId
    );
    const status = evaluateMarketSettlement(
      fixture,
      market ?? {
        id: entry.pick.marketId,
        label: entry.pick.label,
        marketType: entry.pick.marketType,
      }
    );
    addPick(overall, entry.pick, status);
    const bandTally = bandTallies.get(scoreBandKey(entry.pick.aiScore));
    if (bandTally) addPick(bandTally, entry.pick, status);
    if (status === 'Pending' || status === 'Live') pending += 1;
  }

  const rows: AiPerformanceRow[] = [
    toRow('overall', 'All AI Desk picks', overall),
    ...SCORE_BANDS.map((band) =>
      toRow(band.key, `${band.label} model score`, bandTallies.get(band.key) ?? emptyTally())
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    fromDateIso: query.fromDateIso ?? null,
    toDateIso: query.toDateIso ?? null,
    modelVersion: query.modelVersion ?? null,
    sample: {
      snapshots,
      dates: dates.length,
      archivedPicks,
      dedupedPicks: byPick.size,
      settled: overall.decided,
      wins: overall.wins,
      losses: overall.losses,
      voids: overall.voids,
      pending,
      reconstructed,
    },
    rows,
  };
}
