import type { Fixture, SavedTicket } from '../types/fixtures.ts';
import { evaluateMarketSettlement, evaluateTicketSettlement } from './accaMath.ts';
import type { TicketSettlementSummary } from './accaMath.ts';
import { resolveSettlementPool, type FixtureSnapshots } from './fixtureSnapshots.ts';
import { ticketDateIso } from './savedTicketGroups.ts';
import {
  buildDailyPerformance,
  buildMarketTypePerformance,
  buildOddsBandPerformance,
  buildSlipAnalytics,
} from './slipAnalytics.ts';
import type {
  LegSettlementInput,
  SlipSettlementInput,
} from './slipAnalytics.ts';

/**
 * The signed-in user's own activity, projected from the slips they saved.
 *
 * This is deliberately a local projection of user data, not a copy of the
 * engine's global shadow ledger. Both the Saved Slips view and the My Activity
 * view read this same computation so settlement numbers cannot drift between
 * them. The engine ledger stays global and append-only in the API/function.
 */

export interface TicketSettlementEntry {
  pool: Fixture[];
  settlement: TicketSettlementSummary;
}

export interface SlipActivityData {
  settlements: Map<string, TicketSettlementEntry>;
  performanceRows: SlipSettlementInput[];
  legPerformanceRows: LegSettlementInput[];
  analytics: ReturnType<typeof buildSlipAnalytics>;
  daily: ReturnType<typeof buildDailyPerformance>;
  oddsBands: ReturnType<typeof buildOddsBandPerformance>;
  marketTypes: ReturnType<typeof buildMarketTypePerformance>;
}

export function buildSlipActivityData(
  savedTickets: SavedTicket[],
  fixtures: Fixture[],
  fixtureSnapshots: FixtureSnapshots
): SlipActivityData {
  const settlements = new Map<string, TicketSettlementEntry>();
  for (const ticket of savedTickets) {
    const pool = resolveSettlementPool(ticket, fixtureSnapshots, fixtures);
    settlements.set(ticket.id, {
      pool,
      settlement: evaluateTicketSettlement(ticket.legs, pool, ticket.stake),
    });
  }

  // One flat row per saved slip for the analytics module. Settlement already
  // knows the void-adjusted odds and the payout, so nothing is recomputed here.
  const performanceRows: SlipSettlementInput[] = savedTickets.map((ticket) => {
    const settlement = settlements.get(ticket.id)?.settlement;
    return {
      id: ticket.id,
      dateIso: ticket.dateIso ?? ticketDateIso(ticket),
      createdAt: ticket.createdAt,
      stake: ticket.stake,
      effectiveOdds: settlement?.effectiveOdds ?? 0,
      legCount: ticket.legs.length,
      status: settlement?.status ?? 'Pending',
      settledReturn: settlement?.settledReturn ?? 0,
    };
  });

  const legPerformanceRows: LegSettlementInput[] = [];
  for (const ticket of savedTickets) {
    const pool = settlements.get(ticket.id)?.pool ?? [];
    const byId = new Map(pool.map((fixture) => [fixture.id, fixture]));

    for (const leg of ticket.legs) {
      const fixture = byId.get(leg.fixtureId);
      legPerformanceRows.push({
        marketType: leg.marketType,
        status: fixture
          ? evaluateMarketSettlement(fixture, {
              id: leg.marketId,
              label: leg.marketLabel,
              marketType: leg.marketType,
            })
          : 'Pending',
      });
    }
  }

  return {
    settlements,
    performanceRows,
    legPerformanceRows,
    analytics: buildSlipAnalytics(performanceRows),
    daily: buildDailyPerformance(performanceRows),
    oddsBands: buildOddsBandPerformance(performanceRows),
    marketTypes: buildMarketTypePerformance(legPerformanceRows),
  };
}
