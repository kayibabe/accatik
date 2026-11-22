import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  ChevronRight,
  Info,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  AnalyticsRefreshResult,
  FeaturedAnalyticsRow,
  FeaturedPickSource,
  PickAnalyticsDay,
  PickAnalyticsResponse,
  PickAnalyticsRow,
  MarketAnalyticsRow,
} from '../types/analytics.ts';
import type { AccaStrategy, MarketType } from '../types/fixtures.ts';
import { apiFetch } from '../utils/api.ts';
import {
  compareSelections,
  MARKET_SELECTION_CATALOG,
} from '../utils/marketSelection.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import { SortableTh } from './SortableTh.tsx';
import { TicketReplayPanel } from './TicketReplayPanel.tsx';
import { CombinationRoiView } from './CombinationRoiView.tsx';

interface AnalyticsViewProps {
  strategy: AccaStrategy;
  strategyName: string;
  /** Current slip controls, so the ticket replay can describe this shape too. */
  minOdds: number;
  maxLegs: number;
  onGoToSlate: () => void;
}

type MarketTableRow = MarketAnalyticsRow;

interface MarketGroup {
  typeRow: MarketAnalyticsRow;
  selections: MarketAnalyticsRow[];
}

interface FeaturedGroup {
  source: FeaturedPickSource;
  row: PickAnalyticsRow;
  selections: FeaturedAnalyticsRow[];
}

const FEATURED_SOURCE_ORDER: FeaturedPickSource[] = ['angle', 'cover', 'note'];

/** Win-probability floors offered above the individual-markets table. */
const MARKET_PROBABILITY_FILTERS: readonly number[] = [
  0, 30, 40, 50, 60, 70, 80, 90,
];

/** Stable DOM id for a group's collapsible panel. */
const groupPanelId = (prefix: string, key: string): string =>
  `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const MARKET_TYPES: MarketType[] = [
  '1X2',
  'Double Chance',
  'Goals',
  'BTTS',
  'Draw No Bet',
];

const MARKET_TYPE_BY_KEY_PREFIX: Record<string, MarketType> = {
  '1X2': '1X2',
  GOALS: 'Goals',
  BTTS: 'BTTS',
  DC: 'Double Chance',
  DNB: 'Draw No Bet',
};

function inferMarketType(key: string): MarketType | null {
  const direct = MARKET_TYPES.find((type) => type === key);
  if (direct) return direct;
  return MARKET_TYPE_BY_KEY_PREFIX[key.split('-')[0].toUpperCase()] ?? null;
}

/**
 * Older Functions published average odds but not fair probability. Derive a
 * usable fallback so the probability filter still works before redeployment.
 * (1 / average odds is the raw implied probability, so it runs a little above
 * the margin-adjusted value.)
 */
function withProbabilityFallback<T extends PickAnalyticsRow>(row: T): T {
  if (typeof row.avgProbability === 'number') return row;
  return {
    ...row,
    avgProbability:
      row.avgOdds !== null && row.avgOdds > 0
        ? Math.round((100 / row.avgOdds) * 10) / 10
        : null,
  };
}

/**
 * The site and the API Function deploy independently. Older Functions predate
 * the selection rollups, so missing fields must degrade gracefully instead of
 * throwing inside render and blanking the whole app.
 */
function normalizeAnalytics(raw: PickAnalyticsResponse): {
  data: PickAnalyticsResponse;
  staleResponse: boolean;
} {
  const source = raw as Partial<PickAnalyticsResponse> | null;
  const staleResponse =
    !source ||
    !Array.isArray(source.featuredBySelection) ||
    !Array.isArray(source.marketsByType) ||
    source.marketsByType.some((row) => !row.marketType);
  const safe = source ?? {};

  return {
    staleResponse,
    data: {
      strategy: safe.strategy ?? 'balanced',
      generatedAt: safe.generatedAt ?? '',
      firstDateIso: safe.firstDateIso ?? null,
      lastDateIso: safe.lastDateIso ?? null,
      sampleDates: safe.sampleDates ?? 0,
      sampleFixtures: safe.sampleFixtures ?? 0,
      marketPicks: safe.marketPicks ?? 0,
      stakePerPick: safe.stakePerPick ?? 1,
      priceQuality: {
        prematch: safe.priceQuality?.prematch ?? 0,
        live: safe.priceQuality?.live ?? 0,
        unknown: safe.priceQuality?.unknown ?? 0,
      },
      featured: Array.isArray(safe.featured)
        ? safe.featured.map(withProbabilityFallback)
        : [],
      featuredBySelection: Array.isArray(safe.featuredBySelection)
        ? safe.featuredBySelection.map(withProbabilityFallback)
        : [],
      marketsByType: (Array.isArray(safe.marketsByType)
        ? safe.marketsByType
        : []
      ).map((row) => ({
        ...withProbabilityFallback(row),
        marketType: row.marketType ?? inferMarketType(row.key) ?? '1X2',
      })),
      marketsBySelection: (Array.isArray(safe.marketsBySelection)
        ? safe.marketsBySelection
        : []
      ).map((row) => ({
        ...withProbabilityFallback(row),
        marketType: row.marketType ?? inferMarketType(row.key) ?? '1X2',
      })),
      daily: Array.isArray(safe.daily) ? safe.daily : [],
    },
  };
}

interface Summary {
  wins: number;
  losses: number;
  voids: number;
  stake: number;
  returns: number;
  netPnl: number;
  hitRate: number | null;
  roi: number | null;
}

const percent = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(1)}%`;

const signedPercent = (value: number | null): string => {
  if (value === null) return '—';
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return '0.0%';
};

const signedUnits = (value: number): string =>
  `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(2)}u`;

const pnlTone = (value: number): string =>
  value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-600' : 'text-slate-700';

const recordLabel = (won: number, lost: number, voided: number): string =>
  `${won}W · ${lost}L · ${voided}V`;

function shortDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (!year || !month || !day) return dateIso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function summarize(rows: PickAnalyticsRow[]): Summary {
  let wins = 0;
  let losses = 0;
  let voids = 0;
  let stake = 0;
  let returns = 0;
  let netPnl = 0;
  for (const row of rows) {
    wins += row.wins;
    losses += row.losses;
    voids += row.voids;
    stake += row.stake;
    returns += row.returns;
    netPnl += row.netPnl;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    voids,
    stake,
    returns,
    netPnl,
    hitRate: decided > 0 ? (wins / decided) * 100 : null,
    roi: stake > 0 ? (netPnl / stake) * 100 : null,
  };
}

function emptySelectionRow(
  selection: (typeof MARKET_SELECTION_CATALOG)[number]
): MarketAnalyticsRow {
  return {
    key: selection.key,
    label: selection.label,
    marketType: selection.marketType,
    settled: 0,
    wins: 0,
    losses: 0,
    voids: 0,
    hitRate: null,
    stake: 0,
    returns: 0,
    netPnl: 0,
    roi: null,
    avgOdds: null,
    avgProbability: null,
  };
}

function emptyFeaturedSelectionRow(
  source: FeaturedPickSource,
  selection: (typeof MARKET_SELECTION_CATALOG)[number]
): FeaturedAnalyticsRow {
  return {
    ...emptySelectionRow(selection),
    key: `${source}:${selection.key}`,
    source,
    selectionKey: selection.key,
  };
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'text-slate-900',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 text-lg font-bold font-mono tabular-nums ${tone}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">{detail}</p>
    </div>
  );
}

function HitRateCell({ value }: { value: number | null }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div
        className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }}
        />
      </div>
      <span className="w-12 text-right font-mono font-semibold text-slate-800 tabular-nums">
        {percent(value)}
      </span>
    </div>
  );
}

function MarketRow({
  label,
  row,
  variant = 'selection',
}: {
  label: ReactNode;
  row: PickAnalyticsRow;
  variant?: 'total' | 'group' | 'selection';
}) {
  const tone =
    variant === 'total'
      ? 'bg-emerald-50/70 text-emerald-950 font-semibold'
      : variant === 'group'
        ? 'bg-slate-50/90 text-slate-800 font-semibold'
        : 'text-slate-700 hover:bg-slate-50/60';
  return (
    <tr className={tone}>
      <td className="px-4 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">
        {row.settled}
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {recordLabel(row.wins, row.losses, row.voids)}
      </td>
      <td className="px-3 py-2 text-right">
        <HitRateCell value={row.hitRate} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {row.avgProbability === null ? '—' : `${row.avgProbability.toFixed(1)}%`}
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {row.avgOdds === null ? '—' : row.avgOdds.toFixed(2)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(row.netPnl)}`}
      >
        {signedUnits(row.netPnl)}
      </td>
      <td
        className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(row.roi ?? 0)}`}
      >
        {signedPercent(row.roi)}
      </td>
    </tr>
  );
}

/** Same columns as the featured roll-up, reused for its selection drill-down. */
function FeaturedRow({
  label,
  row,
  variant = 'selection',
}: {
  label: ReactNode;
  row: PickAnalyticsRow;
  variant?: 'total' | 'group' | 'selection';
}) {
  const tone =
    variant === 'total'
      ? 'bg-emerald-50/70 text-emerald-950 font-semibold'
      : variant === 'group'
        ? 'bg-slate-50/90 text-slate-800 font-semibold'
        : 'text-slate-700 hover:bg-slate-50/60';
  return (
    <tr className={tone}>
      <td className="px-4 py-2 font-medium">{label}</td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {recordLabel(row.wins, row.losses, row.voids)}
      </td>
      <td className="px-3 py-2 text-right">
        <HitRateCell value={row.hitRate} />
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {row.stake.toFixed(0)}u
      </td>
      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
        {row.returns.toFixed(2)}u
      </td>
      <td
        className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(row.netPnl)}`}
      >
        {signedUnits(row.netPnl)}
      </td>
      <td
        className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${pnlTone(row.roi ?? 0)}`}
      >
        {signedPercent(row.roi)}
      </td>
      <td className="px-4 py-2 text-right font-mono text-slate-600 tabular-nums">
        {row.avgOdds === null ? '—' : row.avgOdds.toFixed(2)}
      </td>
    </tr>
  );
}

/** Dependency-free equity curve, matching the existing activity chart style. */
function EquityChart({ days }: { days: PickAnalyticsDay[] }) {
  const [series, setSeries] = useState<'featured' | 'markets'>('featured');
  const values = days.map((day) =>
    series === 'featured' ? day.cumulativeFeatured : day.cumulativeMarkets
  );
  const last = values[values.length - 1] ?? 0;

  if (days.length <= 1) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
        <p className="px-4 text-center text-xs text-slate-400">
          More settled matchdays are needed to plot a curve.
        </p>
      </div>
    );
  }

  const width = 640;
  const height = 160;
  const padX = 10;
  const padY = 16;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = Math.max(1, max - min);
  const step = (width - padX * 2) / (values.length - 1);
  const toY = (value: number) =>
    padY + ((max - value) / range) * (height - padY * 2);
  const coordinates = values.map((value, index) => ({
    x: padX + index * step,
    y: toY(value),
  }));
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const area = [
    `M ${coordinates[0].x} ${coordinates[0].y}`,
    ...coordinates.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${coordinates[coordinates.length - 1].x} ${height - padY}`,
    `L ${coordinates[0].x} ${height - padY}`,
    'Z',
  ].join(' ');
  const tone = last >= 0 ? '#047857' : '#dc2626';

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(
            [
              ['featured', 'Featured picks'],
              ['markets', 'All markets'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSeries(id)}
              aria-pressed={series === id}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                series === id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className={`font-mono text-lg font-bold tabular-nums ${pnlTone(last)}`}>
          {signedUnits(last)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Cumulative ${series === 'featured' ? 'featured pick' : 'market pick'} P&L from zero to ${signedUnits(last)} over ${days.length} matchdays`}
        className="mt-2 h-40 w-full"
        preserveAspectRatio="none"
      >
        <line
          x1={padX}
          y1={toY(0)}
          x2={width - padX}
          y2={toY(0)}
          stroke="#cbd5e1"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={area}
          fill={last >= 0 ? '#10b981' : '#ef4444'}
          opacity={0.1}
        />
        <polyline
          points={line}
          fill="none"
          stroke={tone}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
        <span>{shortDate(days[0].dateIso)}</span>
        <span>zero line</span>
        <span>{shortDate(days[days.length - 1].dateIso)}</span>
      </div>
    </div>
  );
}

const SELECTION_ACCESSORS: SortAccessors<MarketTableRow> = {
  label: (row) => row.label,
  marketType: (row) => row.marketType ?? null,
  settled: (row) => row.settled,
  record: (row) => recordLabel(row.wins, row.losses, row.voids),
  wins: (row) => row.wins,
  losses: (row) => row.losses,
  voids: (row) => row.voids,
  hitRate: (row) => row.hitRate,
  avgProbability: (row) => row.avgProbability,
  avgOdds: (row) => row.avgOdds,
  stake: (row) => row.stake,
  returns: (row) => row.returns,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
};

const FEATURED_ACCESSORS: SortAccessors<FeaturedAnalyticsRow> = {
  label: (row) => row.label,
  selectionKey: (row) => row.selectionKey,
  settled: (row) => row.settled,
  record: (row) => recordLabel(row.wins, row.losses, row.voids),
  wins: (row) => row.wins,
  losses: (row) => row.losses,
  voids: (row) => row.voids,
  hitRate: (row) => row.hitRate,
  stake: (row) => row.stake,
  returns: (row) => row.returns,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
  avgOdds: (row) => row.avgOdds,
};

export function AnalyticsView({
  strategy,
  strategyName,
  minOdds,
  maxLegs,
  onGoToSlate,
}: AnalyticsViewProps) {
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

  /**
   * Merge freshly published results into the archive, then reload every table.
   * The endpoint is time-gated server-side, so polling while this tab is open
   * cannot turn into a stream of upstream feed calls.
   */
  const refreshTables = useCallback(async (force = false) => {
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
    const bySource = new Map<FeaturedPickSource, FeaturedAnalyticsRow[]>();
    for (const row of data.featuredBySelection) {
      const list = bySource.get(row.source) ?? [];
      list.push(row);
      bySource.set(row.source, list);
    }
    return data.featured.map((row, index) => {
      const source =
        FEATURED_SOURCE_ORDER[index] ?? (row.key as FeaturedPickSource);
      // Canonical order matches the individual-market table: 1X2, goals
      // ladder, BTTS, Double Chance, Draw No Bet, then anything unfamiliar.
      const priced = [...(bySource.get(source) ?? [])].sort((a, b) =>
        compareSelections(
          { ...a, key: a.selectionKey },
          { ...b, key: b.selectionKey }
        )
      );
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

  return (
    <section aria-label="Analytics" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Global record · since data collection began
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Analytics
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Featured picks: {strategyName} strategy ·{' '}
            {data?.firstDateIso && data.lastDateIso
              ? `${shortDate(data.firstDateIso)} – ${shortDate(data.lastDateIso)}`
              : '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="text-[11px] text-slate-400"
            title="Archived results are checked on load, every 5 minutes, and when this tab becomes visible again."
          >
            {refreshingTables
              ? 'Checking for new results…'
              : lastChecked
                ? `Checked ${new Date(lastChecked).toLocaleTimeString()}`
                : 'Checking for new results…'}
          </span>
          <button
            type="button"
            onClick={() => void refreshTables(true)}
            disabled={loading || refreshingTables}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshingTables ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={onGoToSlate}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
          >
            Back to Today&apos;s Slate
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refreshTables(true)}
            className="font-semibold underline cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {refreshError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Result check: {refreshError}
        </div>
      )}

      {staleResponse && data && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          The API Function is running an older analytics version, so selection
          drill-downs are unavailable. Redeploy the Function to see the full
          breakdown.
        </div>
      )}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div
              key={item}
              className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse"
            />
          ))}
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-900">
            No analytics available yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Rebuild the archive with settled results to see hit rates, net P&amp;L
            and ROI.
          </p>
        </div>
      ) : data.sampleDates === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <BarChart3 className="mx-auto h-6 w-6 text-slate-300" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-900">
            No settled picks in the archive yet
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Once matchdays finish and results are collected, their hit rate,
            net P&amp;L and ROI will appear here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-relaxed text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <p>
              Rebuilt from {data.sampleDates} archived matchdays and{' '}
              {data.sampleFixtures} finished priced fixtures. Every pick is
              settled at a flat {data.stakePerPick}-unit stake; voids return
              their stake and are excluded from hit rate, ROI, stake and
              returns. Featured picks
              are a subset of the individual markets, so the two sections
              overlap. Of {data.marketPicks} market picks,{' '}
              {data.priceQuality.prematch} were captured pre-match,{' '}
              {data.priceQuality.live} after kickoff and{' '}
              {data.priceQuality.unknown} with unknown capture time.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard
              label="Featured hit rate"
              value={percent(featuredSummary?.hitRate ?? null)}
              detail={`${featuredSummary?.wins ?? 0}W · ${featuredSummary?.losses ?? 0}L`}
            />
            <MetricCard
              label="Featured net P&L"
              value={signedUnits(featuredSummary?.netPnl ?? 0)}
              detail="angle + cover + note"
              tone={pnlTone(featuredSummary?.netPnl ?? 0)}
            />
            <MetricCard
              label="Featured ROI"
              value={signedPercent(featuredSummary?.roi ?? null)}
              detail={`${(featuredSummary?.stake ?? 0).toFixed(0)}u risked`}
              tone={pnlTone(featuredSummary?.roi ?? 0)}
            />
            <MetricCard
              label="Market hit rate"
              value={percent(marketSummary?.hitRate ?? null)}
              detail={`${marketSummary?.wins ?? 0}W · ${marketSummary?.losses ?? 0}L`}
            />
            <MetricCard
              label="Market net P&L"
              value={signedUnits(marketSummary?.netPnl ?? 0)}
              detail={`${data.marketPicks} settled picks`}
              tone={pnlTone(marketSummary?.netPnl ?? 0)}
            />
            <MetricCard
              label="Market ROI"
              value={signedPercent(marketSummary?.roi ?? null)}
              detail={`${(marketSummary?.stake ?? 0).toFixed(0)}u risked`}
              tone={pnlTone(marketSummary?.roi ?? 0)}
            />
          </div>

          <CombinationRoiView
            strategy={strategy}
            refreshKey={refreshKey}
            force={forceRefresh}
            onReload={() => void refreshTables(true)}
          />

          <TicketReplayPanel
            strategy={strategy}
            minOdds={minOdds}
            maxLegs={maxLegs}
            refreshKey={refreshKey}
          />

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Featured picks
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Recommended Angle, Safer cover and Analyst note, each split
                  into the selections they backed with the {strategyName}{' '}
                  strategy.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showEmptyFeaturedSelections}
                    onChange={(event) =>
                      setShowEmptyFeaturedSelections(event.target.checked)
                    }
                    className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-700"
                  />
                  Show lines with no picks yet
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedFeaturedGroups(
                      allFeaturedExpanded
                        ? {}
                        : Object.fromEntries(
                            featuredGroups.map((group) => [group.source, true])
                          )
                    )
                  }
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                >
                  {allFeaturedExpanded ? 'Collapse all' : 'Expand all'}
                </button>
                <span className="text-[11px] text-slate-400">
                  1u flat stake per pick
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <SortableTh
                      label="Pick / selection"
                      columnKey="label"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="left"
                      className="px-4 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Record"
                      columnKey="record"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Hit rate"
                      columnKey="hitRate"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Stake"
                      columnKey="stake"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Returns"
                      columnKey="returns"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Net P&L"
                      columnKey="netPnl"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="ROI"
                      columnKey="roi"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Avg odds"
                      columnKey="avgOdds"
                      sort={featuredSort}
                      onSort={handleFeaturedSort}
                      align="right"
                      className="px-4 py-2 font-semibold"
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <FeaturedRow
                    variant="total"
                    label={
                      <span className="flex items-center gap-2">
                        All featured picks
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                          overall
                        </span>
                      </span>
                    }
                    row={{
                      key: 'all-featured',
                      label: 'All featured picks',
                      settled: data.featured.reduce(
                        (sum, row) => sum + row.settled,
                        0
                      ),
                      wins: featuredSummary?.wins ?? 0,
                      losses: featuredSummary?.losses ?? 0,
                      voids: featuredSummary?.voids ?? 0,
                      hitRate: featuredSummary?.hitRate ?? null,
                      stake: featuredSummary?.stake ?? 0,
                      returns: featuredSummary?.returns ?? 0,
                      netPnl: featuredSummary?.netPnl ?? 0,
                      roi: featuredSummary?.roi ?? null,
                      avgOdds: null,
                      avgProbability: null,
                    }}
                  />
                </tbody>
                {featuredGroups.map((group) => {
                    const selections = showEmptyFeaturedSelections
                      ? group.selections
                      : group.selections.filter((row) => row.settled > 0);
                    if (selections.length === 0) return null;
                    const isExpanded = Boolean(
                      expandedFeaturedGroups[group.source]
                    );
                    return (
                      <tbody
                        key={group.source}
                        id={groupPanelId('featured-group', group.source)}
                        className="divide-y divide-slate-100 border-t border-slate-100"
                      >
                        <FeaturedRow
                          variant="group"
                          label={
                            <button
                              type="button"
                              onClick={() => toggleFeaturedGroup(group.source)}
                              aria-expanded={isExpanded}
                              aria-controls={groupPanelId(
                                'featured-group',
                                group.source
                              )}
                              className="flex w-full items-center gap-2 text-left cursor-pointer hover:text-slate-950"
                            >
                              <ChevronRight
                                className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                  isExpanded ? 'rotate-90' : ''
                                }`}
                                aria-hidden="true"
                              />
                              <span>{group.row.label}</span>
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                {selections.length} lines
                              </span>
                              <span className="text-[10px] font-normal text-slate-400">
                                {group.row.settled} settled
                              </span>
                            </button>
                          }
                          row={group.row}
                        />
                        {isExpanded &&
                          selections.map((row) => (
                            <FeaturedRow
                              key={row.key}
                              label={
                                <span className="flex items-center gap-2">
                                  <span
                                    className="ml-3 h-1 w-1 shrink-0 rounded-full bg-slate-300"
                                    aria-hidden="true"
                                  />
                                  {row.label}
                                </span>
                              }
                              row={row}
                            />
                          ))}
                      </tbody>
                    );
                  })}
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              Roll-up rows repeat their selections&apos; totals. Selections use
              the same Home/Draw/Away, goal-line, BTTS, Double Chance and DNB
              identities as the individual-market table. Groups are collapsed
              by default — click a heading to drill down. Click a column
              heading to sort.
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                    Individual markets
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Every priced selection, rolled up by market then broken into
                    Home/Away, goal lines, BTTS sides, Double Chance and DNB.
                  </p>
                  {selectionInsight && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Best ROI (min 20 picks):{' '}
                      <span className="font-semibold text-emerald-700">
                        {selectionInsight.best.label} {signedPercent(selectionInsight.best.roi)}
                      </span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      Weakest:{' '}
                      <span className="font-semibold text-red-600">
                        {selectionInsight.worst.label} {signedPercent(selectionInsight.worst.roi)}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showEmptySelections}
                      onChange={(event) => setShowEmptySelections(event.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-700"
                    />
                    Show lines with no picks yet
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMarketGroups(
                        allMarketsExpanded
                          ? {}
                          : Object.fromEntries(
                              marketGroups.map((group) => [group.typeRow.key, true])
                            )
                      )
                    }
                    className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    {allMarketsExpanded ? 'Collapse all' : 'Expand all'}
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-[11px] font-semibold text-slate-500">
                  Market win probability
                </span>
                <div
                  role="group"
                  aria-label="Filter markets by win probability"
                  className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                >
                  {MARKET_PROBABILITY_FILTERS.map((threshold) => (
                    <button
                      key={threshold}
                      type="button"
                      onClick={() => setMinProbability(threshold)}
                      aria-pressed={minProbability === threshold}
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                        minProbability === threshold
                          ? 'bg-white text-emerald-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {threshold === 0 ? 'Any' : `≥${threshold}%`}
                    </button>
                  ))}
                </div>
                {minProbability > 0 && (
                  <span className="text-[11px] text-slate-400">
                    {matchingSelectionCount} matching selection
                    {matchingSelectionCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <SortableTh
                      label="Market / selection"
                      columnKey="label"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="left"
                      className="px-4 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Picks"
                      columnKey="settled"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="W-L-V"
                      columnKey="record"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Hit rate"
                      columnKey="hitRate"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Win prob"
                      columnKey="avgProbability"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                      title="Average margin-adjusted win probability at the prices taken"
                    />
                    <SortableTh
                      label="Avg odds"
                      columnKey="avgOdds"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="Net P&L"
                      columnKey="netPnl"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-3 py-2 font-semibold"
                    />
                    <SortableTh
                      label="ROI"
                      columnKey="roi"
                      sort={sort}
                      onSort={handleMarketSort}
                      align="right"
                      className="px-4 py-2 font-semibold"
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <MarketRow
                    variant="total"
                    label={
                      <span className="flex items-center gap-2">
                        All markets
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                          overall
                        </span>
                      </span>
                    }
                    row={{
                      key: 'all-markets',
                      label: 'All markets',
                      settled: data.marketPicks,
                      wins: marketSummary?.wins ?? 0,
                      losses: marketSummary?.losses ?? 0,
                      voids: marketSummary?.voids ?? 0,
                      hitRate: marketSummary?.hitRate ?? null,
                      stake: marketSummary?.stake ?? 0,
                      returns: (marketSummary?.returns ?? 0),
                      netPnl: marketSummary?.netPnl ?? 0,
                      roi: marketSummary?.roi ?? null,
                      avgOdds: null,
                      avgProbability: null,
                    }}
                  />
                  {marketGroups.length === 0 && minProbability > 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-6 text-center text-xs text-slate-400"
                      >
                        No selections have a win probability of at least{' '}
                        {minProbability}%.
                      </td>
                    </tr>
                  )}
                </tbody>
                {marketGroups.map((group) => {
                  const selections = showEmptySelections
                    ? group.selections
                    : group.selections.filter((row) => row.settled > 0);
                  if (selections.length === 0) return null;
                  const isExpanded = Boolean(
                    expandedMarketGroups[group.typeRow.key]
                  );
                  return (
                    <tbody
                      key={group.typeRow.key}
                      id={groupPanelId('market-group', group.typeRow.key)}
                      className="divide-y divide-slate-100 border-t border-slate-100"
                    >
                      <MarketRow
                        variant="group"
                        label={
                          <button
                            type="button"
                            onClick={() => toggleMarketGroup(group.typeRow.key)}
                            aria-expanded={isExpanded}
                            aria-controls={groupPanelId(
                              'market-group',
                              group.typeRow.key
                            )}
                            className="flex w-full items-center gap-2 text-left cursor-pointer hover:text-slate-950"
                          >
                            <ChevronRight
                              className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                                isExpanded ? 'rotate-90' : ''
                              }`}
                              aria-hidden="true"
                            />
                            <span>{group.typeRow.label}</span>
                            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                              {selections.length} lines
                            </span>
                          </button>
                        }
                        row={group.typeRow}
                      />
                      {isExpanded &&
                        selections.map((row) => (
                          <MarketRow
                            key={row.key}
                            label={
                              <span className="flex items-center gap-2">
                                <span
                                  className="ml-3 h-1 w-1 shrink-0 rounded-full bg-slate-300"
                                  aria-hidden="true"
                                />
                                {row.label}
                              </span>
                            }
                            row={row}
                          />
                        ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              Roll-up rows repeat their selections&apos; totals. Voids return the
              stake and stay out of hit rate and ROI. Groups are collapsed by
              default — click a heading to drill down. Click a column heading
              to sort. These are single selections, not accumulators.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-500">
                  {lastTrendIcon(data.daily)}
                  Cumulative P&amp;L
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  One point per archived matchday, oldest to newest.
                </p>
              </div>
            </div>
            <div className="mt-3">
              <EquityChart days={data.daily} />
            </div>
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            Figures are a flat-stake research record, not real money. Verify
            prices and results with your sportsbook before placing a bet.
          </p>
        </>
      )}
    </section>
  );
}

function lastTrendIcon(days: PickAnalyticsDay[]) {
  const last = days[days.length - 1]?.cumulativeFeatured ?? 0;
  return last >= 0 ? (
    <TrendingUp className="h-4 w-4 text-emerald-700" aria-hidden="true" />
  ) : (
    <TrendingDown className="h-4 w-4 text-red-600" aria-hidden="true" />
  );
}
