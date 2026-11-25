import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SavedTicket } from '../../types/fixtures.ts';
import { evaluateMarketSettlement } from '../../utils/accaMath.ts';
import type { TicketSettlementEntry } from '../../utils/slipActivity.ts';
import { isOpenSettlement } from '../../utils/uiTone.ts';

export interface UsePendingResultRefreshOptions {
  tickets: ReadonlyArray<SavedTicket>;
  settlements: ReadonlyMap<string, TicketSettlementEntry>;
  onRefreshResults: (
    fixtureIds: string[],
    forceRefresh?: boolean
  ) => Promise<unknown>;
  /** Maximum fixtures fetched by the automatic background pass. */
  batchSize?: number;
  concurrency?: number;
}

export interface PendingResultRefresh {
  pendingFixtureIds: string[];
  isRefreshing: boolean;
  refreshError: string | null;
  requestResults: (
    fixtureIds: string[],
    forceRefresh?: boolean
  ) => Promise<void>;
  refreshPending: () => Promise<void>;
  clearError: () => void;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
      }
    }
  );
  await Promise.all(runners);
}

/**
 * Shared settlement-refresh loop for the slip archive and ticket history.
 * Only past-kickoff fixtures with an open settlement are requested, and IDs
 * already asked for are remembered so a silent feed cannot cause a loop.
 */
export function usePendingResultRefresh({
  tickets,
  settlements,
  onRefreshResults,
  batchSize = 20,
  concurrency = 3,
}: UsePendingResultRefreshOptions): PendingResultRefresh {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestedResultsRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(0);

  const pendingFixtureIds = useMemo(() => {
    const nowMs = Date.now();
    const ids = new Set<string>();

    for (const ticket of tickets) {
      const pool = settlements.get(ticket.id)?.pool ?? [];
      const byId = new Map(pool.map((fixture) => [fixture.id, fixture]));

      for (const leg of ticket.legs) {
        const fixture = byId.get(leg.fixtureId);
        if (!fixture) {
          ids.add(leg.fixtureId);
          continue;
        }

        const status = evaluateMarketSettlement(fixture, {
          id: leg.marketId,
          label: leg.marketLabel,
          marketType: leg.marketType,
        });
        if (!isOpenSettlement(status)) continue;

        const kickoffInFuture =
          fixture.status === 'Scheduled' &&
          typeof fixture.kickoffTimestamp === 'number' &&
          fixture.kickoffTimestamp > nowMs;
        if (kickoffInFuture) continue;

        ids.add(leg.fixtureId);
      }
    }

    return [...ids].sort();
  }, [tickets, settlements]);

  const requestResults = useCallback(
    async (fixtureIds: string[], forceRefresh = false) => {
      if (fixtureIds.length === 0) return;
      inFlightRef.current += 1;
      setIsRefreshing(true);
      setRefreshError(null);
      try {
        await runWithConcurrency(
          chunks(fixtureIds, batchSize),
          concurrency,
          async (batch) => {
            await onRefreshResults(batch, forceRefresh);
          }
        );
      } catch (error) {
        setRefreshError(
          error instanceof Error
            ? error.message
            : 'Could not refresh match results.'
        );
      } finally {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) setIsRefreshing(false);
      }
    },
    [batchSize, concurrency, onRefreshResults]
  );

  useEffect(() => {
    const batch = pendingFixtureIds
      .filter((id) => !requestedResultsRef.current.has(id))
      .slice(0, batchSize);
    if (batch.length === 0) return;

    for (const id of batch) requestedResultsRef.current.add(id);
    void requestResults(batch);
  }, [pendingFixtureIds, requestResults, batchSize]);

  const refreshPending = useCallback(async () => {
    await requestResults(pendingFixtureIds, true);
  }, [pendingFixtureIds, requestResults]);

  const clearError = useCallback(() => setRefreshError(null), []);

  return {
    pendingFixtureIds,
    isRefreshing,
    refreshError,
    requestResults,
    refreshPending,
    clearError,
  };
}
