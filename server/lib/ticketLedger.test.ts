import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';
import type { LedgerFile, LedgerTicket } from '../../src/types/ledger.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import {
  planLedgerWrites,
  readLedger,
  recordShadowTickets,
  settleTicketsWithFixtures,
  summariseLedger,
  updateClosingPrices,
} from './ticketLedger.ts';

const ledgerDir = mkdtempSync(path.join(os.tmpdir(), 'matchslip-ledger-'));
process.env.MATCHSLIP_LEDGER_DIR = ledgerDir;

const NOW = Date.UTC(2026, 10, 19, 12, 0);

after(() => {
  rmSync(ledgerDir, { recursive: true, force: true });
});

function pricedFixture(
  id: string,
  overrides: Partial<Fixture> = {}
): Fixture {
  return makeFixture({
    id,
    status: 'Scheduled',
    statusShort: 'NS',
    awaitingResult: false,
    score: { home: null, away: null },
    kickoffTimestamp: NOW + 60 * 60 * 1000,
    pricedAt: new Date(NOW - 60_000).toISOString(),
    priceQuality: 'prematch',
    markets: [makeMarket(`${id}-1x2-h`, 1.5, '1X2', `${id} Win`)],
    recommendedPickId: `${id}-1x2-h`,
    ...overrides,
  });
}

const fixtures = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) =>
  pricedFixture(id)
);

test('records every engine variant once and rejects post-kickoff prices', async () => {
  const contaminated = pricedFixture('late', { priceQuality: 'live' });

  const first = await recordShadowTickets(
    '2026-11-19',
    [...fixtures, contaminated],
    NOW
  );
  assert.ok(first.added > 0, 'expected shadow tickets to be recorded');
  assert.equal(first.eligible, fixtures.length);

  const second = await recordShadowTickets(
    '2026-11-19',
    [...fixtures, contaminated],
    NOW
  );
  assert.equal(second.added, 0, 'recording must be idempotent');

  const ledger = await readLedger();
  assert.ok(ledger.tickets.length > 0);
  assert.ok(
    ledger.tickets.every((ticket) => ticket.priceQuality === 'prematch')
  );
  assert.ok(
    ledger.tickets.every((ticket) =>
      ticket.legs.every((leg) => leg.fixtureId !== 'late')
    )
  );
  // The gate is recorded alongside every budget so it can be graded later.
  assert.ok(
    ledger.tickets.every(
      (ticket) =>
        typeof ticket.guardRecommended === 'boolean' &&
        typeof ticket.guardEdgePts === 'number' &&
        typeof ticket.guardLegCap === 'number' &&
        (ticket.guardLegCap as number) <= ticket.legCount
    )
  );
});

test('tracks closing-line value and settles every shadow ticket', async () => {
  const repriced = fixtures.map((fixture) => ({
    ...fixture,
    markets: fixture.markets.map((market) => ({ ...market, odds: 1.4 })),
  }));
  await updateClosingPrices(repriced, NOW);

  const finished = fixtures.map((fixture) => ({
    ...fixture,
    status: 'Finished' as const,
    statusShort: 'FT',
    score: { home: 2, away: 0 },
  }));
  await settleTicketsWithFixtures(finished);

  const summary = summariseLedger(await readLedger());

  assert.ok(summary.tickets > 0);
  assert.equal(summary.won, summary.tickets);
  assert.equal(summary.lost, 0);
  assert.equal(summary.hitRate, 100);
  assert.ok((summary.roi ?? 0) > 0, 'all-winning short slips should profit');
  assert.ok((summary.avgClv ?? 0) > 0, 'shortening prices are positive CLV');
  assert.equal(summary.byPriceQuality[0].label, 'Pre-match prices');
});

test('leaves CLV unknown when no later pre-match quote was observed', async () => {
  const unobserved = ['i', 'j', 'k'].map((id) => pricedFixture(id));
  await recordShadowTickets('2026-11-20', unobserved, NOW);

  const finished = unobserved.map((fixture) => ({
    ...fixture,
    status: 'Finished' as const,
    statusShort: 'FT',
    score: { home: 2, away: 0 },
  }));
  await settleTicketsWithFixtures(finished);

  const settled = (await readLedger()).tickets.filter(
    (ticket) => ticket.dateIso === '2026-11-20'
  );
  assert.ok(settled.length > 0, 'expected tickets for the unobserved date');
  assert.ok(
    settled.every(
      (ticket) =>
        ticket.clvPct === undefined && ticket.closingTotalOdds === undefined
    ),
    'settlement must not invent a closing price from the placed odds'
  );
  assert.ok(settled.every((ticket) => ticket.status === 'Win'));
});

test('ignores quotes captured after kickoff when closing the line', async () => {
  const closingWindow = ['l', 'm', 'n'].map((id) => pricedFixture(id));
  await recordShadowTickets('2026-11-21', closingWindow, NOW);

  const repriced = closingWindow.map((fixture) => ({
    ...fixture,
    markets: fixture.markets.map((market) => ({ ...market, odds: 1.2 })),
  }));
  const afterKickoff = NOW + 90 * 60 * 1000;
  await updateClosingPrices(repriced, afterKickoff);

  const open = (await readLedger()).tickets.filter(
    (ticket) => ticket.dateIso === '2026-11-21'
  );
  assert.ok(open.length > 0, 'expected tickets for the closing-window date');
  assert.ok(
    open.every((ticket) =>
      ticket.legs.every((leg) => leg.closingOdds === undefined)
    ),
    'a stale Scheduled fixture must not contribute an in-play closing quote'
  );
});

function shadowTicket(id: string, status: LedgerTicket['status'] = 'Pending'): LedgerTicket {
  return {
    id,
    dateIso: '2026-11-22',
    createdAt: new Date(NOW).toISOString(),
    kind: 'strategy',
    strategy: 'balanced',
    label: 'Balanced',
    targetOdds: 2.8,
    maxLegs: 3,
    priceQuality: 'prematch',
    legCount: 1,
    totalOdds: 2.8,
    fairProbability: null,
    stake: 1,
    status,
    legs: [],
  };
}

test('unchanged ledger documents cost no writes', () => {
  const ticket = shadowTicket('unchanged');
  const plan = planLedgerWrites(
    [{ $id: ticket.id, payloadJson: JSON.stringify(ticket) }],
    [ticket]
  );

  assert.equal(plan.changed, false);
  assert.deepEqual(plan.toWrite, []);
  assert.deepEqual(plan.staleIds, []);
});

test('only moved tickets are rewritten and vanished ones are pruned', () => {
  const kept = shadowTicket('kept');
  const moved = shadowTicket('moved', 'Win');

  const plan = planLedgerWrites(
    [
      { $id: kept.id, payloadJson: JSON.stringify(kept) },
      { $id: moved.id, payloadJson: JSON.stringify(shadowTicket('moved')) },
      { $id: 'deleted', payloadJson: '{}' },
    ],
    [kept, moved]
  );

  assert.equal(plan.changed, true);
  assert.deepEqual(plan.toWrite, [moved]);
  assert.deepEqual(plan.staleIds, ['deleted']);
});

test('a failed/empty ledger read never prunes stored documents', () => {
  const plan = planLedgerWrites(
    [{ $id: 'survivor', payloadJson: '{}' }],
    []
  );

  assert.equal(plan.changed, false);
  assert.deepEqual(plan.staleIds, []);
});

test('a ledger summary can be scoped to one day without losing the day list', () => {
  const ledger: LedgerFile = {
    version: 1,
    updatedAt: new Date(NOW).toISOString(),
    tickets: [
      { ...shadowTicket('older', 'Win'), dateIso: '2026-11-19' },
      { ...shadowTicket('newer', 'Lost'), dateIso: '2026-11-20' },
    ],
  };

  const all = summariseLedger(ledger);
  assert.equal(all.dateIso, null);
  assert.deepEqual(all.availableDates, ['2026-11-20', '2026-11-19']);
  assert.equal(all.tickets, 2);

  const day = summariseLedger(ledger, '2026-11-20');
  assert.equal(day.dateIso, '2026-11-20');
  assert.equal(day.tickets, 1);
  assert.equal(day.won, 0);
  assert.equal(day.lost, 1);
  assert.deepEqual(day.recent.map((ticket) => ticket.id), ['newer']);
  assert.deepEqual(day.availableDates, all.availableDates);

  const empty = summariseLedger(ledger, '2026-11-18');
  assert.equal(empty.tickets, 0);
  assert.equal(empty.roi, null);
  assert.deepEqual(empty.byVariant, []);

  assert.equal(summariseLedger(ledger, 'not-a-date').tickets, 2);
});
