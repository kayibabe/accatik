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

test('selections use canonical keys and read the full priced ladder', async (t) => {
  const dir = await useArchiveDir(t);

  const first = makeFixture({
    id: 's1',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    score: { home: 3, away: 0 },
    recommendedPickId: 's1-1x2-h',
    priceQuality: 'prematch',
    markets: [makeMarket('s1-1x2-h', 2.0, '1X2', 'Alpha Win')],
    allMarkets: [
      makeMarket('s1-1x2-h', 2.0, '1X2', 'Alpha Win'),
      makeMarket('s1-ou-35', 2.5, 'Goals', 'Over 3.5 Goals'),
    ],
  });
  const second = makeFixture({
    id: 's2',
    homeTeam: 'Gamma',
    awayTeam: 'Delta',
    score: { home: 1, away: 0 },
    recommendedPickId: 's2-1x2-h',
    priceQuality: 'prematch',
    markets: [makeMarket('s2-1x2-h', 1.8, '1X2', 'Gamma Win')],
    allMarkets: [makeMarket('s2-1x2-h', 1.8, '1X2', 'Gamma Win')],
  });

  await fs.writeFile(
    path.join(dir, '2026-03-01.json'),
    JSON.stringify({
      dateIso: '2026-03-01',
      capturedAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T22:00:00.000Z',
      fixtures: [first, second],
    })
  );

  const result = await computePickAnalytics('balanced');

  // The 3.5 line is outside the board shortlist but still counted.
  assert.equal(result.marketPicks, 3);
  const home = result.marketsBySelection.find((row) => row.key === '1X2-H');
  assert.equal(home?.label, 'Home Win');
  assert.equal(home?.settled, 2);
  assert.ok(
    result.marketsBySelection.some((row) => row.key === 'GOALS-O3.5'),
    'the extra goal line gets its own row'
  );
  assert.equal(result.marketsByType[0].marketType, '1X2');
});

test('featured picks split by card and canonical selection', async (t) => {
  const dir = await useArchiveDir(t);

  const first = makeFixture({
    id: 'f1',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    recommendedPickId: 'f1-ou-25',
    score: { home: 3, away: 1 },
    modelAdvice: 'BTTS Yes',
    analystNoteMarketId: 'f1-btts-y',
    priceQuality: 'prematch',
    markets: [
      makeMarket('f1-ou-25', 2.2, 'Goals', 'Over 2.5 Goals'),
      makeMarket('f1-1x2-h', 1.5, '1X2', 'Home Win'),
      makeMarket('f1-btts-y', 1.9, 'BTTS', 'BTTS Yes'),
    ],
  });
  const second = makeFixture({
    id: 'f2',
    homeTeam: 'Gamma',
    awayTeam: 'Delta',
    recommendedPickId: 'f2-1x2-a',
    score: { home: 0, away: 0 },
    modelAdvice: 'BTTS No',
    analystNoteMarketId: 'f2-btts-n',
    priceQuality: 'prematch',
    markets: [
      makeMarket('f2-1x2-a', 2.4, '1X2', 'Away Win'),
      makeMarket('f2-ou-u25', 1.7, 'Goals', 'Under 2.5 Goals'),
      makeMarket('f2-btts-n', 1.8, 'BTTS', 'BTTS No'),
    ],
  });

  await fs.writeFile(
    path.join(dir, '2026-04-01.json'),
    JSON.stringify({
      dateIso: '2026-04-01',
      capturedAt: '2026-04-01T10:00:00.000Z',
      updatedAt: '2026-04-01T22:00:00.000Z',
      fixtures: [first, second],
    })
  );

  const result = await computePickAnalytics('balanced', true);

  // Card first, then the same 1X2 / Goals / BTTS order as the market table.
  assert.deepEqual(
    result.featuredBySelection.map((row) => [
      row.source,
      row.selectionKey,
      row.marketType,
      row.label,
      row.wins,
      row.losses,
    ]),
    [
      ['angle', '1X2-A', '1X2', 'Away Win', 0, 1],
      ['angle', 'GOALS-O2.5', 'Goals', 'Over 2.5 Goals', 1, 0],
      ['cover', '1X2-H', '1X2', 'Home Win', 1, 0],
      ['cover', 'GOALS-U2.5', 'Goals', 'Under 2.5 Goals', 1, 0],
      ['note', 'BTTS-YES', 'BTTS', 'BTTS Yes', 1, 0],
      ['note', 'BTTS-NO', 'BTTS', 'BTTS No', 1, 0],
    ]
  );

  // Each card's children add up to its existing roll-up row.
  const sources = ['angle', 'cover', 'note'] as const;
  for (const [index, source] of sources.entries()) {
    const rows = result.featuredBySelection.filter((row) => row.source === source);
    assert.equal(
      rows.reduce((sum, row) => sum + row.settled, 0),
      result.featured[index].settled
    );
    assert.equal(
      Math.round(rows.reduce((sum, row) => sum + row.netPnl, 0) * 100) / 100,
      result.featured[index].netPnl
    );
  }
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
    result.featuredBySelection.map((row) => [
      row.source,
      row.selectionKey,
      row.marketType,
      row.voids,
    ]),
    [['angle', 'DNB-1', 'Draw No Bet', 1]]
  );

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
