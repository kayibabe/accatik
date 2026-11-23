import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FlaskConical, RefreshCw } from 'lucide-react';
import type { AccaStrategy } from '../types/fixtures.ts';
import type {
  CombinationRoiBand,
  CombinationRoiResponse,
  CombinationRoiRow,
  FeaturedPickSource,
} from '../types/analytics.ts';
import { apiFetch } from '../utils/api.ts';
import { FEATURED_SOURCE_LABELS } from '../utils/featuredPickLabels.ts';
import {
  fmtCount,
  fmtFixed,
  fmtOdds,
  fmtPercent,
  fmtShortDate,
  fmtSignedPercent,
} from '../utils/format.ts';
import {
  SORT_DESC,
  makeSortHandler,
  sortRows,
  type SortAccessors,
  type SortState,
} from '../utils/tableSort.ts';
import { angleTone, pnlTone } from '../utils/uiTone.ts';
import { DataTable, type DataTableColumn } from './ui/DataTable.tsx';
import { DataStatus } from './ui/DataStatus.tsx';
import { MetricCard } from './ui/DataCard.tsx';
import { EmptyState, InlineLoading } from './ui/States.tsx';
import { recordLabel } from './performance/format.ts';
import { SortHeaderButton, SortStatus } from './performance/SortHeaderButton.tsx';

interface CombinationRoiViewProps {
  strategy: AccaStrategy;
  /** Incremented by the parent whenever any analytics table is refreshed. */
  refreshKey: number;
  /** True when the parent requested a cache-bypassing rebuild. */
  force: boolean;
  onReload: () => void;
}

const SECTION_LABELS = FEATURED_SOURCE_LABELS;

const BAND_ORDER: Record<CombinationRoiBand, number> = {
  High: 0,
  Solid: 1,
  Moderate: 2,
  Speculative: 3,
  All: 4,
};

const ACCESSORS: SortAccessors<CombinationRoiRow> = {
  section: (row) =>
    row.section ? SECTION_LABELS[row.section] : 'Direct market stake',
  band: (row) => BAND_ORDER[row.band],
  market: (row) => row.marketLabel,
  staked: (row) => row.staked,
  record: (row) => recordLabel(row.wins, row.losses, row.voids, '-'),
  winRate: (row) => row.winRate,
  avgOdds: (row) => row.avgOdds,
  roi: (row) => row.roi,
  dates: (row) => row.positiveDates,
  ci: (row) => row.roiCiLow,
};

function SignalCell({ row, minSample }: { row: CombinationRoiRow; minSample: number }) {
  if (row.staked === 0) {
    return <span className="text-[10px] text-slate-400">No picks</span>;
  }
  if (row.staked < minSample) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-amber-50 text-[10px] font-semibold text-amber-700 border border-amber-200">
        Small sample
      </span>
    );
  }
  if (row.roi !== null && row.roi > 0 && (row.roiCiLow ?? 0) > 0) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
        Positive · CI &gt; 0
      </span>
    );
  }
  if (row.roi !== null && row.roi > 0) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-[10px] font-semibold text-emerald-700">
        Positive
      </span>
    );
  }
  if (row.roiCiHigh !== null && row.roiCiHigh < 0) {
    return (
      <span className="px-1.5 py-0.5 rounded bg-red-50 text-[10px] font-semibold text-red-700 border border-red-200">
        Avoid
      </span>
    );
  }
  return <span className="text-[10px] text-slate-400">Negative</span>;
}

function RoiTable({
  title,
  subtitle,
  rows,
  minSample,
  showSection = true,
  showBand = true,
}: {
  title: string;
  subtitle: string;
  rows: CombinationRoiRow[];
  minSample: number;
  showSection?: boolean;
  showBand?: boolean;
}) {
  const [sort, setSort] = useState<SortState>({ key: 'roi', direction: SORT_DESC });
  const onSort = makeSortHandler(setSort, SORT_DESC);
  const sorted = useMemo(() => sortRows(rows, sort, ACCESSORS), [rows, sort]);
  const sortable = (
    label: string,
    key: string,
    align: 'left' | 'right' = 'right',
    defaultDirection: 'asc' | 'desc' = 'asc',
    columnTitle?: string
  ) => (
    <SortHeaderButton
      label={label}
      columnKey={key}
      sort={sort}
      onSort={onSort}
      align={align}
      defaultDirection={defaultDirection}
      title={columnTitle}
    />
  );

  const columns: DataTableColumn<CombinationRoiRow>[] = [];
  if (showSection) {
    columns.push({
      key: 'section',
      header: sortable('Section', 'section', 'left'),
      cell: (row) => (
        <span className="whitespace-nowrap font-medium">
          {row.section ? SECTION_LABELS[row.section] : '—'}
        </span>
      ),
      priority: 'tertiary',
    });
  }
  if (showBand) {
    columns.push({
      key: 'band',
      header: sortable('Band', 'band', 'left'),
      cell: (row) => (
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${angleTone(row.band)}`}
        >
          {row.band}
        </span>
      ),
      priority: 'tertiary',
    });
  }
  columns.push(
    {
      key: 'market',
      header: sortable('Market', 'market', 'left'),
      cell: (row) => (
        <span className="font-semibold text-slate-800 whitespace-nowrap">
          {row.marketLabel}
          {row.marketKey.startsWith('DNB-') && (
            <span
              className="ml-1.5 text-[10px] font-medium text-amber-600"
              title="Feed prices for DNB are miscalibrated"
            >
              feed ⚠
            </span>
          )}
        </span>
      ),
      priority: 'primary',
    },
    {
      key: 'staked',
      header: sortable('Staked', 'staked', 'right', SORT_DESC),
      cell: (row) => fmtCount(row.staked),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'record',
      header: sortable('W-L-V', 'record'),
      cell: (row) => recordLabel(row.wins, row.losses, row.voids, '-'),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'winRate',
      header: sortable('Win%', 'winRate', 'right', SORT_DESC),
      cell: (row) => fmtPercent(row.winRate),
      align: 'right',
      priority: 'secondary',
    },
    {
      key: 'avgOdds',
      header: sortable('Avg odds', 'avgOdds', 'right', SORT_DESC),
      cell: (row) => fmtOdds(row.avgOdds),
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'roi',
      header: sortable('ROI', 'roi', 'right', SORT_DESC),
      cell: (row) => (
        <span
          className={`font-semibold ${
            row.roi === null ? 'text-slate-400' : pnlTone(row.roi)
          }`}
        >
          {fmtSignedPercent(row.roi)}
        </span>
      ),
      align: 'right',
      priority: 'primary',
    },
    {
      key: 'dates',
      header: sortable(
        'Positive dates',
        'dates',
        'right',
        SORT_DESC,
        'Matchdays with a positive net result / matchdays with a staked pick'
      ),
      cell: (row) =>
        row.totalDates === 0
          ? '—'
          : `${fmtCount(row.positiveDates)}/${fmtCount(row.totalDates)}`,
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'ci',
      header: sortable(
        '95% CI',
        'ci',
        'right',
        SORT_DESC,
        'Matchday-cluster bootstrap interval for ROI'
      ),
      cell: (row) =>
        row.roiCiLow === null || row.roiCiHigh === null
          ? '—'
          : `${row.roiCiLow} .. ${row.roiCiHigh}`,
      align: 'right',
      priority: 'tertiary',
    },
    {
      key: 'read',
      header: 'Read',
      cell: (row) => <SignalCell row={row} minSample={minSample} />,
      priority: 'primary',
    }
  );

  return (
    <div className="space-y-2">
      <div className="px-1">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          {title}
        </h3>
        <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
      </div>
      <SortStatus sort={sort} label="ROI table" />
      <DataTable
        columns={columns}
        rows={sorted}
        rowKey={(row) => row.key}
        caption={title}
        minWidth="min-w-[1080px]"
        compact
        details={(row) => (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
            {showSection && (
              <div>
                <dt className="text-slate-400">Section</dt>
                <dd className="text-slate-700">
                  {row.section ? SECTION_LABELS[row.section] : '—'}
                </dd>
              </div>
            )}
            {showBand && (
              <div>
                <dt className="text-slate-400">Band</dt>
                <dd className="text-slate-700">{row.band}</dd>
              </div>
            )}
            <div>
              <dt className="text-slate-400">Staked</dt>
              <dd className="font-mono text-slate-700">{fmtCount(row.staked)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">W-L-V</dt>
              <dd className="font-mono text-slate-700">
                {recordLabel(row.wins, row.losses, row.voids, '-')}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">Win rate</dt>
              <dd className="font-mono text-slate-700">{fmtPercent(row.winRate)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Avg odds</dt>
              <dd className="font-mono text-slate-700">{fmtOdds(row.avgOdds)}</dd>
            </div>
            <div>
              <dt className="text-slate-400">Positive dates</dt>
              <dd className="font-mono text-slate-700">
                {row.totalDates === 0
                  ? '—'
                  : `${fmtCount(row.positiveDates)}/${fmtCount(row.totalDates)}`}
              </dd>
            </div>
            <div>
              <dt className="text-slate-400">95% CI</dt>
              <dd className="font-mono text-slate-700">
                {row.roiCiLow === null || row.roiCiHigh === null
                  ? '—'
                  : `${row.roiCiLow} .. ${row.roiCiHigh}`}
              </dd>
            </div>
          </dl>
        )}
        empty={
          <EmptyState
            title="No combinations match the current filters"
            description="Reset the filters to see the full study again."
          />
        }
      />
    </div>
  );
}

export function CombinationRoiView({
  strategy,
  refreshKey,
  force,
  onReload,
}: CombinationRoiViewProps) {
  const [data, setData] = useState<CombinationRoiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [band, setBand] = useState<CombinationRoiBand>('All');
  const [section, setSection] = useState<'all' | FeaturedPickSource>('all');
  const [market, setMarket] = useState('all');
  const [positiveOnly, setPositiveOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiFetch<CombinationRoiResponse>(
          '/api/analytics/combination-roi',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ strategy, force: force || localReload > 0 }),
          }
        );
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load the ROI study.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy, refreshKey, force, localReload]);

  const bandCounts = useMemo(() => {
    const counts = new Map<CombinationRoiBand, number>();
    for (const row of data?.rows ?? []) {
      if (row.scope !== 'section-band' || row.staked === 0) continue;
      counts.set(row.band, (counts.get(row.band) ?? 0) + 1);
      counts.set('All', (counts.get('All') ?? 0) + 1);
    }
    return counts;
  }, [data]);

  const studied = useMemo(
    () => (data?.rows ?? []).filter((row) => row.scope === 'section-band' && row.staked > 0),
    [data]
  );
  const positiveUsable = studied.filter(
    (row) => !row.smallSample && row.roi !== null && row.roi > 0
  );
  const smallSamplePositive = studied.filter(
    (row) => row.smallSample && row.roi !== null && row.roi > 0
  );
  const noPickMarkets = useMemo(() => {
    const markets = data?.markets ?? [];
    return markets.filter((item) => {
      const relevant = (data?.rows ?? []).filter(
        (row) => row.marketKey === item.key && row.scope === 'section-band'
      );
      return relevant.every((row) => row.staked === 0);
    });
  }, [data]);

  const matches = (row: CombinationRoiRow): boolean =>
    (band === 'All' || row.band === band) &&
    (section === 'all' || row.section === section) &&
    (market === 'all' || row.marketKey === market) &&
    (!positiveOnly || (row.roi !== null && row.roi > 0));

  const sectionBandRows = useMemo(
    () => (data?.rows ?? []).filter((row) => row.scope === 'section-band' && matches(row)),
    [data, band, section, market, positiveOnly]
  );
  const sectionRows = useMemo(
    () => (data?.rows ?? []).filter((row) => row.scope === 'section' && matches(row)),
    [data, section, market, positiveOnly]
  );
  const directRows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (row) => row.scope === 'market' && (market === 'all' || row.marketKey === market) && (!positiveOnly || (row.roi !== null && row.roi > 0))
      ),
    [data, market, positiveOnly]
  );

  const filterActive = band !== 'All' || section !== 'all' || market !== 'all' || positiveOnly;
  const reset = () => {
    setBand('All');
    setSection('all');
    setMarket('all');
    setPositiveOnly(false);
  };

  return (
    <section aria-label="Combination ROI study" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">
            Inception to date · flat {fmtFixed(data?.stakePerPick ?? 1, 0)}u · {strategy} strategy
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <FlaskConical className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Combination ROI study
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            Section × confidence band × market, rebuilt from every archived
            matchday. A band is the engine&apos;s own confidence label for the
            fair probability of the exact price the card referred to.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading && <InlineLoading label="Updating…" />}
          <button
            type="button"
            onClick={() => {
              setLocalReload((key) => key + 1);
              onReload();
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Reload
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {data && (
        <>
          <DataStatus
            source="Settled archive"
            note={
              <span className="text-slate-500">
                Flat {fmtFixed(data.stakePerPick, 0)}u · pre-match prices · generated{' '}
                {fmtShortDate(data.generatedAt)}
              </span>
            }
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="Positive · usable sample"
              value={fmtCount(positiveUsable.length)}
              detail={`at least ${fmtCount(data.minSample)} staked picks`}
              tone="text-emerald-700"
            />
            <MetricCard
              label="Measured combinations"
              value={fmtCount(studied.length)}
              detail={`of ${fmtCount(data.rows.filter((row) => row.scope === 'section-band').length)} possible cells`}
            />
            <MetricCard
              label="Small-sample positives"
              value={fmtCount(smallSamplePositive.length)}
              detail="treat as noise, not edge"
              tone="text-amber-600"
            />
            <MetricCard
              label="Markets never selected"
              value={fmtCount(noPickMarkets.length)}
              detail={
                noPickMarkets.length > 0
                  ? noPickMarkets.map((item) => item.label).join(', ')
                  : 'all covered'
              }
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div role="group" aria-label="Filter by confidence band" className="flex flex-wrap items-center gap-1">
                {(['All', ...data.bands] as CombinationRoiBand[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setBand(item)}
                    aria-pressed={band === item}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      band === item
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : angleTone(item)
                    }`}
                  >
                    {item}
                    <span className={`font-mono tabular-nums ${band === item ? 'text-white/70' : 'text-slate-500'}`}>
                      {fmtCount(bandCounts.get(item) ?? 0)}
                    </span>
                  </button>
                ))}
              </div>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                Section
                <select
                  value={section}
                  onChange={(event) => setSection(event.target.value as 'all' | FeaturedPickSource)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="all">All sections</option>
                  <option value="angle">{SECTION_LABELS.angle}</option>
                  <option value="cover">{SECTION_LABELS.cover}</option>
                  <option value="note">{SECTION_LABELS.note}</option>
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
                Market
                <select
                  value={market}
                  onChange={(event) => setMarket(event.target.value)}
                  className="max-w-[230px] rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="all">All markets</option>
                  {data.markets.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={positiveOnly}
                  onChange={(event) => setPositiveOnly(event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-700"
                />
                Positive ROI only
              </label>
              {filterActive && (
                <button type="button" onClick={reset} className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer">
                  Reset filters
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {fmtCount(data.sampleDates)} settled matchdays · {fmtCount(data.sampleFixtures)} priced fixtures ·{' '}
              {fmtCount(data.snapshotFixtures)} fixtures with frozen pick snapshots ·
              {' '}price capture: {fmtCount(data.priceQuality.prematch)} pre-match / {fmtCount(data.priceQuality.live)} live / {fmtCount(data.priceQuality.unknown)} unknown
            </p>
          </div>

          <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <summary className="flex cursor-pointer items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              How to read these numbers
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-6 leading-relaxed">
              {data.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </details>

          <RoiTable
            title="Section × band × market"
            subtitle="The main study. Bands: High ≥70%, Solid ≥52%, Moderate ≥38%, Speculative <38% of fair probability."
            rows={sectionBandRows}
            minSample={data.minSample}
          />
          <RoiTable
            title="Section × market · all bands combined"
            subtitle="The “All” chip: every confidence band pooled for one section and market."
            rows={sectionRows}
            minSample={data.minSample}
            showBand={false}
          />
          <RoiTable
            title="Direct market stakes"
            subtitle="Control group: every requested market staked directly from the full price ladder, with no section filter."
            rows={directRows}
            minSample={data.minSample}
            showSection={false}
            showBand={false}
          />
        </>
      )}
    </section>
  );
}
