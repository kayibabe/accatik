import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccaStrategy, SettlementStatus } from '../types/fixtures.ts';
import type {
  QualifiedPicksResponse,
  RoiAccaResponse,
  RoiRegistryEntry,
  RoiRegistryStatus,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';
import {
  SORT_ASC,
  makeSortHandler,
  sortRows,
  type SortState,
} from '../utils/tableSort.ts';
import { ErrorState, LoadingState } from './ui/States.tsx';
import { CombinationRoiView } from './CombinationRoiView.tsx';
import {
  PositiveRoiOverview,
  PositiveRoiSectionNav,
  QualifiedPicksTable,
  ResearchTicketCard,
  SOURCE_LABELS,
  resolvePositiveRoiSection,
  type PickFilter,
} from './analytics/PositiveRoiRegions.tsx';

const SETTLEMENT_SORT_RANK: Record<SettlementStatus, number> = {
  Win: 5,
  Live: 4,
  Pending: 3,
  Void: 2,
  Lost: 1,
};

const REGISTRY_STATUS_SORT_RANK: Record<RoiRegistryStatus | 'untracked', number> = {
  promoted: 5,
  watch: 4,
  demoted: 3,
  retired: 2,
  untracked: 1,
};

interface PositiveRoiViewProps {
  strategy: AccaStrategy;
  selectedDate: string;
  displayDate: string;
  /** Deep-linkable page selected in the research tab strip. */
  activeSection?: string;
  onSectionChange: (id: string) => void;
  onGoToSlate: () => void;
}

/** Read-only research view of the promoted-ROI whitelist and its daily table. */
export function PositiveRoiView({
  strategy,
  selectedDate,
  displayDate,
  activeSection,
  onSectionChange,
  onGoToSlate,
}: PositiveRoiViewProps) {
  const currentSection = resolvePositiveRoiSection(activeSection);
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
  const [studyRefreshKey, setStudyRefreshKey] = useState(0);
  const [studyForce, setStudyForce] = useState(false);
  const onSort = makeSortHandler(setSort);
  // Keep a slow response for an older date/strategy from overwriting the new one.
  const loadRequestRef = useRef(0);
  const generateRequestRef = useRef(0);
  useEffect(
    () => () => {
      loadRequestRef.current += 1;
      generateRequestRef.current += 1;
    },
    []
  );

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    generateRequestRef.current += 1;
    setBuilding(false);
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
      if (requestId !== loadRequestRef.current) return;
      setQualified(picks);
      setRegistry(reg.entries);
      setTicket(null);
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setError({
        scope: 'load',
        message: err instanceof Error ? err.message : 'Could not load ROI research data.',
      });
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [selectedDate, strategy]);

  useEffect(() => {
    // The combination study owns its own data; avoid a redundant research fetch.
    if (currentSection === 'combination-roi') return;
    void load();
  }, [currentSection, load]);

  const generate = useCallback(async () => {
    const requestId = ++generateRequestRef.current;
    setBuilding(true);
    setError(null);
    try {
      const built = await apiFetch<RoiAccaResponse>('/api/analytics/roi-acca', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dateIso: selectedDate,
          strategy,
          targetOdds: 5,
          maxLegs: 5,
        }),
      });
      if (requestId !== generateRequestRef.current) return;
      setTicket(built);
    } catch (err) {
      if (requestId !== generateRequestRef.current) return;
      setError({
        scope: 'generate',
        message: err instanceof Error ? err.message : 'Could not build the ROI accumulator.',
      });
    } finally {
      if (requestId === generateRequestRef.current) setBuilding(false);
    }
  }, [selectedDate, strategy]);

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
      result: (row) => SETTLEMENT_SORT_RANK[row.result ?? 'Pending'],
      status: (row) => REGISTRY_STATUS_SORT_RANK[row.status],
      framework: (row) => row.frameworkStatus ?? '',
      reason: (row) => row.reason,
    });
  }, [qualified, pickFilter, sort]);

  if (currentSection === 'combination-roi') {
    return (
      <section aria-label="Combination ROI research" className="space-y-6">
        <PositiveRoiSectionNav
          activeId={currentSection}
          onSelect={onSectionChange}
        />
        <CombinationRoiView
          strategy={strategy}
          refreshKey={studyRefreshKey}
          force={studyForce}
          onReload={() => {
            setStudyRefreshKey((key) => key + 1);
            setStudyForce(true);
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Positive ROI research" className="space-y-6">
      <PositiveRoiSectionNav
        activeId={currentSection}
        onSelect={onSectionChange}
      />

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
      ) : currentSection === 'overview' ? (
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
      ) : currentSection === 'cards' ? (
        <ResearchTicketCard
          ticket={ticket}
          canGenerate={
            (qualified?.eligibleCount ?? 0) > 0 && !building && !loading
          }
          onGenerate={() => void generate()}
        />
      ) : (
        <QualifiedPicksTable
          rows={rows}
          pickFilter={pickFilter}
          onPickFilterChange={setPickFilter}
          filterCounts={filterCounts}
          sort={sort}
          onSort={onSort}
          loading={loading}
        />
      )}
    </section>
  );
}
