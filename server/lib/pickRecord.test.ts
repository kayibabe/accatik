import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import { computePickRecords } from './pickRecord.ts';

test('pick records settle archived picks from their frozen prices and final scores', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-records-'));
  const previous = process.env.MATCHSLIP_ARCHIVE_DIR;
  process.env.MATCHSLIP_ARCHIVE_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_ARCHIVE_DIR;
    else process.env.MATCHSLIP_ARCHIVE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const won = makeFixture({
    id: 'm1',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    recommendedPickId: 'm1-1x2-h',
    score: { home: 2, away: 1 },
    modelAdvice: 'Home Win',
    analystNoteMarketId: 'm1-1x2-h',
    markets: [
      makeMarket('m1-1x2-h', 2.0, '1X2', 'Alpha Win'),
      makeMarket('m1-1x2-a', 4.0, '1X2', 'Beta Win'),
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
    markets: [
      makeMarket('m2-1x2-h', 2.0, '1X2', 'Gamma Win'),
      makeMarket('m2-1x2-a', 4.0, '1X2', 'Delta Win'),
      makeMarket('m2-ou-15', 1.5, 'Goals', 'Over 1.5 Goals'),
    ],
  });

  await fs.writeFile(
    path.join(dir, '2026-01-02.json'),
    JSON.stringify({
      dateIso: '2026-01-02',
      capturedAt: '2026-01-02T10:00:00.000Z',
      updatedAt: '2026-01-02T22:00:00.000Z',
      fixtures: [won, lost],
    })
  );

  const result = await computePickRecords('high-yield');

  assert.equal(result.sampleDates, 1);
  assert.equal(result.sampleFixtures, 2);
  const [angle, cover, note] = result.records;
  assert.equal(angle.label, 'Recommended Angle');
  assert.deepEqual(
    { wins: angle.wins, losses: angle.losses, hitRate: angle.hitRate },
    { wins: 1, losses: 1, hitRate: 50 }
  );
  assert.equal(cover.wins, 2);
  assert.equal(note.wins, 2);
});

test('an archive with no finished priced fixtures reports empty records', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-records-'));
  const previous = process.env.MATCHSLIP_ARCHIVE_DIR;
  process.env.MATCHSLIP_ARCHIVE_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_ARCHIVE_DIR;
    else process.env.MATCHSLIP_ARCHIVE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });

  const result = await computePickRecords('favorites');
  assert.equal(result.sampleFixtures, 0);
  assert.ok(result.records.every((entry) => entry.hitRate === null));
});
