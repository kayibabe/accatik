import { useState } from 'react';
import { Search } from 'lucide-react';
import {
  AdvancedFilters,
  FilterChipGroup,
} from '../ui/Filters.tsx';
import type { SlateFilterState } from '../../utils/slateFilterState.ts';
import type { SlateFilterPresetSelection } from '../../utils/slateFilterPresets.ts';
import {
  SLATE_FILTER_PRESETS,
  activeFilterCount,
} from '../../utils/slateFilterPresets.ts';
import {
  ANGLE_FILTERS,
  COVER_FILTERS,
  KICKOFF_WINDOWS,
  MARKET_FILTERS,
  MODEL_EDGE_THRESHOLDS,
  NOTE_FILTERS,
  PROBABILITY_THRESHOLDS,
} from '../../utils/slateFilters.ts';
import type { AngleFilter } from '../../utils/slateFilters.ts';
import type { AngleConfidence } from '../../utils/recommendedAngle.ts';
import type { FixtureFacetCounts } from './types.ts';
import type { StatusFilter, SortMode } from './fixtureShared.ts';
import { CONFIDENCE_FILTER_LABELS } from './fixtureShared.ts';

interface FixtureCounts {
  total: number;
  withOdds: number;
  upcoming: number;
  played: number;
  voided: number;
}

interface FixtureFiltersProps {
  filters: SlateFilterState;
  activePreset: SlateFilterPresetSelection;
  onPresetChange: (id: SlateFilterPresetSelection) => void;
  onUpdateFilters: (patch: Partial<SlateFilterState>) => void;
  onResetSlateFilters: () => void;
  hasSlateFilters: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCompetition: string;
  onCompetitionChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  sortMode: SortMode;
  onSortModeChange: (value: SortMode) => void;
  counts: FixtureCounts;
  baseCount: number;
  competitions: ReadonlyArray<{ name: string; count: number }>;
  facetCounts: FixtureFacetCounts;
  minOdds: number;
  maxOdds: number;
  onToggleSelection: (key: string) => void;
}

/** Shared confidence-chip options for the angle, cover and note rows. */
function confidenceOptions(
  ids: readonly AngleFilter[],
  counts: Record<AngleConfidence, number>,
  baseCount: number
) {
  return ids.map((id) => ({
    id,
    label: CONFIDENCE_FILTER_LABELS[id],
    count: id === 'all' ? baseCount : counts[id],
  }));
}

/** Presets, primary search/status controls and progressively disclosed filters. */
export function FixtureFilters({
  filters,
  activePreset,
  onPresetChange,
  onUpdateFilters,
  onResetSlateFilters,
  hasSlateFilters,
  searchQuery,
  onSearchChange,
  selectedCompetition,
  onCompetitionChange,
  statusFilter,
  onStatusChange,
  sortMode,
  onSortModeChange,
  counts,
  baseCount,
  competitions,
  facetCounts,
  minOdds,
  maxOdds,
  onToggleSelection,
}: FixtureFiltersProps) {
  const [advancedOpen, setAdvancedOpen] = useState(
    () => activeFilterCount(filters, 'advanced') > 0
  );

  const {
    angle: angleFilter,
    cover: coverFilter,
    note: noteFilter,
    marketType,
    marketSelections,
    minProbability,
    minModelEdge,
    kickoffWindowHours,
  } = filters;

  const statusOptions: ReadonlyArray<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: `All Today (${counts.total})` },
    { id: 'odds', label: `With Odds (${counts.withOdds})` },
    { id: 'upcoming', label: `Upcoming (${counts.upcoming})` },
    { id: 'played', label: `Live / Finished (${counts.played})` },
    { id: 'void', label: `Void (${counts.voided})` },
  ];

  return (
    <div id="slate-filters" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        {/* Presets are the fast path; every preset can still be refined below. */}
        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Quick views
          </p>
          <div
            role="group"
            aria-label="Slate filter presets"
            className="flex flex-wrap items-center gap-1.5"
          >
            {SLATE_FILTER_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onPresetChange(preset.id)}
                aria-pressed={activePreset === preset.id}
                title={preset.description}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                  activePreset === preset.id
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {preset.label}
              </button>
            ))}
            {activePreset === 'custom' && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800">
                Custom
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search team, league, or country…"
              aria-label="Search this matchday"
              className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700/20"
            />
          </div>
          <div
            role="group"
            aria-label="Sort fixtures"
            className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 p-1"
          >
            {(
              [
                { id: 'board', label: 'Board Order' },
                { id: 'probability', label: 'Most Likely First' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onSortModeChange(mode.id)}
                aria-pressed={sortMode === mode.id}
                className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                  sortMode === mode.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Match status
          </p>
          <div role="group" aria-label="Filter by match status" className="flex flex-wrap gap-1.5">
            {statusOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onStatusChange(option.id)}
                aria-pressed={statusFilter === option.id}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  statusFilter === option.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Competition
          </p>
          <div
            role="group"
            aria-label="Filter by competition"
            className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            <button
              type="button"
              onClick={() => onCompetitionChange('ALL')}
              aria-pressed={selectedCompetition === 'ALL'}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                selectedCompetition === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
              }`}
            >
              All Competitions
            </button>
            {competitions.map((competition) => (
              <button
                key={competition.name}
                type="button"
                onClick={() => onCompetitionChange(competition.name)}
                aria-pressed={selectedCompetition === competition.name}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  selectedCompetition === competition.name
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {competition.name} ({competition.count})
              </button>
            ))}
          </div>
        </div>

        <FilterChipGroup
          label="Market win probability"
          ariaLabel="Filter by market win probability"
          options={PROBABILITY_THRESHOLDS.map((threshold) => ({
            id: String(threshold),
            label: threshold === 0 ? 'Any' : `≥${threshold}%`,
          }))}
          value={String(minProbability)}
          onChange={(value) => onUpdateFilters({ minProbability: Number(value) })}
        />

        <AdvancedFilters
          id="slate-advanced-filters"
          open={advancedOpen}
          onToggle={() => setAdvancedOpen((open) => !open)}
          activeCount={activeFilterCount(filters, 'advanced')}
        >
          <FilterChipGroup
            label="Recommended angle"
            ariaLabel="Filter by recommended angle confidence"
            tone="angle"
            value={angleFilter}
            onChange={(value) => onUpdateFilters({ angle: value })}
            options={confidenceOptions(
              ANGLE_FILTERS,
              facetCounts.angles,
              baseCount
            )}
          />
          <FilterChipGroup
            label="Safer cover"
            ariaLabel="Filter by safer cover confidence"
            tone="cover"
            value={coverFilter}
            onChange={(value) => onUpdateFilters({ cover: value })}
            options={confidenceOptions(
              COVER_FILTERS,
              facetCounts.covers,
              baseCount
            )}
          />
          <FilterChipGroup
            label="Analyst note"
            ariaLabel="Filter by analyst note confidence"
            tone="note"
            value={noteFilter}
            onChange={(value) => onUpdateFilters({ note: value })}
            options={confidenceOptions(
              NOTE_FILTERS,
              facetCounts.notes,
              baseCount
            )}
          />

          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Market selection
              </p>
              {marketSelections.length > 0 && (
                <button
                  type="button"
                  onClick={() => onUpdateFilters({ marketSelections: [], marketType: 'all' })}
                  className="text-[11px] font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900 cursor-pointer"
                >
                  Clear markets
                </button>
              )}
            </div>
            <div
              role="group"
              aria-label="Filter by market selection"
              className="flex flex-wrap items-center gap-1"
            >
              <button
                type="button"
                onClick={() => onUpdateFilters({ marketSelections: [], marketType: 'all' })}
                aria-pressed={marketSelections.length === 0 && marketType === 'all'}
                className={`rounded border px-1.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  marketSelections.length === 0 && marketType === 'all'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                All <span className="font-mono tabular-nums opacity-70">{baseCount}</span>
              </button>
              {MARKET_FILTERS.map((selection) => {
                const active = marketSelections.includes(selection.key);
                return (
                  <button
                    key={selection.key}
                    type="button"
                    onClick={() => onToggleSelection(selection.key)}
                    aria-pressed={active}
                    title={selection.marketType}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                      active
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>{selection.label}</span>
                    <span className="font-mono tabular-nums opacity-70">
                      {facetCounts.selections[selection.key] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Price band · decimal odds
            </p>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.05"
                value={filters.minOddsInput}
                onChange={(event) => onUpdateFilters({ minOddsInput: event.target.value })}
                placeholder="Min"
                aria-label="Minimum decimal odds"
                className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
              />
              <span className="text-xs text-slate-400" aria-hidden="true">
                to
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.05"
                value={filters.maxOddsInput}
                onChange={(event) => onUpdateFilters({ maxOddsInput: event.target.value })}
                placeholder="Max"
                aria-label="Maximum decimal odds"
                className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs font-mono tabular-nums text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
              />
              {(filters.minOddsInput !== '' || filters.maxOddsInput !== '') && (
                <button
                  type="button"
                  onClick={() => onUpdateFilters({ minOddsInput: '', maxOddsInput: '' })}
                  className="rounded px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  Any
                </button>
              )}
            </div>
          </div>

          <FilterChipGroup
            label="Model edge · 1X2"
            ariaLabel="Filter by model edge over the book"
            options={MODEL_EDGE_THRESHOLDS.map((threshold) => ({
              id: String(threshold),
              label: threshold === 0 ? 'Any' : `≥${threshold} pts`,
              count: threshold > 0 ? facetCounts.modelEdges[threshold] : undefined,
            }))}
            value={String(minModelEdge)}
            onChange={(value) => onUpdateFilters({ minModelEdge: Number(value) })}
          />

          <FilterChipGroup
            label="Kickoff window"
            ariaLabel="Filter by kickoff window"
            options={KICKOFF_WINDOWS.map((hours) => ({
              id: String(hours),
              label: hours === 0 ? 'Any' : `Next ${hours}h`,
            }))}
            value={String(kickoffWindowHours)}
            onChange={(value) => onUpdateFilters({ kickoffWindowHours: Number(value) })}
          />
          <p className="-mt-1 text-[10px] leading-snug text-slate-400">
            Counted from now; matches already under way drop out.
          </p>
        </AdvancedFilters>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="max-w-2xl text-[11px] leading-relaxed text-slate-500">
          Win probability is margin-adjusted so it compares across fixtures.
          Model edge is the model’s 1X2 figure minus the de-vigged book.
          {(minOdds > 0 || maxOdds > 0) && ` Odds band: ${minOdds || 'any'}–${maxOdds || 'any'}.`}
        </p>
        {hasSlateFilters && (
          <button
            type="button"
            onClick={onResetSlateFilters}
            className="shrink-0 text-[11px] font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900 cursor-pointer"
          >
            Reset insight, market &amp; price filters
          </button>
        )}
      </div>
    </div>
  );
}
