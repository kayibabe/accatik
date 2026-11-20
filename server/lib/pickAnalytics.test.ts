import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import { computePickAnalytics } from './pickAnalytics.ts';

async function useArchiveDir(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-analytics-'));
  const previous = process.env.MATCHSLIP_ARCHIVE_DIR;
  process.env.MATCHSLIP_ARCHIVE_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_ARCHIVE_DIR;
    else process.env.MATCHSLIP_ARCHIVE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('pick analytics prices featured picks and individual markets at one flat unit', async (t) => {
  const dir = await useArchiveDir(t);

  const won = makeFixture({
    id: 'm1',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    recommendedPickId: 'm1-1x2-h',
    score: { home: 2, away: 1 },
    modelAdvice: 'Home Win',
    analystNoteMarketId: 'm1-1x2-h',
    priceQuality: 'prematch',
    markets: [
      makeMarket('m1-1x2-h', 2.0, '1X2', 'Alpha Win'),
      makeMarket('m1-ou-15', 1.5, 'Goals', 'Over 1.5 Goals'),
    ],
  });
  const lost = makeFixture({
    id: 'm2',
    homeTeam: 'Gamma',
    awayTeam: 'Delta',
    recommendedPickId: 'm2-1x2-h',
    score: { home: 1, away: 3 },
    modelAdvice: 'Over 1.5 Goals',
    analystNoteMarketId: 'm2-ou-15',
    priceQuality: 'live',
    markets: [
      makeMarket('m2-1x2-h', 2.0, '1X2', 'Gamma Win'),
      makeMarket('m2-ou-15', 1.5, 'Goals', 'Over 1.5 Goals'),
    ],
  });

  await fs.writeFile(
    path.join(dir, '2026-01-02.json'),
    JSON.stringify({
      dateIso: '2026-01-02',
      capturedAt: '2026-01-02T10:00:00.000Z',
      updatedAt: '2026-01-02T22:00:00.000Z',
      fixtures: [lost],
    })
  );
  await fs.writeFile(
    path.join(dir, '2026-01-01.json'),
    JSON.stringify({
      dateIso: '2026-01-01',
      capturedAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T22:00:00.000Z',
      fixtures: [won],
    })
  );

  const result = await computePickAnalytics('high-yield');

  assert.equal(result.sampleDates, 2);
  assert.equal(result.sampleFixtures, 2);
  assert.equal(result.marketPicks, 4);
  assert.equal(result.firstDateIso, '2026-01-01');
  assert.equal(result.lastDateIso, '2026-01-02');
  assert.deepEqual(result.priceQuality, { prematch: 2, live: 2, unknown: 0 });

  const [angle, cover, note] = result.featured;
  assert.deepEqual(
    {
      wins: angle.wins,
      losses: angle.losses,
      stake: angle.stake,
      returns: angle.returns,
      netPnl: angle.netPnl,
      roi: angle.roi,
    },
    { wins: 1, losses: 1, stake: 2, returns: 2, netPnl: 0, roi: 0 }
  );
  assert.deepEqual(
    {
      wins: cover.wins,
      hitRate: cover.hitRate,
      returns: cover.returns,
      netPnl: cover.netPnl,
      roi: cover.roi,
    },
    { wins: 2, hitRate: 100, returns: 3, netPnl: 1, roi: 50 }
  );
  assert.deepEqual(
    { netPnl: note.netPnl, roi: note.roi, avgOdds: note.avgOdds },
    { netPnl: 1.5, roi: 75, avgOdds: 1.75 }
  );

  assert.deepEqual(
    result.marketsByType.map((row) => [
      row.key,
      row.wins,
      row.losses,
      row.netPnl,
      row.roi,
    ]),
    [
      ['1X2', 1, 1, 0, 0],
      ['Goals', 2, 0, 1, 50],
    ]
  );

  assert.deepEqual(
    result.daily.map((day) => [
      day.dateIso,
      day.featuredNetPnl,
      day.marketNetPnl,
      day.cumulativeFeatured,
      day.cumulativeMarkets,
    ]),
    [
      ['2026-01-01', 2.5, 1.5, 2.5, 1.5],
      ['2026-01-02', 0, -0.5, 2.5, 1],
    ]
  );
});

test('void picks return their stake without entering hit rate or ROI', async (t) => {
  const dir = await useArchiveDir(t);

  const draw = makeFixture({
    id: 'v1',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    recommendedPickId: 'v1-dnb-h',
    score: { home: 1, away: 1 },
    priceQuality: 'prematch',
    markets: [makeMarket('v1-dnb-h', 2.0, 'Draw No Bet', 'Draw No Bet - Home')],
  });
  await fs.writeFile(
    path.join(dir, '2026-02-01.json'),
    JSON.stringify({
      dateIso: '2026-02-01',
      capturedAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T22:00:00.000Z',
      fixtures: [draw],
    })
  );

  const result = await computePickAnalytics('favorites');
  const [dnb] = result.marketsByType;

  assert.deepEqual(
    {
      settled: dnb.settled,
      voids: dnb.voids,
      hitRate: dnb.hitRate,
      stake: dnb.stake,
      returns: dnb.returns,
      netPnl: dnb.netPnl,
      roi: dnb.roi,
      avgOdds: dnb.avgOdds,
    },
    {
      settled: 1,
      voids: 1,
      hitRate: null,
      stake: 0,
      returns: 0,
      netPnl: 0,
      roi: null,
      avgOdds: null,
    }
  );
});
