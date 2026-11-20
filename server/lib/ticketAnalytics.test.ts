import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';
import type { TicketReplayDay, TicketVariantConfig } from '../../src/types/analytics.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import { normalizeTicketControls } from '../../src/utils/ticketControls.ts';
import {
  computeTicketAnalytics,
  summarizeTicketReplay,
} from './ticketAnalytics.ts';

async function useArchiveDir(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'matchslip-ticket-replay-'));
  const previous = process.env.MATCHSLIP_ARCHIVE_DIR;
  process.env.MATCHSLIP_ARCHIVE_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.MATCHSLIP_ARCHIVE_DIR;
    else process.env.MATCHSLIP_ARCHIVE_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

function winningFixture(id: string, dateIso: string): Fixture {
  return makeFixture({
    id,
    matchDateIso: dateIso,
    recommendedPickId: `${id}-1x2-h`,
    priceQuality: 'prematch',
    score: { home: 2, away: 0 },
    markets: [makeMarket(`${id}-1x2-h`, 2, '1X2', 'Home Win')],
  });
}

const variant: TicketVariantConfig = {
  id: 'test',
  group: 'shape',
  label: 'Test shape',
  strategy: 'balanced',
  targetOdds: 2.8,
  maxLegs: 3,
};

test('ticket replay summarises flat-stake results, voids and streaks', () => {
  const days: TicketReplayDay[] = [
    { dateIso: '2026-01-01', status: 'Win', legs: 2, odds: 4, targetMet: true },
    { dateIso: '2026-01-02', status: 'Lost', legs: 2, odds: 3.5, targetMet: true },
    { dateIso: '2026-01-03', status: 'Lost', legs: 3, odds: 5, targetMet: true },
    { dateIso: '2026-01-04', status: 'Void', legs: 2, odds: 3, targetMet: true },
    { dateIso: '2026-01-05', status: 'Win', legs: 2, odds: 3.2, targetMet: true },
  ];
  const summary = summarizeTicketReplay(days, variant);

  assert.deepEqual(
    {
      tickets: summary.tickets,
      wins: summary.wins,
      losses: summary.losses,
      voids: summary.voids,
      hitRate: summary.hitRate,
      targetHitRate: summary.targetHitRate,
      roi: summary.roi,
      netPnl: summary.netPnl,
      avgLegs: summary.avgLegs,
      longestLossStreak: summary.longestLossStreak,
      firstDateIso: summary.firstDateIso,
      lastDateIso: summary.lastDateIso,
    },
    {
      tickets: 5,
      wins: 2,
      losses: 2,
      voids: 1,
      hitRate: 50,
      targetHitRate: 100,
      roi: 80,
      netPnl: 3.2,
      avgLegs: 2.3,
      longestLossStreak: 2,
      firstDateIso: '2026-01-01',
      lastDateIso: '2026-01-05',
    }
  );
  // Peak equity after the first win is 3u; the two losses take it to 1u.
  assert.equal(summary.maxDrawdown, 2);
  assert.equal(summary.avgOdds, 3.93);
  assert.equal(summary.breakEvenHitRate, 25.4);
});

test('ticket replay rebuilds each slip control from clean pre-match archives', async (t) => {
  const dir = await useArchiveDir(t);

  for (const dateIso of ['2026-01-01', '2026-01-02']) {
    const fixtures = [
      winningFixture(`${dateIso}-a`, dateIso),
      winningFixture(`${dateIso}-b`, dateIso),
      winningFixture(`${dateIso}-c`, dateIso),
      winningFixture(`${dateIso}-d`, dateIso),
      makeFixture({
        id: `${dateIso}-live`,
        matchDateIso: dateIso,
        recommendedPickId: `${dateIso}-live-1x2-h`,
        priceQuality: 'live',
        score: { home: 3, away: 0 },
        markets: [makeMarket(`${dateIso}-live-1x2-h`, 1.8, '1X2', 'Home Win')],
      }),
    ];
    await fs.writeFile(
      path.join(dir, `${dateIso}.json`),
      JSON.stringify({
        dateIso,
        capturedAt: `${dateIso}T10:00:00.000Z`,
        updatedAt: `${dateIso}T22:00:00.000Z`,
        fixtures,
      })
    );
  }

  const result = await computeTicketAnalytics('balanced', 2.8, 3);

  assert.equal(result.matchdays, 2);
  assert.equal(result.firstDateIso, '2026-01-01');
  assert.equal(result.lastDateIso, '2026-01-02');
  assert.equal(result.pricedFixtures, 8);
  assert.equal(result.excludedFixtures, 2);
  assert.equal(result.shapes.length, 4);
  assert.equal(result.strategies.length, 5);
  assert.equal(result.odds.length, 5);
  assert.equal(result.legs.length, 2);
  assert.ok(result.current);

  const balanced = result.shapes.find((row) => row.id === 'shape:balanced');
  assert.ok(balanced);
  assert.deepEqual(
    {
      tickets: balanced.summary.tickets,
      wins: balanced.summary.wins,
      losses: balanced.summary.losses,
      hitRate: balanced.summary.hitRate,
      targetHitRate: balanced.summary.targetHitRate,
      avgOdds: balanced.summary.avgOdds,
      avgLegs: balanced.summary.avgLegs,
    },
    {
      tickets: 2,
      wins: 2,
      losses: 0,
      hitRate: 100,
      targetHitRate: 100,
      avgOdds: 4,
      avgLegs: 2,
    }
  );
  assert.deepEqual(
    balanced.daily.map((day) => day.dateIso),
    ['2026-01-01', '2026-01-02']
  );

  // An 8.00+ target needs all three 2.00 legs here, and the builder must not
  // add a fourth just to clear the headline price.
  const longshot = result.odds.find((row) => row.id === 'odds:8');
  assert.ok(longshot);
  assert.equal(longshot.summary.targetHitRate, 100);
  assert.equal(longshot.summary.avgLegs, 3);
  assert.ok(longshot.daily.every((day) => day.legs <= 3));
});

test('ticket controls reject invalid values but keep legacy targets', () => {
  assert.deepEqual(
    normalizeTicketControls({
      strategy: 'probability',
      minOdds: 3.6,
      maxLegs: 2,
    }),
    { strategy: 'probability', minOdds: 3.6, maxLegs: 2 }
  );
  assert.deepEqual(
    normalizeTicketControls({ strategy: 'unknown', minOdds: 999, maxLegs: 8 }),
    { strategy: 'balanced', minOdds: 2.8, maxLegs: 3 }
  );
  // A target saved by an older build is still the user's real current shape.
  assert.deepEqual(
    normalizeTicketControls({ minOdds: 2.55, maxLegs: 2 }),
    { strategy: 'balanced', minOdds: 2.55, maxLegs: 2 }
  );
});
