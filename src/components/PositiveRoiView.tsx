import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AccaStrategy } from '../types/fixtures.ts';
import type {
  QualifiedPicksResponse,
  RoiAccaResponse,
  RoiRegistryEntry,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';
import {
  SORT_ASC,
  makeSortHandler,
  sortRows,
  type SortState,
} from '../utils/tableSort.ts';
import { ErrorState, LoadingState } from './ui/States.tsx';
import {
  PositiveRoiOverview,
  PositiveRoiSectionNav,
  QualifiedPicksTable,
  ResearchTicketCard,
  SOURCE_LABELS,
  type PickFilter,
} from './analytics/PositiveRoiRegions.tsx';

interface PositiveRoiViewProps {
  strategy: AccaStrategy;
  selectedDate: string;
  displayDate: string;
  onGoToSlate: () => void;
}

/** Read-only research view of the promoted-ROI whitelist and its daily table. */
export function PositiveRoiView({
  strategy,
  selectedDate,
  displayDate,
  onGoToSlate,
}: PositiveRoiViewProps) {
  const [qualified, setQualified] = useState<QualifiedPicksResponse | null>(null);
  const [registry, setRegistry] = useState<RoiRegistryEntry[]>([]);
  const [ticket, setTicket] = useState<RoiAccaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<{
    scope: 'load' | 'generate';
    message: string;
  } | null>(null);
  const [pickFilter, setPickFilter] = useState<PickFilter>('all');
  const [sort, setSort] = useState<SortState>({ key: null, direction: SORT_ASC });
  const onSort = makeSortHandler(setSort);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [picks, reg] = await Promise.all([
        apiFetch<QualifiedPicksResponse>('/api/analytics/qualified-picks', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dateIso: selectedDate, strategy }),
        }),
        apiFetch<{ entries: RoiRegistryEntry[] }>('/api/analytics/roi-registry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ strategy }),
        }),
      ]);
      setQualified(picks);
      setRegistry(reg.entries);
      setTicket(null);
    } catch (err) {
      setError({
        scope: 'load',
        message: err instanceof Error ? err.message : 'Could not load ROI research data.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedDate, strategy]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBuilding(true);
    setError(null);
    try {
      setTicket(
        await apiFetch<RoiAccaResponse>('/api/analytics/roi-acca', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            dateIso: selectedDate,
            strategy,
            targetOdds: 5,
            maxLegs: 5,
          }),
        })
      );
    } catch (err) {
      setError({
        scope: 'generate',
        message: err instanceof Error ? err.message : 'Could not build the ROI accumulator.',
      });
    } finally {
      setBuilding(false);
    }
  };

  const promoted = registry.filter((entry) => entry.status === 'promoted');
  const filterCounts = useMemo(() => {
    const cards = qualified?.rows ?? [];
    return {
      all: cards.length,
      qualified: cards.filter((row) => row.eligibleForAcca).length,
      promoted: cards.filter((row) => row.status === 'promoted').length,
    };
  }, [qualified]);
  const rows = useMemo(() => {
    const source = (qualified?.rows ?? []).filter((row) =>
      pickFilter === 'qualified'
        ? row.eligibleForAcca
        : pickFilter === 'promoted'
          ? row.status === 'promoted'
          : true
    );
    return sortRows(source, sort, {
      fixture: (row) => `${row.homeTeam} ${row.awayTeam}`,
      kickoff: (row) => row.kickoffTimestamp,
      source: (row) => SOURCE_LABELS[row.source] ?? row.source,
      selection: (row) => row.selectionLabel,
      odds: (row) => row.odds,
      roi: (row) => row.roi,
      ci: (row) => row.roiCiLow,
      settled: (row) => row.settled,
      result: (row) => row.result ?? 'Pending',
      status: (row) => row.status,
      framework: (row) => row.frameworkStatus ?? '',
    });
  }, [qualified, pickFilter, sort]);

  return (
    <section aria-label="Positive ROI research" className="space-y-6">
      <PositiveRoiOverview
        displayDate={displayDate}
        qualified={qualified}
        promotedCount={promoted.length}
        registrySnapshot={registry[0]?.snapshotDateIso ?? null}
        loading={loading}
        building={building}
        onRefresh={() => void load()}
        onGenerate={() => void generate()}
        onGoToSlate={onGoToSlate}
      />
      <PositiveRoiSectionNav />

      {error && (
        <ErrorState
          title={
            error.scope === 'generate'
              ? 'Study accumulator could not be built'
              : 'ROI research data could not be loaded'
          }
          description={error.message}
          onRetry={() => void (error.scope === 'generate' ? generate() : load())}
          retryLabel={
            error.scope === 'generate' ? 'Retry building ticket' : 'Retry research load'
          }
        />
      )}

      {loading && !qualified && error?.scope !== 'load' ? (
        <LoadingState label="Loading ROI research cards…" count={4} />
      ) : (
        <>
          <ResearchTicketCard
            ticket={ticket}
            canGenerate={(qualified?.eligibleCount ?? 0) > 0 && !building && !loading}
            onGenerate={() => void generate()}
          />
          <QualifiedPicksTable
            rows={rows}
            pickFilter={pickFilter}
            onPickFilterChange={setPickFilter}
            filterCounts={filterCounts}
            sort={sort}
            onSort={onSort}
            loading={loading}
          />
        </>
      )}
    </section>
  );
}
