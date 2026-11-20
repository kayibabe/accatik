import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Info,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  PickAnalyticsDay,
  PickAnalyticsResponse,
  PickAnalyticsRow,
} from '../types/analytics.ts';
import type { AccaStrategy, MarketType } from '../types/fixtures.ts';
import { apiFetch } from '../utils/api.ts';
import {
  SORT_DESC,
  sortRows,
  toggleSort,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';

interface AnalyticsViewProps {
  strategy: AccaStrategy;
  strategyName: string;
  onGoToSlate: () => void;
}

type MarketTableRow = PickAnalyticsRow & { marketType?: MarketType };

interface Summary {
  wins: number;
  losses: number;
  voids: number;
  stake: number;
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
  let netPnl = 0;
  for (const row of rows) {
    wins += row.wins;
    losses += row.losses;
    voids += row.voids;
    stake += row.stake;
    netPnl += row.netPnl;
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    voids,
    stake,
    netPnl,
    hitRate: decided > 0 ? (wins / decided) * 100 : null,
    roi: stake > 0 ? (netPnl / stake) * 100 : null,
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
  hitRate: (row) => row.hitRate,
  netPnl: (row) => row.netPnl,
  roi: (row) => row.roi,
  avgOdds: (row) => row.avgOdds,
};

export function AnalyticsView({
  strategy,
  strategyName,
  onGoToSlate,
}: AnalyticsViewProps) {
  const [data, setData] = useState<PickAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [marketView, setMarketView] = useState<'type' | 'selection'>('type');
  const [sort, setSort] = useState<SortState>({
    key: 'settled',
    direction: SORT_DESC,
  });

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
            body: JSON.stringify({ strategy, force: refreshKey > 0 }),
          }
        );
        if (!cancelled) setData(result);
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
  }, [strategy, refreshKey]);

  const featuredSummary = useMemo(
    () => (data ? summarize(data.featured) : null),
    [data]
  );
  const marketSummary = useMemo(
    () => (data ? summarize(data.marketsByType) : null),
    [data]
  );
  const marketRows = useMemo<MarketTableRow[]>(() => {
    if (!data) return [];
    const rows: MarketTableRow[] =
      marketView === 'type'
        ? data.marketsByType
        : data.marketsBySelection;
    return sortRows(rows, sort, SELECTION_ACCESSORS);
  }, [data, marketView, sort]);

  const sortHeader = (key: string, label: string, align: 'left' | 'right' = 'right') => (
    <th
      scope="col"
      aria-sort={
        sort.key === key
          ? sort.direction === SORT_DESC
            ? 'descending'
            : 'ascending'
          : 'none'
      }
      className={`px-3 py-2 font-semibold ${align === 'right' ? 'text-right' : ''}`}
    >
      <button
        type="button"
        onClick={() => setSort((current) => toggleSort(current, key, SORT_DESC))}
        className="inline-flex items-center gap-1 hover:text-slate-800 cursor-pointer"
      >
        {label}
        {sort.key === key && (
          <span aria-hidden="true">
            {sort.direction === SORT_DESC ? '↓' : '↑'}
          </span>
        )}
      </button>
    </th>
  );

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
          <button
            type="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
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
            onClick={() => setRefreshKey((key) => key + 1)}
            className="font-semibold underline cursor-pointer"
          >
            Retry
          </button>
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

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Featured picks
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Recommended Angle, Safer cover and Analyst note, rebuilt with
                  the {strategyName} strategy.
                </p>
              </div>
              <span className="text-[11px] text-slate-400">
                1u flat stake per pick
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Pick</th>
                    <th className="px-3 py-2 text-right font-semibold">Record</th>
                    <th className="px-3 py-2 text-right font-semibold">Hit rate</th>
                    <th className="px-3 py-2 text-right font-semibold">Stake</th>
                    <th className="px-3 py-2 text-right font-semibold">Returns</th>
                    <th className="px-3 py-2 text-right font-semibold">Net P&amp;L</th>
                    <th className="px-3 py-2 text-right font-semibold">ROI</th>
                    <th className="px-4 py-2 text-right font-semibold">Avg odds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.featured.map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-2.5 font-medium text-slate-800">
                        {row.label}
                        <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                          {row.settled} settled
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                        {recordLabel(row.wins, row.losses, row.voids)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <HitRateCell value={row.hitRate} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                        {row.stake.toFixed(0)}u
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                        {row.returns.toFixed(2)}u
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${pnlTone(row.netPnl)}`}
                      >
                        {signedUnits(row.netPnl)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono font-semibold tabular-nums ${pnlTone(row.roi ?? 0)}`}
                      >
                        {signedPercent(row.roi)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-600 tabular-nums">
                        {row.avgOdds === null ? '—' : row.avgOdds.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
                  Individual markets
                </h2>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Every priced selection on a finished fixture, settled
                  independently.
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                {(
                  [
                    ['type', 'By market'],
                    ['selection', 'By selection'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMarketView(id)}
                    aria-pressed={marketView === id}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      marketView === id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {sortHeader('label', 'Market', 'left')}
                    {marketView === 'selection' &&
                      sortHeader('marketType', 'Type', 'left')}
                    {sortHeader('settled', 'Picks')}
                    <th className="px-3 py-2 text-right font-semibold">W-L-V</th>
                    {sortHeader('hitRate', 'Hit rate')}
                    {sortHeader('avgOdds', 'Avg odds')}
                    {sortHeader('netPnl', 'Net P&L')}
                    {sortHeader('roi', 'ROI')}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {marketRows.map((row) => (
                    <tr key={row.key}>
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {row.label}
                      </td>
                      {marketView === 'selection' && (
                        <td className="px-3 py-2 text-slate-500">
                          {row.marketType}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {row.settled}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 tabular-nums">
                        {recordLabel(row.wins, row.losses, row.voids)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <HitRateCell value={row.hitRate} />
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
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              {marketView === 'selection'
                ? 'Top 12 selections by settled sample size. Click a heading to sort.'
                : 'Click a heading to sort. These are single selections, not accumulators.'}
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
