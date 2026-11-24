import { Search } from 'lucide-react';
import type { ActiveFilterChip } from '../fixtures/fixtureShared.ts';
import { ActiveFilterBar } from '../fixtures/ActiveFilterBar.tsx';
import { FilterChipGroup } from '../ui/Filters.tsx';
import { DataCard } from '../ui/DataCard.tsx';
import { fmtCount } from '../../utils/format.ts';
import type {
  PositiveReadFilterState,
  PositiveReadOptions,
  PositiveReadQualityMode,
  PositiveReadSmallSampleMode,
} from '../../utils/positiveReadFilters.ts';
import { activePositiveReadFilterCount } from '../../utils/positiveReadFilters.ts';

const SAMPLE_OPTIONS: ReadonlyArray<{
  id: PositiveReadSmallSampleMode;
  label: string;
}> = [
  { id: 'all', label: 'All sizes' },
  { id: 'only', label: 'Small sample only' },
  { id: 'exclude', label: 'Hide small sample' },
];

interface PositiveReadDrillDownProps {
  options: PositiveReadOptions;
  state: PositiveReadFilterState;
  /** Dependent dimensions (market) are cleared by the parent when needed. */
  onChange: (patch: Partial<PositiveReadFilterState>) => void;
  onReset: () => void;
  counts: {
    combos: number;
    totalCombos: number;
    matches: number;
    totalMatches: number;
  };
  idPrefix: string;
}

/**
 * Section -> band -> market drill-down plus sample, ROI and text filters for
 * the positive-read feed. All option counts come from the study combos, so the
 * controls describe exactly what the match list below can show.
 */
export function PositiveReadDrillDown({
  options,
  state,
  onChange,
  onReset,
  counts,
  idPrefix,
}: PositiveReadDrillDownProps) {
  const activeCount = activePositiveReadFilterCount(state);

  const chips: ActiveFilterChip[] = [];
  if (state.section !== 'all') {
    const label = options.sections.find((item) => item.id === state.section)?.label;
    chips.push({
      key: 'section',
      label: `Section: ${label ?? state.section}`,
      clear: () => onChange({ section: 'all', marketKey: 'all' }),
    });
  }
  if (state.band !== 'all') {
    chips.push({
      key: 'band',
      label: `Band: ${state.band}`,
      clear: () => onChange({ band: 'all', marketKey: 'all' }),
    });
  }
  if (state.marketKey !== 'all') {
    const label = options.markets.find((item) => item.id === state.marketKey)?.label;
    chips.push({
      key: 'market',
      label: `Market: ${label ?? state.marketKey}`,
      clear: () => onChange({ marketKey: 'all' }),
    });
  }
  if (state.quality !== 'all') {
    const label = options.quality.find((item) => item.id === state.quality)?.label;
    chips.push({
      key: 'quality',
      label: `Evidence: ${label ?? state.quality}`,
      clear: () => onChange({ quality: 'all' }),
    });
  }
  if (state.smallSample !== 'all') {
    chips.push({
      key: 'sample',
      label: `Sample: ${SAMPLE_OPTIONS.find((item) => item.id === state.smallSample)?.label ?? state.smallSample}`,
      clear: () => onChange({ smallSample: 'all' }),
    });
  }
  if (state.minRoi !== null) {
    chips.push({
      key: 'roi',
      label: `Min ROI: ${state.minRoi}%`,
      clear: () => onChange({ minRoi: null }),
    });
  }
  if (state.query.trim()) {
    chips.push({
      key: 'query',
      label: `Search: ${state.query.trim()}`,
      clear: () => onChange({ query: '' }),
    });
  }

  const selectClass =
    'rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700';

  return (
    <div className="space-y-2">
      <DataCard
        title="Drill down"
        subtitle={`${fmtCount(counts.combos)} of ${fmtCount(counts.totalCombos)} qualifying parameters · ${fmtCount(counts.matches)} of ${fmtCount(counts.totalMatches)} fixtures`}
        actions={
          activeCount > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="rounded-md px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 hover:underline cursor-pointer"
            >
              Reset filters ({activeCount})
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <label
              htmlFor={`${idPrefix}-section`}
              className="inline-flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            >
              Section
              <select
                id={`${idPrefix}-section`}
                value={state.section}
                onChange={(event) =>
                  onChange({
                    section: event.target.value as PositiveReadFilterState['section'],
                    marketKey: 'all',
                  })
                }
                className={`${selectClass} min-w-[170px]`}
              >
                {options.sections.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({fmtCount(option.count)})
                  </option>
                ))}
              </select>
            </label>

            <FilterChipGroup
              label="Band"
              ariaLabel={`${idPrefix} filter by confidence band`}
              options={options.bands}
              value={state.band}
              onChange={(band) => onChange({ band, marketKey: 'all' })}
            />

            <label
              htmlFor={`${idPrefix}-market`}
              className="inline-flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            >
              Market
              <select
                id={`${idPrefix}-market`}
                value={state.marketKey}
                onChange={(event) => onChange({ marketKey: event.target.value })}
                className={`${selectClass} max-w-[230px] min-w-[170px]`}
              >
                {options.markets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({fmtCount(option.count)})
                  </option>
                ))}
              </select>
            </label>

            <FilterChipGroup
              label="Evidence"
              ariaLabel={`${idPrefix} filter by evidence quality`}
              options={options.quality}
              value={state.quality}
              onChange={(quality: PositiveReadQualityMode) => onChange({ quality })}
            />

            <FilterChipGroup
              label="Sample size"
              ariaLabel={`${idPrefix} filter by sample size`}
              options={SAMPLE_OPTIONS}
              value={state.smallSample}
              onChange={(smallSample) => onChange({ smallSample })}
            />

            <label
              htmlFor={`${idPrefix}-min-roi`}
              className="inline-flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            >
              Min ROI %
              <input
                id={`${idPrefix}-min-roi`}
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={state.minRoi ?? ''}
                onChange={(event) => {
                  const raw = event.target.value;
                  if (!raw) {
                    onChange({ minRoi: null });
                    return;
                  }
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed)) {
                    onChange({ minRoi: Math.max(0, parsed) });
                  }
                }}
                placeholder="Any"
                className={`${selectClass} w-24`}
              />
            </label>

            <label
              htmlFor={`${idPrefix}-query`}
              className="inline-flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500"
            >
              Team or competition
              <span className="relative">
                <Search
                  className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id={`${idPrefix}-query`}
                  type="search"
                  value={state.query}
                  onChange={(event) => onChange({ query: event.target.value })}
                  placeholder="Search matches"
                  className={`${selectClass} w-48 pl-7`}
                />
              </span>
            </label>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400">
            Counts are faceted: each selector shows how many qualifying parameters
            remain with the other filters applied. Market choices follow the
            selected section and band. Qualified and Confirmed describe
            parameters, not fixtures — Qualified requires the interval to clear
            zero, and Confirmed also stayed positive one matchday earlier. Search
            narrows the fixture cards only.
          </p>
        </div>
      </DataCard>

      <ActiveFilterBar
        chips={chips}
        onReset={onReset}
        label="Active qualifying-read filters"
      />
    </div>
  );
}
