import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fixture } from '../../src/types/fixtures.ts';
import { makeFixture, makeMarket } from '../../src/utils/testFactories.ts';
import { applySlateToLedger, readLedger } from './ticketLedger.ts';

const ledgerDir = mkdtempSync(path.join(os.tmpdir(), 'matchslip-ledger-batch-'));
process.env.MATCHSLIP_LEDGER_DIR = ledgerDir;

const NOW = Date.UTC(2026, 10, 22, 12, 0);
const DATE = '2026-11-22';

after(() => {
  rmSync(ledgerDir, { recursive: true, force: true });
});

function scheduled(odds = 1.5): Fixture[] {
  return ['a', 'b', 'c'].map((id) =>
    makeFixture({
      id,
      status: 'Scheduled',
      statusShort: 'NS',
      awaitingResult: false,
      score: { home: null, away: null },
      kickoffTimestamp: NOW + 60 * 60 * 1000,
      pricedAt: new Date(NOW - 60_000).toISOString(),
      priceQuality: 'prematch',
      markets: [makeMarket(`${id}-1x2-h`, odds, '1X2', `${id} Win`)],
      recommendedPickId: `${id}-1x2-h`,
    })
  );
}

test('one ledger pass records, reprices and settles a slate', async () => {
  const first = await applySlateToLedger(DATE, scheduled(), NOW);
  assert.ok(first.added > 0, 'expected shadow tickets to be recorded');
  assert.equal(first.settled, 0);

  const recorded = await readLedger();
  const mine = recorded.tickets.filter((ticket) => ticket.dateIso === DATE);
  assert.ok(mine.length > 0);

  const second = await applySlateToLedger(DATE, scheduled(1.4), NOW + 60_000);
  assert.equal(second.added, 0, 'recording must stay idempotent');
  assert.ok(second.closingPricesUpdated > 0, 'closing quotes should move');

  const repriced = await readLedger();
  assert.ok(
    repriced.tickets
      .filter((ticket) => ticket.dateIso === DATE)
      .every((ticket) => ticket.legs.some((leg) => leg.closingOdds === 1.4))
  );

  const finished = scheduled().map((fixture) => ({
    ...fixture,
    status: 'Finished' as const,
    statusShort: 'FT',
    score: { home: 2, away: 0 },
  }));
  const third = await applySlateToLedger(DATE, finished, NOW + 2 * 60 * 60 * 1000);
  assert.ok(third.settled > 0, 'open tickets should settle from final results');

  const settled = await readLedger();
  assert.ok(
    settled.tickets
      .filter((ticket) => ticket.dateIso === DATE)
      .every((ticket) => ticket.status === 'Win')
  );
});
