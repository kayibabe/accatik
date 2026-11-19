import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Query, type Databases } from 'node-appwrite';
import type {
  AccaLeg,
  AccaStrategy,
  Fixture,
  SettlementStatus,
} from '../../src/types/fixtures.ts';
import type {
  LedgerBreakdownRow,
  LedgerFile,
  LedgerLeg,
  LedgerStats,
  LedgerSummary,
  LedgerTicket,
  LedgerTicketKind,
} from '../../src/types/ledger.ts';
import { buildRecommendedAcca } from '../../src/utils/accaEngine.ts';
import {
  calculateTotalOdds,
  evaluateTicketSettlement,
} from '../../src/utils/accaMath.ts';
import { combinedFairProbability } from '../../src/utils/probability.ts';
import {
  combinePriceQuality,
  inferPriceQuality,
} from '../../src/utils/priceQuality.ts';
import { STRATEGY_LABELS } from '../../src/utils/strategy.ts';
import { guardTicket } from '../../src/utils/ticketGuard.ts';
import { TICKET_SHAPES } from '../../src/utils/ticketShapes.ts';
import { readArchivedSlate } from './slateArchive.ts';
import { APPWRITE_DATABASE_ID } from './auth.ts';
import {
  getDataDatabases,
  listAllDocuments,
  mapWithConcurrency,
  upsertDocument,
} from './appwriteData.ts';

/**
 * Shadow ticket ledger storage.
 *
 * One JSON file, written atomically, with all mutations serialised through a
 * module-level promise chain. The app is a single Node process, so this is
 * enough to prevent read-modify-write races without adding a database.
 */

const STRATEGIES: AccaStrategy[] = [
  'balanced',
  'favorites',
  'goals',
  'high-yield',
  'probability',
];
const LEG_BUDGETS = [2, 3, 4, 6, 8] as const;
const OPEN_STATUSES: SettlementStatus[] = ['Pending', 'Live'];

function ledgerFile(): string {
  if (process.env.MATCHSLIP_LEDGER_FILE) {
    return process.env.MATCHSLIP_LEDGER_FILE;
  }
  const dir =
    process.env.MATCHSLIP_LEDGER_DIR ??
    path.join(process.cwd(), 'data', 'ledger');
  return path.join(dir, 'tickets.json');
}

function emptyLedger(): LedgerFile {
  return { version: 1, updatedAt: new Date().toISOString(), tickets: [] };
}

async function readLedgerFromAppwrite(
  databases: Databases
): Promise<LedgerFile> {
  const documents = await listAllDocuments(databases, 'ledger_tickets');
  const tickets = documents.map(
    (document) => JSON.parse(String(document.payloadJson)) as LedgerTicket
  );
  let updatedAt = new Date().toISOString();
  try {
    const meta = await databases.getDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'ledger_meta',
      documentId: 'state',
    });
    updatedAt = String(meta.updatedAt);
  } catch {
    updatedAt = new Date().toISOString();
  }
  return { version: 1, updatedAt, tickets };
}

async function writeLedgerToAppwrite(
  databases: Databases,
  ledger: LedgerFile
): Promise<void> {
  await upsertDocument(databases, 'ledger_meta', 'state', {
    updatedAt: ledger.updatedAt,
  });

  const wanted = new Set(ledger.tickets.map((ticket) => ticket.id));
  await mapWithConcurrency(ledger.tickets, 8, async (ticket) => {
    await upsertDocument(databases, 'ledger_tickets', ticket.id, {
      ticketId: ticket.id,
      dateIso: ticket.dateIso,
      kind: ticket.kind,
      status: ticket.status,
      createdAt: ticket.createdAt,
      payloadJson: JSON.stringify(ticket),
    });
  });

  // Never prune from a failed/empty read: an API hiccup must not erase the ledger.
  if (ledger.tickets.length === 0) return;
  const existing = await listAllDocuments(databases, 'ledger_tickets');
  for (const document of existing) {
    if (wanted.has(document.$id)) continue;
    await databases.deleteDocument({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: 'ledger_tickets',
      documentId: document.$id,
    });
  }
}

async function readLedgerFile(): Promise<LedgerFile> {
  const databases = getDataDatabases();
  if (databases) {
    try {
      return await readLedgerFromAppwrite(databases);
    } catch (error) {
      console.warn('[ledger] could not read Appwrite ledger', error);
      return emptyLedger();
    }
  }
  try {
    const raw = await fs.readFile(ledgerFile(), 'utf8');
    const parsed = JSON.parse(raw) as LedgerFile;
    if (!parsed || !Array.isArray(parsed.tickets)) return emptyLedger();
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      tickets: parsed.tickets,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[ledger] could not read the ticket ledger', error);
    }
    return emptyLedger();
  }
}

async function writeLedgerFile(ledger: LedgerFile): Promise<void> {
  const databases = getDataDatabases();
  if (databases) {
    await writeLedgerToAppwrite(databases, ledger);
    return;
  }
  const target = ledgerFile();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  ledger.updatedAt = new Date().toISOString();
  await fs.writeFile(temp, JSON.stringify(ledger), 'utf8');
  await fs.rename(temp, target);
}

let mutationQueue: Promise<unknown> = Promise.resolve();

function withLedger<T>(mutate: (ledger: LedgerFile) => T | Promise<T>): Promise<T> {
  const run = mutationQueue.then(async () => {
    const ledger = await readLedgerFile();
    const result = await mutate(ledger);
    await writeLedgerFile(ledger);
    return result;
  });
  mutationQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function readLedger(): Promise<LedgerFile> {
  return readLedgerFile();
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;

function ticketId(
  dateIso: string,
  kind: LedgerTicketKind,
  label: string,
  legs: AccaLeg[]
): string {
  const key = [
    dateIso,
    kind,
    label,
    ...legs.map((leg) => `${leg.fixtureId}:${leg.marketId}`),
  ].join('|');
  return `led-${createHash('sha1').update(key).digest('hex').slice(0, 16)}`;
}

function asLedgerLegs(
  legs: AccaLeg[],
  fixturesById: Map<string, Fixture>
): LedgerLeg[] {
  return legs.map((leg) => ({
    ...leg,
    priceQuality: fixturesById.has(leg.fixtureId)
      ? inferPriceQuality(fixturesById.get(leg.fixtureId) as Fixture)
      : 'unknown',
  }));
}

function makeTicket(
  dateIso: string,
  kind: LedgerTicketKind,
  strategy: AccaStrategy,
  label: string,
  targetOdds: number,
  maxLegs: number,
  legs: LedgerLeg[],
  fixtures: Fixture[],
  nowIso: string
): LedgerTicket {
  const settlement = evaluateTicketSettlement(legs, fixtures, 1);
  // The gate is measured, not enforced: the ledger must keep every leg budget
  // so the "more legs = worse" claim stays falsifiable.
  const guard = guardTicket(legs);
  return {
    id: ticketId(dateIso, kind, label, legs),
    dateIso,
    createdAt: nowIso,
    kind,
    strategy,
    label,
    targetOdds,
    maxLegs,
    priceQuality: combinePriceQuality(legs.map((leg) => leg.priceQuality)),
    legCount: legs.length,
    totalOdds: calculateTotalOdds(legs),
    fairProbability: combinedFairProbability(legs),
    stake: 1,
    status: settlement.status,
    settledReturn:
      settlement.status === 'Win' || settlement.status === 'Void'
        ? settlement.settledReturn
        : undefined,
    guardRecommended: guard.recommended,
    guardEdgePts: guard.economics.edgePts,
    guardLegCap: guard.legs.length,
    legs,
  };
}

/**
 * Records the engine's own tickets for a matchday.
 *
 * Strategy variants use an unreachable target so each carries exactly its leg
 * budget — that isolates the effect of leg count from the effect of chasing a
 * headline price. Shape presets are recorded exactly as the UI would build
 * them. Any leg whose price was not captured before kickoff is rejected, so
 * the ledger never inherits the contaminated backfill.
 */
interface ShadowTicketResult {
  added: number;
  skipped: number;
  eligible: number;
}

/** Pure ledger mutation: callers own the read/write through `withLedger`. */
function addShadowTickets(
  ledger: LedgerFile,
  dateIso: string,
  fixtures: Fixture[],
  nowMs: number
): ShadowTicketResult {
  const eligible = fixtures.filter(
    (fixture) =>
      fixture.status === 'Scheduled' &&
      !fixture.awaitingResult &&
      fixture.markets.length > 0 &&
      inferPriceQuality(fixture) === 'prematch' &&
      (fixture.kickoffTimestamp === undefined ||
        fixture.kickoffTimestamp > nowMs)
  );

  if (eligible.length === 0) {
    return { added: 0, skipped: 0, eligible: 0 };
  }

  const fixturesById = new Map(eligible.map((fixture) => [fixture.id, fixture]));
  const nowIso = new Date(nowMs).toISOString();
  const drafts: Array<{
    kind: LedgerTicketKind;
    strategy: AccaStrategy;
    label: string;
    targetOdds: number;
    maxLegs: number;
    legs: AccaLeg[];
  }> = [];

  for (const strategy of STRATEGIES) {
    for (const budget of LEG_BUDGETS) {
      const legs = buildRecommendedAcca(
        eligible,
        Number.POSITIVE_INFINITY,
        strategy,
        budget
      );
      // A partial ticket would duplicate the next-smaller budget and muddy
      // the leg-count comparison, so only exact budgets are recorded.
      if (legs.length !== budget) continue;
      drafts.push({
        kind: 'strategy',
        strategy,
        label: `${STRATEGY_LABELS[strategy]} · ${budget} legs`,
        targetOdds: calculateTotalOdds(legs),
        maxLegs: budget,
        legs,
      });
    }
  }

  for (const shape of TICKET_SHAPES) {
    const legs = buildRecommendedAcca(
      eligible,
      shape.targetOdds,
      shape.strategy,
      shape.maxLegs
    );
    if (legs.length === 0) continue;
    drafts.push({
      kind: 'shape',
      strategy: shape.strategy,
      label: shape.label,
      targetOdds: shape.targetOdds,
      maxLegs: shape.maxLegs,
      legs,
    });
  }

  const existing = new Set(ledger.tickets.map((ticket) => ticket.id));
  let added = 0;
  let skipped = 0;

  for (const draft of drafts) {
    const legs = asLedgerLegs(draft.legs, fixturesById);
    if (legs.some((leg) => leg.priceQuality !== 'prematch')) {
      skipped++;
      continue;
    }

    const ticket = makeTicket(
      dateIso,
      draft.kind,
      draft.strategy,
      draft.label,
      draft.targetOdds,
      draft.maxLegs,
      legs,
      eligible,
      nowIso
    );

    // Keep the first observation: it is the actual opening price, not a
    // later quote that would flatter closing-line value.
    if (existing.has(ticket.id)) {
      skipped++;
      continue;
    }

    ledger.tickets.push(ticket);
    existing.add(ticket.id);
    added++;
  }

  return { added, skipped, eligible: eligible.length };
}

/** Backwards-compatible single-purpose mutation for direct callers and tests. */
export async function recordShadowTickets(
  dateIso: string,
  fixtures: Fixture[],
  nowMs = Date.now()
): Promise<ShadowTicketResult> {
  return withLedger((ledger) => addShadowTickets(ledger, dateIso, fixtures, nowMs));
}

function recomputeClosing(ticket: LedgerTicket): void {
  if (ticket.legs.length === 0) return;

  // A partial closing book would mix placed and closing prices, so CLV stays
  // unknown until every leg has a later pre-match quote. Falling back to the
  // placed price would silently report zero CLV for legs never re-observed.
  if (!ticket.legs.every((leg) => Number.isFinite(leg.closingOdds))) {
    ticket.closingTotalOdds = undefined;
    ticket.clvPct = undefined;
    return;
  }

  const closingTotal = ticket.legs.reduce(
    (product, leg) => product * (leg.closingOdds as number),
    1
  );

  ticket.closingTotalOdds = round2(closingTotal);
  ticket.clvPct = round1((ticket.totalOdds / closingTotal - 1) * 100);
}

/**
 * Moves each open ticket's closing price to the latest pre-kickoff quote.
 * Once a fixture is live or finished, the archived price block wins and the
 * closing quote is frozen.
 */
function applyClosingPrices(
  ledger: LedgerFile,
  fixtures: Fixture[],
  nowMs: number
): number {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const nowIso = new Date(nowMs).toISOString();
  let updated = 0;

  for (const ticket of ledger.tickets) {
    if (!OPEN_STATUSES.includes(ticket.status)) continue;

    let changed = false;
    for (const leg of ticket.legs) {
      const fixture = byId.get(leg.fixtureId);
      if (!fixture || fixture.status !== 'Scheduled' || fixture.awaitingResult) {
        continue;
      }
      // A stale "Scheduled" status can arrive after kickoff. Any quote seen
      // once the match has started is an in-play price, not a closing price.
      if (
        fixture.kickoffTimestamp !== undefined &&
        fixture.kickoffTimestamp <= nowMs
      ) {
        continue;
      }
      if (inferPriceQuality(fixture) !== 'prematch') continue;

      const market = fixture.markets.find(
        (candidate) => candidate.id === leg.marketId
      );
      if (!market) continue;

      if (leg.closingOdds !== market.odds) {
        leg.closingOdds = market.odds;
        leg.closingPricedAt = nowIso;
        changed = true;
      }
    }

    if (changed) {
      recomputeClosing(ticket);
      updated++;
    }
  }

  return updated;
}

/** Backwards-compatible single-purpose mutation for direct callers and tests. */
export async function updateClosingPrices(
  fixtures: Fixture[],
  nowMs = Date.now()
): Promise<number> {
  return withLedger((ledger) => applyClosingPrices(ledger, fixtures, nowMs));
}

/**
 * Settles open tickets from a freshly loaded matchday. Tickets whose fixtures
 * are not all present are left untouched rather than partially settled.
 */
function applySettlements(
  ledger: LedgerFile,
  fixtures: Fixture[],
  dateIso?: string
): number {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  let changed = 0;

  for (const ticket of ledger.tickets) {
    if (!OPEN_STATUSES.includes(ticket.status)) continue;
    if (dateIso && ticket.dateIso !== dateIso) continue;
    if (!ticket.legs.every((leg) => byId.has(leg.fixtureId))) continue;

    const settlement = evaluateTicketSettlement(ticket.legs, fixtures, 1);
    if (
      settlement.status !== 'Win' &&
      settlement.status !== 'Lost' &&
      settlement.status !== 'Void'
    ) {
      continue;
    }

    ticket.status = settlement.status;
    ticket.settledReturn =
      settlement.status === 'Win' || settlement.status === 'Void'
        ? settlement.settledReturn
        : 0;
    ticket.settledAt = new Date().toISOString();

    // Never backfill a missing closing quote with the placed price: that
    // would make unobserved legs look like exactly zero CLV.
    recomputeClosing(ticket);
    changed++;
  }

  return changed;
}

/** Backwards-compatible single-purpose mutation for direct callers and tests. */
export async function settleTicketsWithFixtures(
  fixtures: Fixture[]
): Promise<number> {
  return withLedger((ledger) => applySettlements(ledger, fixtures));
}

export interface SlateLedgerUpdate extends ShadowTicketResult {
  closingPricesUpdated: number;
  settled: number;
}

/**
 * One read/write pass per slate delivery. `updateClosingPrices`,
 * `settleTicketsWithFixtures` and `recordShadowTickets` used to be called in
 * sequence by the slate handler, each rewriting the whole ledger. Keeping the
 * same order here preserves the behaviour while paying the I/O cost once.
 */
export async function applySlateToLedger(
  dateIso: string,
  fixtures: Fixture[],
  nowMs = Date.now()
): Promise<SlateLedgerUpdate> {
  return withLedger((ledger) => {
    const closingPricesUpdated = applyClosingPrices(ledger, fixtures, nowMs);
    const settled = applySettlements(ledger, fixtures);
    const recorded = addShadowTickets(ledger, dateIso, fixtures, nowMs);
    return { closingPricesUpdated, settled, ...recorded };
  });
}

/**
 * Local-only settlement pass over the archive. The summary endpoint calls
 * this so results land without the user re-opening every matchday.
 */
export async function settleLedgerFromArchives(
  dateIso?: string
): Promise<number> {
  const ledger = await readLedgerFile();
  const dates = new Set(
    ledger.tickets
      .filter((ticket) => OPEN_STATUSES.includes(ticket.status))
      .map((ticket) => ticket.dateIso)
  );

  if (dateIso) {
    return settleDateFromArchive(dateIso);
  }

  let changed = 0;
  for (const date of dates) {
    changed += await settleDateFromArchive(date);
  }
  return changed;
}

async function settleDateFromArchive(dateIso: string): Promise<number> {
  const archived = await readArchivedSlate(dateIso);
  if (!archived) return 0;
  return settleTicketsWithFixtures(archived.fixtures);
}

function emptyStats(): LedgerStats {
  return {
    tickets: 0,
    won: 0,
    lost: 0,
    voided: 0,
    live: 0,
    pending: 0,
    decided: 0,
    hitRate: null,
    breakEvenHitRate: null,
    settledStake: 0,
    returns: 0,
    netPnl: 0,
    roi: null,
    avgOdds: 0,
    avgLegs: 0,
    avgFairProbability: null,
    avgClv: null,
  };
}

function buildStats(tickets: LedgerTicket[]): LedgerStats {
  const stats = emptyStats();
  stats.tickets = tickets.length;

  let oddsSum = 0;
  let legsSum = 0;
  let fairSum = 0;
  let fairCount = 0;
  let clvSum = 0;
  let clvCount = 0;

  for (const ticket of tickets) {
    legsSum += ticket.legCount;
    if (ticket.fairProbability !== null) {
      fairSum += ticket.fairProbability;
      fairCount++;
    }
    if (Number.isFinite(ticket.clvPct)) {
      clvSum += ticket.clvPct as number;
      clvCount++;
    }

    if (ticket.status === 'Win') {
      stats.won++;
      stats.settledStake += ticket.stake;
      stats.returns += ticket.settledReturn ?? ticket.stake * ticket.totalOdds;
      oddsSum += ticket.totalOdds;
    } else if (ticket.status === 'Lost') {
      stats.lost++;
      stats.settledStake += ticket.stake;
      oddsSum += ticket.totalOdds;
    } else if (ticket.status === 'Void') {
      stats.voided++;
    } else if (ticket.status === 'Live') {
      stats.live++;
    } else {
      stats.pending++;
    }
  }

  stats.decided = stats.won + stats.lost;
  stats.netPnl = round2(stats.returns - stats.settledStake);
  stats.hitRate =
    stats.decided > 0 ? round1((stats.won / stats.decided) * 100) : null;
  stats.roi =
    stats.settledStake > 0
      ? round1((stats.netPnl / stats.settledStake) * 100)
      : null;
  stats.avgOdds = stats.decided > 0 ? round2(oddsSum / stats.decided) : 0;
  stats.breakEvenHitRate =
    stats.avgOdds > 1 ? round1(100 / stats.avgOdds) : null;
  stats.avgLegs = tickets.length > 0 ? round2(legsSum / tickets.length) : 0;
  stats.avgFairProbability =
    fairCount > 0 ? round1(fairSum / fairCount) : null;
  stats.avgClv = clvCount > 0 ? round1(clvSum / clvCount) : null;
  stats.settledStake = round2(stats.settledStake);
  stats.returns = round2(stats.returns);

  return stats;
}

function groupBy(
  tickets: LedgerTicket[],
  keyOf: (ticket: LedgerTicket) => string,
  labelOf: (key: string, ticket: LedgerTicket) => string = (key) => key
): LedgerBreakdownRow[] {
  const groups = new Map<string, LedgerTicket[]>();
  for (const ticket of tickets) {
    const key = keyOf(ticket);
    const bucket = groups.get(key);
    if (bucket) bucket.push(ticket);
    else groups.set(key, [ticket]);
  }

  return [...groups.entries()]
    .map(([key, bucket]) => ({
      key,
      label: labelOf(key, bucket[0]),
      ...buildStats(bucket),
    }))
    .sort((a, b) => b.tickets - a.tickets || a.label.localeCompare(b.label));
}

export function summariseLedger(ledger: LedgerFile): LedgerSummary {
  return {
    generatedAt: new Date().toISOString(),
    updatedAt: ledger.updatedAt,
    ...buildStats(ledger.tickets),
    byVariant: groupBy(ledger.tickets, (ticket) => ticket.label),
    byLegCount: groupBy(
      ledger.tickets,
      (ticket) => String(ticket.legCount),
      (key) => `${key} legs`
    ),
    byPriceQuality: groupBy(
      ledger.tickets,
      (ticket) => ticket.priceQuality,
      (key) =>
        key === 'prematch'
          ? 'Pre-match prices'
          : key === 'live'
            ? 'Captured after kickoff'
            : 'Unknown capture time'
    ),
    recent: [...ledger.tickets]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 12),
  };
}

/** Settles from the archive, then returns the summary the UI renders. */
export async function getLedgerSummary(): Promise<LedgerSummary> {
  await settleLedgerFromArchives();
  return summariseLedger(await readLedgerFile());
}

export async function listLedgerTickets(options?: {
  dateIso?: string;
  status?: SettlementStatus;
  limit?: number;
}): Promise<LedgerTicket[]> {
  const ledger = await readLedgerFile();
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);

  return ledger.tickets
    .filter(
      (ticket) =>
        (!options?.dateIso || ticket.dateIso === options.dateIso) &&
        (!options?.status || ticket.status === options.status)
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export { ledgerFile };
