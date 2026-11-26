import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type {
  AnalyticsRefreshResult,
  MarketAnalyticsRow,
  PickAnalyticsResponse,
} from '../types/analytics.ts';
import type { AccaStrategy, MarketType } from '../types/fixtures.ts';
import { apiFetch } from '../utils/api.ts';
import { MARKET_SELECTION_CATALOG } from '../utils/marketSelection.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortState,
} from '../utils/tableSort.ts';
import { TicketReplayPanel } from './TicketReplayPanel.tsx';
import { AnalyticsHeader } from './analytics/AnalyticsHeader.tsx';
import {
  AnalyticsSectionNav,
  resolveAnalyticsSection,
} from './analytics/AnalyticsSectionNav.tsx';
import { AnalyticsSummaryCards } from './analytics/AnalyticsSummaryCards.tsx';
import { GradeFilterPanel } from './analytics/GradeFilterPanel.tsx';
import { FeaturedPicksTable } from './analytics/FeaturedPicksTable.tsx';
import { MarketAnalyticsTable } from './analytics/MarketAnalyticsTable.tsx';
import { CumulativePnlSection } from './analytics/CumulativePnlSection.tsx';
import { EmptyState, LoadingState } from './ui/States.tsx';
import {
  FEATURED_ACCESSORS,
  FEATURED_SOURCE_ORDER,
  SELECTION_ACCESSORS,
  bySelectionLabel,
  emptyFeaturedSelectionRow,
  emptySelectionRow,
  normalizeAnalytics,
  summarize,
  type FeaturedGroup,
  type MarketGroup,
} from './analytics/analyticsModel.ts';

interface AnalyticsViewProps {
  strategy: AccaStrategy;
  strategyName: string;
  /** Current slip controls, so the ticket replay can describe this shape too. */
  minOdds: number;
  maxLegs: number;
  /** Client-local matchday, used for "Today"/"Yesterday" labels. */
  todayDate: string;
  /** Matchday selected in the date bar, whose group opens by default. */
  selectedDate: string;
  /** Deep-linkable page selected in the analytics tab strip. */
  activeSection?: string;
  onSectionChange: (id: string) => void;
  onGoToSlate: () => void;
  /** Opens the top-level tab that owns daily qualifying picks. */
  onGoToPositiveReads?: () => void;
  /** Opens the standalone Research page for all promoted ROI studies. */
  onGoToRoiResearch?: (section?: string) => void;
}

export function AnalyticsView({
  strategy,
  strategyName,
  minOdds,
  maxLegs,
  todayDate,
  selectedDate,
  activeSection,
  onSectionChange,
  onGoToSlate,
  onGoToPositiveReads,
  onGoToRoiResearch,
}: AnalyticsViewProps) {
  const currentSection = resolveAnalyticsSection(activeSection);
  const [data, setData] = useState<PickAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleResponse, setStaleResponse] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [refreshingTables, setRefreshingTables] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [showEmptySelections, setShowEmptySelections] = useState(false);
  const [showEmptyFeaturedSelections, setShowEmptyFeaturedSelections] =
    useState(false);
  const [minProbability, setMinProbability] = useState(0);
  // Groups start collapsed; only the roll-up rows are visible until expanded.
  const [expandedMarketGroups, setExpandedMarketGroups] = useState<
    Record<string, boolean>
  >({});
  const [expandedFeaturedGroups, setExpandedFeaturedGroups] = useState<
    Record<string, boolean>
  >({});
  // No active column keeps the canonical market/selection order from the API.
  const [sort, setSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });
  const [featuredSort, setFeaturedSort] = useState<SortState>({
    key: null,
    direction: SORT_DESC,
  });

  const handleMarketSort = makeSortHandler(setSort, SORT_DESC);
  const handleFeaturedSort = makeSortHandler(setFeaturedSort, SORT_DESC);

  const toggleMarketGroup = (key: string) =>
    setExpandedMarketGroups((current) => ({ ...current, [key]: !current[key] }));
  const toggleFeaturedGroup = (key: string) =>
    setExpandedFeaturedGroups((current) => ({
      ...current,
      [key]: !current[key],
    }));

  /** Merge freshly published results into the archive, then reload every table. */
  const runRefresh = useCallback(async (force: boolean) => {
    setRefreshingTables(true);
    setRefreshError(null);
    try {
      const result = await apiFetch<AnalyticsRefreshResult>(
        '/api/analytics/refresh',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      setLastChecked(new Date().toISOString());
      if (result?.errors?.length) setRefreshError(result.errors.join(' · '));
      if (result?.changedDates?.length || force) {
        setForceRefresh(force);
        setRefreshKey((key) => key + 1);
      } else {
        // Nothing new landed. Drop a previous force flag so later reloads can
        // use the cache again; the tables keep the data they already have.
        setForceRefresh(false);
      }
    } catch (err) {
      setLastChecked(new Date().toISOString());
      setRefreshError(
        err instanceof Error ? err.message : 'Could not check for new results.'
      );
    } finally {
      setRefreshingTables(false);
    }
  }, []);

  const refreshFlightRef = useRef<Promise<void> | null>(null);
  const pendingForceRef = useRef(false);

  /**
   * One refresh at a time: mount, the five-minute poll and tab visibility can
   * all fire together. The endpoint is time-gated server-side, but coalescing
   * here stops duplicate client requests. A forced click during an in-flight
   * check is queued rather than dropped, so an explicit Reload still lands.
   */
  const refreshTables = useCallback(
    (force = false): Promise<void> => {
      if (refreshFlightRef.current) {
        if (force) pendingForceRef.current = true;
        return refreshFlightRef.current;
      }
      const flight = runRefresh(force).finally(() => {
        refreshFlightRef.current = null;
        if (pendingForceRef.current) {
          pendingForceRef.current = false;
          void refreshTables(true);
        }
      });
      refreshFlightRef.current = flight;
      return flight;
    },
    [runRefresh]
  );

  // A finished match changes the archive without this tab visiting a slate, so
  // check on load, while open, and as soon as the tab becomes visible again.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    void refreshTables(false);
    const interval = window.setInterval(
      () => void refreshTables(false),
      5 * 60 * 1000
    );
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshTables(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refreshTables]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiFetch<PickAnalyticsResponse>(
          '/api/analytics/picks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strategy, force: forceRefresh }),
          }
        );
        if (!cancelled) {
          const normalized = normalizeAnalytics(result);
          setStaleResponse(normalized.staleResponse);
          setData(normalized.data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Could not load analytics.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy, refreshKey, forceRefresh]);

  const featuredSummary = useMemo(
    () => (data ? summarize(data.featured) : null),
    [data]
  );
  const marketSummary = useMemo(
    () => (data ? summarize(data.marketsByType) : null),
    [data]
  );
  const marketGroups = useMemo<MarketGroup[]>(() => {
    if (!data) return [];
    const byType = new Map<MarketType, MarketAnalyticsRow[]>();
    for (const row of data.marketsBySelection) {
      const list = byType.get(row.marketType) ?? [];
      list.push(row);
      byType.set(row.marketType, list);
    }
    const passesProbability = (row: MarketAnalyticsRow) =>
      minProbability === 0 ||
      (row.avgProbability !== null && row.avgProbability >= minProbability);

    const groups: MarketGroup[] = [];
    for (const typeRow of sortRows(data.marketsByType, sort, SELECTION_ACCESSORS)) {
      const priced = byType.get(typeRow.marketType) ?? [];
      let selections = priced;
      if (showEmptySelections) {
        const byKey = new Map(priced.map((row) => [row.key, row]));
        selections = MARKET_SELECTION_CATALOG.filter(
          (selection) => selection.marketType === typeRow.marketType
        ).map(
          (selection) => byKey.get(selection.key) ?? emptySelectionRow(selection)
        );
      }
      const matching = sortRows(selections, sort, SELECTION_ACCESSORS).filter(
        passesProbability
      );
      // A market type stays visible when at least one of its selections clears
      // the floor, even when the type's own average does not.
      if (matching.length === 0) continue;
      groups.push({ typeRow, selections: matching });
    }
    return groups;
  }, [data, sort, showEmptySelections, minProbability]);

  const featuredGroups = useMemo<FeaturedGroup[]>(() => {
    if (!data) return [];
    const bySource = new Map<
      FeaturedGroup['source'],
      (typeof data.featuredBySelection)[number][]
    >();
    for (const row of data.featuredBySelection) {
      const list = bySource.get(row.source) ?? [];
      list.push(row);
      bySource.set(row.source, list);
    }
    return data.featured.map((row, index) => {
      const source =
        FEATURED_SOURCE_ORDER[index] ?? (row.key as FeaturedGroup['source']);
      // Canonical order matches the individual-market table: 1X2, goals
      // ladder, BTTS, Double Chance, Draw No Bet, then anything unfamiliar.
      const priced = [...(bySource.get(source) ?? [])].sort(bySelectionLabel);
      let selections = priced;
      if (showEmptyFeaturedSelections) {
        const bySelection = new Map(
          priced.map((selection) => [selection.selectionKey, selection])
        );
        const catalogKeys = new Set(
          MARKET_SELECTION_CATALOG.map((selection) => selection.key)
        );
        selections = [
          ...MARKET_SELECTION_CATALOG.map(
            (selection) =>
              bySelection.get(selection.key) ??
              emptyFeaturedSelectionRow(source, selection)
          ),
          // The resolver keeps unfamiliar bets in their own stable row; do not
          // lose them just because they are outside the published catalogue.
          ...priced.filter((row) => !catalogKeys.has(row.selectionKey)),
        ];
      }
      return {
        source,
        row,
        selections: sortRows(selections, featuredSort, FEATURED_ACCESSORS),
      };
    });
  }, [data, featuredSort, showEmptyFeaturedSelections]);

  const selectionInsight = useMemo(() => {
    const qualified = (data?.marketsBySelection ?? []).filter(
      (row) => row.settled >= 20 && row.roi !== null
    );
    if (qualified.length === 0) return null;
    const byRoi = [...qualified].sort((a, b) => (b.roi ?? 0) - (a.roi ?? 0));
    return {
      best: byRoi[0],
      worst: byRoi[byRoi.length - 1],
    };
  }, [data]);

  const matchingSelectionCount = marketGroups.reduce(
    (total, group) => total + group.selections.length,
    0
  );
  const allMarketsExpanded =
    marketGroups.length > 0 &&
    marketGroups.every((group) => expandedMarketGroups[group.typeRow.key]);
  const allFeaturedExpanded =
    featuredGroups.length > 0 &&
    featuredGroups.every((group) => expandedFeaturedGroups[group.source]);

  const refreshNow = () => void refreshTables(true);

  const openDetailTab = (
    tab: 'positive-reads' | 'roi-research',
    section?: string
  ) => {
    if (tab === 'positive-reads') {
      if (onGoToPositiveReads) {
        onGoToPositiveReads();
        return;
      }
    } else if (onGoToRoiResearch) {
      onGoToRoiResearch(section);
      return;
    }
    // Fallback for callers that have not wired the callback yet: the app has no
    // router, but its popstate handler reads the tab straight from the URL.
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    if (section) params.set('section', section);
    else params.delete('section');
    window.history.pushState(
      null,
      '',
      `${window.location.pathname}?${params.toString()}`
    );
    window.dispatchEvent(new Event('popstate'));
  };

  const detailSection =
    currentSection === 'positive-reads' || currentSection === 'research'
      ? currentSection
      : null;
  const isCombinationStudy = detailSection === 'research';

  return (
    <section aria-label="Analytics" className="space-y-6">
      <AnalyticsHeader
        strategyName={strategyName}
        data={data}
        error={error}
        refreshError={refreshError}
        staleResponse={staleResponse}
        loading={loading}
        refreshingTables={refreshingTables}
        lastChecked={lastChecked}
        onRefresh={refreshNow}
        onGoToSlate={onGoToSlate}
      />
      <AnalyticsSectionNav
        activeId={currentSection}
        onSelect={onSectionChange}
      />

      {detailSection && (
        <section
          id={detailSection}
          aria-label={isCombinationStudy ? 'Combination ROI' : 'Positive Reads'}
          className="rounded-xl border border-slate-200 bg-white px-4 py-4"
        >
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-600">
            {isCombinationStudy ? 'Combination ROI' : 'Positive Reads'}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-700">
            {isCombinationStudy
              ? 'The promoted ROI picks and Combination ROI study live on the Promoted ROI Picks page under Research. Analytics here stays focused on aggregate and archive views.'
              : 'Daily qualifying picks live under the top-level Positive Reads tab. Analytics here stays focused on aggregate and archive views.'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (isCombinationStudy) {
                openDetailTab('roi-research', 'combination-roi');
              } else {
                openDetailTab('positive-reads');
              }
            }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            {isCombinationStudy ? 'Open Promoted ROI Picks' : 'Open Positive Reads'}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </section>
      )}

      {loading && !data ? (
        <LoadingState label="Loading global analytics archive…" count={6} />
      ) : !data ? (
        <EmptyState
          title="No analytics available yet"
          description="Rebuild the archive with settled results to see hit rates, net P&L and ROI. Results appear after matchdays settle — refresh the archive."
          action={
            <button
              type="button"
              onClick={refreshNow}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
            >
              Refresh archive
            </button>
          }
        />
      ) : data.sampleDates === 0 ? (
        <EmptyState
          title="No settled picks in the archive yet"
          description="Once matchdays finish and results are collected, their hit rate, net P&L and ROI will appear here. Refresh the archive after new results settle."
          action={
            <button
              type="button"
              onClick={refreshNow}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Refresh archive
            </button>
          }
        />
      ) : (
        <>
          {currentSection === 'summary' && (
            <>
              <AnalyticsSummaryCards
                data={data}
                featuredSummary={featuredSummary!}
                marketSummary={marketSummary!}
              />
              <CumulativePnlSection days={data.daily} />
            </>
          )}

          {currentSection === 'featured' && (
            <FeaturedPicksTable
              groups={featuredGroups}
              summary={featuredSummary!}
              totalSettled={data.featured.reduce(
                (sum, row) => sum + row.settled,
                0
              )}
              strategyName={strategyName}
              sort={featuredSort}
              onSort={handleFeaturedSort}
              expandedGroups={expandedFeaturedGroups}
              onToggleGroup={toggleFeaturedGroup}
              onToggleAll={() =>
                setExpandedFeaturedGroups(
                  allFeaturedExpanded
                    ? {}
                    : Object.fromEntries(
                        featuredGroups.map((group) => [group.source, true])
                      )
                )
              }
              allExpanded={allFeaturedExpanded}
              showEmpty={showEmptyFeaturedSelections}
              onShowEmptyChange={setShowEmptyFeaturedSelections}
            />
          )}

          {currentSection === 'markets' && (
            <MarketAnalyticsTable
              groups={marketGroups}
              summary={marketSummary!}
              totalPicks={data.marketPicks}
              insight={selectionInsight}
              sort={sort}
              onSort={handleMarketSort}
              expandedGroups={expandedMarketGroups}
              onToggleGroup={toggleMarketGroup}
              onToggleAll={() =>
                setExpandedMarketGroups(
                  allMarketsExpanded
                    ? {}
                    : Object.fromEntries(
                        marketGroups.map((group) => [group.typeRow.key, true])
                      )
                )
              }
              allExpanded={allMarketsExpanded}
              showEmpty={showEmptySelections}
              onShowEmptyChange={setShowEmptySelections}
              minProbability={minProbability}
              onMinProbabilityChange={setMinProbability}
              matchingSelectionCount={matchingSelectionCount}
            />
          )}

          {currentSection === 'replay' && (
            <section id="replay" aria-label="Ticket replay">
              <TicketReplayPanel
                strategy={strategy}
                minOdds={minOdds}
                maxLegs={maxLegs}
                refreshKey={refreshKey}
              />
            </section>
          )}

          {currentSection === 'grade-filter' && (
            <section id="grade-filter" aria-label="High and Solid grade filter archive">
              <GradeFilterPanel
                strategy={strategy}
                refreshKey={refreshKey}
                todayDate={todayDate}
                selectedDate={selectedDate}
              />
            </section>
          )}

        </>
      )}
    </section>
  );
}
