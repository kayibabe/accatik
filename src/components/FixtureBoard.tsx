import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Search,
  ShieldCheck,
  Sparkles,
  Check,
  AlertCircle,
  TrendingUp,
  X,
} from 'lucide-react';
import type {
  AccaLeg,
  AccaStrategy,
  DeepAnalysisResponse,
  Fixture,
  MarketOption,
  MarketType,
  ModelProbabilities,
} from '../types/fixtures.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import {
  marketProbability,
  sortFixturesByProbability,
  sortMarketsByProbability,
} from '../utils/probability.ts';
import type { SortDirection, SortState } from '../utils/tableSort.ts';
import { SORT_ASC, sortRows, toggleSort } from '../utils/tableSort.ts';
import { resolvePick } from '../utils/pickResolver.ts';
import { isPreMatchFixture } from '../utils/priceQuality.ts';
import { buildRecommendedAngle } from '../utils/recommendedAngle.ts';
import type {
  AngleConfidence,
  RecommendedAngle,
} from '../utils/recommendedAngle.ts';
import {
  ANGLE_FILTERS,
  KICKOFF_WINDOWS,
  MARKET_TYPE_FILTERS,
  MODEL_EDGE_THRESHOLDS,
  PROBABILITY_THRESHOLDS,
  bestModelEdge,
  countAngleBands,
  countMarketTypes,
  countModelEdges,
  hasMarketFilters,
  matchingMarkets,
  matchesSlateFilters,
  parseOddsInput,
} from '../utils/slateFilters.ts';
import type { AngleFilter } from '../utils/slateFilters.ts';
import {
  DEFAULT_SLATE_FILTER_STATE,
  loadSlateFilterState,
  saveSlateFilterState,
} from '../utils/slateFilterState.ts';
import type { SlateFilterState } from '../utils/slateFilterState.ts';
import { SettlementLabel } from './SettlementLabel.tsx';
import { SortableTh } from './SortableTh.tsx';

interface FixtureBoardProps {
  fixtures: Fixture[];
  selectedDate: string;
  todayDate: string;
  displayDate: string;
  timezoneLabel: string;
  dataProvider: string;
  /** `archive` means the slate was served from disk without an API call. */
  slateSource?: 'live' | 'archive';
  /** When this matchday's prices were first captured. */
  capturedAt?: string;
  isFetchingDate: boolean;
  selectedLegs: AccaLeg[];
  strategy: AccaStrategy;
  onToggleMarket: (fixture: Fixture, market: MarketOption) => void;
  deepAnalyses: Record<string, DeepAnalysisResponse>;
  analyzingIds: Record<string, boolean>;
  analysisErrors: Record<string, string>;
  onRequestDeepAnalysis: (fixture: Fixture) => void;
  /** Optional controlled slate filters. When supplied, App owns the value. */
  filters?: SlateFilterState;
  onFiltersChange?: (next: SlateFilterState) => void;
}

type StatusFilter = 'all' | 'odds' | 'upcoming' | 'played' | 'void';
type SortMode = 'board' | 'probability';

const ANGLE_FILTER_LABELS: Record<AngleFilter, string> = {
  all: 'All',
  High: 'High',
  Solid: 'Solid',
  Moderate: 'Moderate',
  Speculative: 'Speculative',
};

function marketTypeShortLabel(type: MarketType): string {
  switch (type) {
    case 'Double Chance':
      return 'DC';
    case 'Draw No Bet':
      return 'DNB';
    default:
      return type;
  }
}

function formatArchiveTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** API-Football's model percentage for a 1X2 side, when it published one. */
function modelPercentFor(
  market: MarketOption,
  probabilities?: ModelProbabilities
): number | null {
  if (!probabilities) return null;
  if (market.id.endsWith('1x2-h')) return probabilities.home;
  if (market.id.endsWith('1x2-d')) return probabilities.draw;
  if (market.id.endsWith('1x2-a')) return probabilities.away;
  return null;
}

interface ModelComparisonRow {
  label: string;
  book: number;
  model: number;
}

/** De-vigged book vs API-Football model, side by side on the 1X2 trio. */
function modelComparisonRows(fixture: Fixture): ModelComparisonRow[] {
  const probabilities = fixture.modelProbabilities;
  if (!probabilities) return [];

  const sides: Array<{ suffix: string; label: string; model: number | null }> = [
    { suffix: '1x2-h', label: 'Home', model: probabilities.home },
    { suffix: '1x2-d', label: 'Draw', model: probabilities.draw },
    { suffix: '1x2-a', label: 'Away', model: probabilities.away },
  ];

  const rows: ModelComparisonRow[] = [];
  for (const side of sides) {
    if (side.model === null) continue;
    const market = fixture.markets.find((m) => m.id.endsWith(side.suffix));
    if (!market) continue;
    rows.push({
      label: side.label,
      book: marketProbability(market),
      model: side.model,
    });
  }
  return rows;
}

/** Confidence chip colours, keyed to the angle's own banding. */
const ANGLE_TONE: Record<AngleConfidence, string> = {
  High: 'text-emerald-800 bg-emerald-100/80 border-emerald-200',
  Solid: 'text-sky-800 bg-sky-100/80 border-sky-200',
  Moderate: 'text-amber-800 bg-amber-100/80 border-amber-200',
  Speculative: 'text-slate-700 bg-slate-100 border-slate-200',
};

interface BriefToggleProps {
  isExpanded: boolean;
  onToggle: () => void;
  /** id of the panel this button opens, for `aria-controls`. */
  controls?: string;
  /** `accent` is the variant used inside the green Recommended Angle card. */
  tone?: 'plain' | 'accent';
  className?: string;
}

/** Opens the tactical brief panel directly beneath the Recommended Angle card. */
function BriefToggle({
  isExpanded,
  onToggle,
  controls,
  tone = 'plain',
  className = '',
}: BriefToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-controls={controls}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
        tone === 'accent'
          ? 'text-emerald-800 border-emerald-200 bg-white/70 hover:bg-white hover:text-emerald-900'
          : 'text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-50'
      } ${className}`}
    >
      <span>{isExpanded ? 'Hide Brief' : 'Tactical Brief'}</span>
      {isExpanded ? (
        <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
      )}
    </button>
  );
}

interface FilterChipGroupProps<T extends string> {
  label: string;
  ariaLabel: string;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  /** `angle` uses the Recommended Angle card's emerald accent. */
  tone?: 'neutral' | 'angle';
}

/** One labelled row of slate-filter chips. */
function FilterChipGroup<T extends string>({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  tone = 'neutral',
}: FilterChipGroupProps<T>) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div
        role="group"
        aria-label={ariaLabel}
        className="flex flex-wrap items-center gap-1"
      >
        {options.map((option) => {
          const isActive = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                isActive
                  ? tone === 'angle'
                    ? 'bg-emerald-700 border-emerald-700 text-white'
                    : 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span>{option.label}</span>
              {option.count !== undefined && (
                <span
                  className={`font-mono tabular-nums ${
                    isActive ? 'text-white/70' : 'text-slate-400'
                  }`}
                >
                  {option.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FixtureBoard({
  fixtures,
  selectedDate,
  todayDate,
  displayDate,
  timezoneLabel,
  dataProvider,
  slateSource,
  capturedAt,
  isFetchingDate,
  selectedLegs,
  strategy,
  onToggleMarket,
  deepAnalyses,
  analyzingIds,
  analysisErrors,
  onRequestDeepAnalysis,
  filters: controlledFilters,
  onFiltersChange,
}: FixtureBoardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState<string>('ALL');
  // One object so the chips, the saved copy and the storage write agree.
  // App may own this value to sync filters to the signed-in user's account.
  const [internalFilters, setInternalFilters] = useState<SlateFilterState>(
    loadSlateFilterState
  );
  const filters = controlledFilters ?? internalFilters;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('board');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [visibleLimit, setVisibleLimit] = useState<number>(40);
  // Default keeps the previous behaviour: most likely market first.
  const [marketSort, setMarketSort] = useState<SortState>({
    key: 'fair',
    direction: 'desc',
  });

  const updateFilters = (patch: Partial<SlateFilterState>) => {
    const next = { ...filters, ...patch };
    if (onFiltersChange) onFiltersChange(next);
    else setInternalFilters(next);
  };

  const {
    angle: angleFilter,
    marketType,
    minProbability,
    minModelEdge,
    kickoffWindowHours,
  } = filters;
  const minOdds = parseOddsInput(filters.minOddsInput);
  const maxOdds = parseOddsInput(filters.maxOddsInput);

  // Mirrored to localStorage so a reload or a tab switch keeps the slate
  // narrowed. Search, status and competition stay session-only.
  useEffect(() => {
    saveSlateFilterState(filters);
  }, [filters]);

  useEffect(() => {
    setVisibleLimit(40);
  }, [
    selectedDate,
    searchQuery,
    selectedCompetition,
    statusFilter,
    filters,
    sortMode,
  ]);

  // One angle per fixture, shared by the filters, the facet counts and the
  // cards so the screen cannot rank the same match two different ways.
  const anglesByFixture = useMemo(() => {
    const map = new Map<string, RecommendedAngle | null>();
    for (const fixture of fixtures) {
      map.set(fixture.id, buildRecommendedAngle(fixture, strategy));
    }
    return map;
  }, [fixtures, strategy]);

  const angleFor = (fixture: Fixture): RecommendedAngle | null =>
    anglesByFixture.get(fixture.id) ?? null;

  const slateFilters = useMemo(
    () => ({
      angle: filters.angle,
      marketType: filters.marketType,
      minProbability: filters.minProbability,
      minOdds: parseOddsInput(filters.minOddsInput),
      maxOdds: parseOddsInput(filters.maxOddsInput),
      minModelEdge: filters.minModelEdge,
      kickoffWindowHours: filters.kickoffWindowHours,
    }),
    [filters]
  );

  const marketChipsActive = hasMarketFilters(slateFilters);

  const hasSlateFilters =
    angleFilter !== 'all' ||
    marketChipsActive ||
    minModelEdge > 0 ||
    kickoffWindowHours > 0;

  const resetSlateFilters = () => {
    if (onFiltersChange) onFiltersChange(DEFAULT_SLATE_FILTER_STATE);
    else setInternalFilters(DEFAULT_SLATE_FILTER_STATE);
  };

  // What the sticky summary bar renders, one removable chip per active filter.
  const activeFilterChips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (angleFilter !== 'all') {
    activeFilterChips.push({
      key: 'angle',
      label: `Angle: ${ANGLE_FILTER_LABELS[angleFilter]}`,
      clear: () => updateFilters({ angle: 'all' }),
    });
  }
  if (marketType !== 'all') {
    activeFilterChips.push({
      key: 'market',
      label: `Market: ${marketTypeShortLabel(marketType)}`,
      clear: () => updateFilters({ marketType: 'all' }),
    });
  }
  if (minProbability > 0) {
    activeFilterChips.push({
      key: 'probability',
      label: `Win ≥${minProbability}%`,
      clear: () => updateFilters({ minProbability: 0 }),
    });
  }
  if (minOdds > 0 || maxOdds > 0) {
    const band =
      minOdds > 0 && maxOdds > 0
        ? `Odds ${minOdds}–${maxOdds}`
        : minOdds > 0
        ? `Odds ≥${minOdds}`
        : `Odds ≤${maxOdds}`;
    activeFilterChips.push({
      key: 'odds',
      label: band,
      clear: () => updateFilters({ minOddsInput: '', maxOddsInput: '' }),
    });
  }
  if (minModelEdge > 0) {
    activeFilterChips.push({
      key: 'edge',
      label: `Model ≥${minModelEdge} pts`,
      clear: () => updateFilters({ minModelEdge: 0 }),
    });
  }
  if (kickoffWindowHours > 0) {
    activeFilterChips.push({
      key: 'kickoff',
      label: `Next ${kickoffWindowHours}h`,
      clear: () => updateFilters({ kickoffWindowHours: 0 }),
    });
  }

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedCompetition('ALL');
    setStatusFilter('all');
    resetSlateFilters();
  };

  const counts = useMemo(() => {
    let withOdds = 0;
    let upcoming = 0;
    let played = 0;
    let voided = 0;
    for (const f of fixtures) {
      if (f.hasLiveOdds) withOdds++;
      if (f.status === 'Scheduled' && !f.awaitingResult) upcoming++;
      else if (f.status === 'Void') voided++;
      else if (f.status === 'Live' || f.status === 'Finished') played++;
    }
    return { total: fixtures.length, withOdds, upcoming, played, voided };
  }, [fixtures]);

  const competitions = useMemo(() => {
    const compCounts = new Map<string, number>();
    for (const f of fixtures) {
      compCounts.set(f.competition, (compCounts.get(f.competition) ?? 0) + 1);
    }
    return Array.from(compCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([name, count]) => ({ name, count }));
  }, [fixtures]);

  // Search, status and competition narrow the pool before the slate filters,
  // so the facet counts describe what the chips would actually show.
  const baseFixtures = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return fixtures.filter((f) => {
      if (statusFilter === 'odds' && !f.hasLiveOdds) return false;
      if (
        statusFilter === 'upcoming' &&
        !(f.status === 'Scheduled' && !f.awaitingResult)
      ) {
        return false;
      }
      if (
        statusFilter === 'played' &&
        f.status !== 'Live' &&
        f.status !== 'Finished'
      ) {
        return false;
      }
      if (statusFilter === 'void' && f.status !== 'Void') return false;
      if (selectedCompetition !== 'ALL' && f.competition !== selectedCompetition) {
        return false;
      }
      if (!q) return true;
      return (
        f.homeTeam.toLowerCase().includes(q) ||
        f.awayTeam.toLowerCase().includes(q) ||
        f.competition.toLowerCase().includes(q) ||
        f.country.toLowerCase().includes(q)
      );
    });
  }, [fixtures, searchQuery, selectedCompetition, statusFilter]);

  const facetCounts = useMemo(
    () => ({
      angles: countAngleBands(baseFixtures, angleFor),
      marketTypes: countMarketTypes(baseFixtures),
      modelEdges: countModelEdges(baseFixtures),
    }),
    // `angleFor` closes over `anglesByFixture`, included here.
    [baseFixtures, anglesByFixture]
  );

  const filteredFixtures = useMemo(() => {
    const matching = baseFixtures.filter((fixture) =>
      matchesSlateFilters(fixture, slateFilters, angleFor(fixture))
    );

    return sortMode === 'probability'
      ? sortFixturesByProbability(matching)
      : matching;
    // `angleFor` closes over `anglesByFixture`, included here.
  }, [baseFixtures, slateFilters, anglesByFixture, sortMode]);

  const selectedByFixture = useMemo(() => {
    const map = new Map<string, AccaLeg>();
    for (const leg of selectedLegs) {
      map.set(leg.fixtureId, leg);
    }
    return map;
  }, [selectedLegs]);

  const toggleExpanded = (id: string) => {
    const willExpand = !expandedIds[id];
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
    if (!willExpand) return;

    // The brief opens directly under the angle card now, so nudge it into view
    // rather than leaving the click without visible feedback.
    requestAnimationFrame(() => {
      const panel = document.getElementById(`brief-${id}`);
      if (!panel) return;
      const top = panel.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight - 160) {
        panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  };

  const handleMarketSort = (
    key: string,
    defaultDirection: SortDirection = SORT_ASC
  ) => {
    setMarketSort((prev) => toggleSort(prev, key, defaultDirection));
  };

  const isToday = selectedDate === todayDate;

  return (
    <section aria-label="Football Fixtures by Date" className="space-y-5">
      {/* Slate Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {displayDate} · {timezoneLabel} · {dataProvider}
            {slateSource === 'archive' && capturedAt && (
              <>
                {' · '}
                <span
                  className="inline-flex items-center gap-1 text-emerald-800"
                  title={`Served from the local slate archive without calling API-Football. Prices and picks captured ${formatArchiveTime(capturedAt)}.`}
                >
                  Archived {formatArchiveTime(capturedAt)}
                </span>
              </>
            )}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
            {isToday
              ? "Today's Football Fixture Board"
              : 'Football Fixture Board'}
          </h1>
        </div>

        <span className="text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
          Showing {filteredFixtures.length} of {fixtures.length} matches
        </span>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search team, league, or country..."
              aria-label="Search today's matches"
              className="w-full h-10 pl-9 pr-3 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
            />
          </div>

          <div
            role="group"
            aria-label="Sort fixtures"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0"
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
                onClick={() => setSortMode(mode.id)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
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

        {/* Universal slate filters: angle, market, probability, price band */}
        <div className="grid gap-3 sm:grid-cols-2 border-t border-slate-100 pt-3">
          <FilterChipGroup
            label="Recommended Angle"
            ariaLabel="Filter by recommended angle confidence"
            tone="angle"
            value={angleFilter}
            onChange={(value) => updateFilters({ angle: value })}
            options={ANGLE_FILTERS.map((id) => ({
              id,
              label: ANGLE_FILTER_LABELS[id],
              count:
                id === 'all' ? baseFixtures.length : facetCounts.angles[id],
            }))}
          />

          <FilterChipGroup
            label="Market"
            ariaLabel="Filter by market type"
            value={marketType}
            onChange={(value) => updateFilters({ marketType: value })}
            options={[
              { id: 'all' as const, label: 'All', count: baseFixtures.length },
              ...MARKET_TYPE_FILTERS.map((type) => ({
                id: type,
                label: marketTypeShortLabel(type),
                count: facetCounts.marketTypes[type],
              })),
            ]}
          />

          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Market win probability
            </p>
            <div
              role="group"
              aria-label="Filter by market win probability"
              className="flex flex-wrap items-center gap-1"
            >
              {PROBABILITY_THRESHOLDS.map((threshold) => {
                const isActive = minProbability === threshold;
                return (
                  <button
                    key={threshold}
                    type="button"
                    onClick={() => updateFilters({ minProbability: threshold })}
                    aria-pressed={isActive}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {threshold === 0 ? 'Any' : `≥${threshold}%`}
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
                onChange={(e) => updateFilters({ minOddsInput: e.target.value })}
                placeholder="Min"
                aria-label="Minimum decimal odds"
                className="h-8 w-20 px-2 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
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
                onChange={(e) => updateFilters({ maxOddsInput: e.target.value })}
                placeholder="Max"
                aria-label="Maximum decimal odds"
                className="h-8 w-20 px-2 text-xs font-mono bg-white border border-slate-200 rounded-md text-slate-900 tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
              />
              {(filters.minOddsInput !== '' ||
                filters.maxOddsInput !== '') && (
                <button
                  type="button"
                  onClick={() =>
                    updateFilters({ minOddsInput: '', maxOddsInput: '' })
                  }
                  className="px-2 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-900 rounded transition-colors cursor-pointer"
                >
                  Any
                </button>
              )}
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Model edge · 1X2
            </p>
            <div
              role="group"
              aria-label="Filter by model edge over the book"
              className="flex flex-wrap items-center gap-1"
            >
              {MODEL_EDGE_THRESHOLDS.map((threshold) => {
                const isActive = minModelEdge === threshold;
                return (
                  <button
                    key={threshold}
                    type="button"
                    onClick={() => updateFilters({ minModelEdge: threshold })}
                    aria-pressed={isActive}
                    title="API-Football's 1X2 model minus the de-vigged book, in percentage points"
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-sky-700 border-sky-700 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>
                      {threshold === 0 ? 'Any' : `≥${threshold} pts`}
                    </span>
                    {threshold > 0 && (
                      <span
                        className={`font-mono tabular-nums ${
                          isActive ? 'text-white/70' : 'text-slate-400'
                        }`}
                      >
                        {facetCounts.modelEdges[threshold]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Kickoff window
            </p>
            <div
              role="group"
              aria-label="Filter by kickoff window"
              className="flex flex-wrap items-center gap-1"
            >
              {KICKOFF_WINDOWS.map((hours) => {
                const isActive = kickoffWindowHours === hours;
                return (
                  <button
                    key={hours}
                    type="button"
                    onClick={() =>
                      updateFilters({ kickoffWindowHours: hours })
                    }
                    aria-pressed={isActive}
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {hours === 0 ? 'Any' : `Next ${hours}h`}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-slate-400">
              Counted from now; matches already under way drop out.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Every match is judged on the best price in the chosen market. Win
            probability is margin-adjusted, so it compares across fixtures.
            Model edge is the model&apos;s 1X2 figure minus the de-vigged book.
          </p>
          {hasSlateFilters && (
            <button
              type="button"
              onClick={resetSlateFilters}
              className="shrink-0 text-[11px] font-semibold text-emerald-800 hover:text-emerald-900 underline underline-offset-2 cursor-pointer"
            >
              Clear angle, market &amp; price filters
            </button>
          )}
        </div>

        {/* Status filter bar */}
        <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
          {(
            [
              { id: 'all', label: `All Today (${counts.total})` },
              { id: 'odds', label: `With Odds (${counts.withOdds})` },
              { id: 'upcoming', label: `Upcoming (${counts.upcoming})` },
              { id: 'played', label: `Live / Finished (${counts.played})` },
              { id: 'void', label: `Void (${counts.voided})` },
            ] as const
          ).map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setStatusFilter(st.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === st.id
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 border-t border-slate-100 pt-2.5">
          <button
            type="button"
            onClick={() => setSelectedCompetition('ALL')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              selectedCompetition === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:text-slate-900'
            }`}
          >
            All Competitions
          </button>
          {competitions.map((comp) => (
            <button
              key={comp.name}
              type="button"
              onClick={() => setSelectedCompetition(comp.name)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedCompetition === comp.name
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              {comp.name} ({comp.count})
            </button>
          ))}
        </div>
      </div>

      {/* Sticky filter readout: what is applied, one click to undo each one */}
      {hasSlateFilters && (
        <div
          aria-label="Active slate filters"
          className="sticky top-2 z-20 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur"
        >
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Filters
          </span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.clear}
              title={`Remove ${chip.label} filter`}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 cursor-pointer"
            >
              <span>{chip.label}</span>
              <X className="w-3 h-3 text-slate-400" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetSlateFilters}
            className="ml-auto px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-900 underline underline-offset-2 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Fixtures Ledger */}
      {filteredFixtures.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-sm font-semibold text-slate-900">
            No fixtures match your current filters
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Loosen the angle, market, probability or price filters — or clear
            the search and competition scope — to see more of this matchday.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {isFetchingDate && (
            <div className="px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600">
              Loading matches and live bookmaker odds for {selectedDate}...
            </div>
          )}
          {/* One card per fixture so the ledger is visually separable. */}
          <>
            {filteredFixtures.slice(0, visibleLimit).map((fixture) => {
            const activeLeg = selectedByFixture.get(fixture.id);
            const isExpanded = Boolean(expandedIds[fixture.id]);
            // The tile grid follows the market chips too: a ≥70% filter hides
            // every 57% tile instead of just dropping the match.
            const displayMarkets = sortMarketsByProbability(
              matchingMarkets(fixture, slateFilters)
            );
            // Only the expanded brief renders this table.
            const tableMarkets = isExpanded
              ? sortRows<MarketOption>(fixture.markets, marketSort, {
                  market: (m) => m.label,
                  odds: (m) => m.odds,
                  fair: (m) => marketProbability(m),
                  book: (m) => m.bookmaker ?? '',
                  status: (m) => evaluateMarketSettlement(fixture, m),
                  rationale: (m) => m.rationale,
                })
              : [];

            const deepAnalysis = deepAnalyses[fixture.id];
            const isAnalyzing = Boolean(analyzingIds[fixture.id]);
            const analysisError = analysisErrors[fixture.id];

            const homeForm = deepAnalysis?.formHome || fixture.formHome;
            const awayForm = deepAnalysis?.formAway || fixture.formAway;
            const hasScore =
              fixture.status !== 'Scheduled' &&
              fixture.status !== 'Void' &&
              fixture.score &&
              fixture.score.home !== null &&
              fixture.score.away !== null;
            const hasHalftime =
              hasScore &&
              fixture.score?.halftimeHome !== null &&
              fixture.score?.halftimeHome !== undefined &&
              fixture.score?.halftimeAway !== null &&
              fixture.score?.halftimeAway !== undefined;
            // The angle card, the highlighted tile and the auto-ticket all read
            // the same resolver, so they cannot name different markets.
            const pickMarket = resolvePick(fixture, strategy);
            const isPreMatch = isPreMatchFixture(fixture);
            const pickLabel =
              strategy === 'probability' ? 'Highest chance' : 'Recommended';
            const pickOutcome = pickMarket
              ? evaluateMarketSettlement(fixture, pickMarket)
              : fixture.status === 'Void'
              ? 'Void'
              : null;
            const resultSummary = getFixtureMatchResultSummary(fixture);
            // The green card below reads the same precomputed angle as the filters.
            const angle = anglesByFixture.get(fixture.id) ?? null;
            // Fixture-level context: the highest-probability price on the book,
            // shown only when it is not already the pick or the card's cover.
            const shortestPrice = angle?.shortestPrice ?? null;
            // The independent model, kept separate from the de-vigged book.
            const modelRows = modelComparisonRows(fixture);
            // Shown on the card only when the user is filtering for it, so the
            // list explains why each match survived the model-edge chip.
            const modelEdge = bestModelEdge(fixture);

            return (
              <article
                key={fixture.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden transition-colors"
              >
                <div className="p-4 sm:p-5 space-y-3.5">
                  {/* Unboxed Match Metadata Line */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        {fixture.matchDate}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {fixture.kickoffTime}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-700">
                        {fixture.competition}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{fixture.country}</span>
                      {fixture.bookmakerName && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600 font-medium">
                            {fixture.bookmakerName}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true" className="hidden sm:inline">
                        ·
                      </span>
                      <span className="hidden sm:inline text-slate-400">
                        {fixture.venue}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {minModelEdge > 0 && modelEdge && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 whitespace-nowrap"
                          title={`API-Football's 1X2 model has ${modelEdge.points.toFixed(
                            1
                          )} points more on ${modelEdge.side} than the de-vigged book.`}
                        >
                          <TrendingUp
                            className="w-3.5 h-3.5"
                            aria-hidden="true"
                          />
                          Model +{modelEdge.points.toFixed(1)} pts ·{' '}
                          {modelEdge.side}
                        </span>
                      )}
                      {pickOutcome &&
                        (fixture.status === 'Finished' ||
                          fixture.status === 'Void') && (
                          <SettlementLabel
                            status={pickOutcome}
                            prefix={pickMarket ? pickLabel : 'Match'}
                          />
                        )}
                      {activeLeg && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          In Ticket @ {activeLeg.odds.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Teams + Score + Result Status + Form */}
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                        <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                          {fixture.homeTeam}
                        </h2>
                        {hasScore ? (
                          <span className="font-mono font-bold text-base text-slate-900 tabular-nums">
                            {fixture.score?.home} - {fixture.score?.away}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">
                            vs
                          </span>
                        )}
                        <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                          {fixture.awayTeam}
                        </h2>
                        {(fixture.status !== 'Scheduled' || fixture.awaitingResult) && (
                          <span
                            className={`text-xs font-mono font-semibold tabular-nums ${
                              fixture.status === 'Void' || fixture.awaitingResult
                                ? 'text-amber-700'
                                : fixture.status === 'Live'
                                ? 'text-emerald-700'
                                : 'text-slate-700'
                            }`}
                          >
                            · {resultSummary}
                            {hasHalftime
                              ? ` (HT ${fixture.score?.halftimeHome}-${fixture.score?.halftimeAway})`
                              : ''}
                          </span>
                        )}
                      </div>
                      {(homeForm !== '—' || awayForm !== '—') && (
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 font-mono">
                          <span>Home form: {homeForm}</span>
                          <span aria-hidden="true">/</span>
                          <span>Away form: {awayForm}</span>
                        </div>
                      )}
                    </div>

                    {/* Without an angle card there is no home for the toggle,
                        so unpriced fixtures keep it on the team row. */}
                    {!angle && (
                      <BriefToggle
                        isExpanded={isExpanded}
                        onToggle={() => toggleExpanded(fixture.id)}
                        controls={`brief-${fixture.id}`}
                        className="self-start lg:self-center"
                      />
                    )}
                  </div>

                  <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">
                    {fixture.tacticalSummary}
                  </p>

                  {/* Per-match Recommended Angle */}
                  {angle && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
                          <Compass className="w-3.5 h-3.5" aria-hidden="true" />
                          Recommended Angle
                        </span>
                        <span className="text-xs font-semibold text-slate-900">
                          {angle.market.label}
                        </span>
                        <span className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                          @ {angle.market.odds.toFixed(2)}
                        </span>
                        <span
                          className="text-[11px] font-mono text-emerald-800 tabular-nums"
                          title="Margin-adjusted win probability"
                        >
                          {angle.probability.toFixed(0)}% fair
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                            ANGLE_TONE[angle.confidence]
                          }`}
                        >
                          {angle.confidence}
                        </span>
                        {marketChipsActive &&
                          !displayMarkets.some(
                            (market) => market.id === angle.market.id
                          ) && (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-800"
                              title="This pick does not meet the current market, probability or price filters, so its tile is hidden from the grid below."
                            >
                              Outside your market filters
                            </span>
                          )}
                        <BriefToggle
                          isExpanded={isExpanded}
                          onToggle={() => toggleExpanded(fixture.id)}
                          controls={`brief-${fixture.id}`}
                          tone="accent"
                          className="ml-auto"
                        />
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-600 leading-snug">
                        {angle.note}
                      </p>
                      {angle.cover && (
                        <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] leading-snug text-slate-600 shadow-sm">
                          <ShieldCheck
                            className="w-3 h-3 shrink-0 text-slate-500"
                            aria-hidden="true"
                          />
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Safer cover
                          </span>
                          <span className="font-medium text-slate-900">
                            {angle.cover.label}
                          </span>
                          <span className="font-mono font-semibold text-slate-900 tabular-nums">
                            @ {angle.cover.odds.toFixed(2)}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="font-mono text-slate-600 tabular-nums">
                            {angle.coverProbability.toFixed(0)}% fair
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Expandable Tactical Brief & On-Demand API-Football Predictions */}
                  {isExpanded && (
                    <div
                      id={`brief-${fixture.id}`}
                      className="rounded-lg border border-emerald-200 bg-slate-50/70 px-3 sm:px-4 py-3 space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-slate-900">
                          <span className="mr-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                            Tactical brief
                          </span>
                          Market Rationales &amp; Fair Probabilities
                          <span className="ml-2 font-normal text-slate-500">
                            click a column to sort
                          </span>
                        </h3>
                        <button
                          type="button"
                          onClick={() => onRequestDeepAnalysis(fixture)}
                          disabled={isAnalyzing}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {isAnalyzing
                              ? 'Loading Predictions & Injuries...'
                              : deepAnalysis
                              ? 'Refresh Predictions & Team News'
                              : 'Load Predictions & Team News'}
                          </span>
                        </button>
                      </div>

                      {fixture.markets.length > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="border-b border-slate-200 text-slate-500">
                                <SortableTh
                                  label="Market"
                                  columnKey="market"
                                  sort={marketSort}
                                  onSort={handleMarketSort}
                                  className="py-2 pr-3 font-medium"
                                />
                                <SortableTh
                                  label="Odds"
                                  columnKey="odds"
                                  sort={marketSort}
                                  onSort={handleMarketSort}
                                  defaultDirection="desc"
                                  align="right"
                                  className="py-2 pr-3 font-medium"
                                />
                                <SortableTh
                                  label="Fair Prob"
                                  columnKey="fair"
                                  sort={marketSort}
                                  onSort={handleMarketSort}
                                  defaultDirection="desc"
                                  align="right"
                                  className="py-2 pr-3 font-medium"
                                  title="Bookmaker margin removed, so probabilities are comparable across fixtures"
                                />
                                <SortableTh
                                  label="Book"
                                  columnKey="book"
                                  sort={marketSort}
                                  onSort={handleMarketSort}
                                  className="py-2 pr-3 font-medium"
                                />
                                {(fixture.status === 'Finished' ||
                                  fixture.status === 'Void') && (
                                  <SortableTh
                                    label="Status"
                                    columnKey="status"
                                    sort={marketSort}
                                    onSort={handleMarketSort}
                                    className="py-2 pr-3 font-medium"
                                  />
                                )}
                                <SortableTh
                                  label="Tactical Rationale"
                                  columnKey="rationale"
                                  sort={marketSort}
                                  onSort={handleMarketSort}
                                  className="py-2 font-medium"
                                />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/80">
                              {tableMarkets.map((m) => (
                                <tr key={m.id}>
                                  <td className="py-2 pr-3 font-medium text-slate-900 whitespace-nowrap">
                                    {m.label}
                                  </td>
                                  <td className="py-2 pr-3 font-mono font-semibold text-slate-900 text-right tabular-nums whitespace-nowrap">
                                    {m.odds.toFixed(2)}
                                  </td>
                                  <td
                                    className="py-2 pr-3 font-mono text-slate-600 text-right tabular-nums whitespace-nowrap"
                                    title={`Raw implied: ${m.impliedProbability.toFixed(1)}%`}
                                  >
                                    {marketProbability(m).toFixed(1)}%
                                  </td>
                                  <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">
                                    {m.bookmaker || '—'}
                                  </td>
                                  {(fixture.status === 'Finished' ||
                                    fixture.status === 'Void') && (
                                    <td className="py-2 pr-3 whitespace-nowrap">
                                      <SettlementLabel
                                        status={evaluateMarketSettlement(fixture, m)}
                                      />
                                    </td>
                                  )}
                                  <td className="py-2 text-slate-600">
                                    {m.rationale}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {modelRows.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 space-y-1.5">
                          <p className="text-xs font-semibold text-slate-900">
                            Book vs model · 1X2
                            {fixture.modelAdvice && (
                              <span className="ml-2 font-normal text-slate-500">
                                model favours {fixture.modelAdvice}
                              </span>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
                            {modelRows.map((row) => (
                              <span
                                key={row.label}
                                className="inline-flex items-baseline gap-1.5"
                              >
                                <span className="font-sans font-medium text-slate-600">
                                  {row.label}
                                </span>
                                <span className="font-semibold text-slate-900">
                                  {row.book.toFixed(0)}%
                                </span>
                                <span className="text-slate-300">vs</span>
                                <span
                                  className={
                                    row.model > row.book
                                      ? 'font-semibold text-sky-700'
                                      : 'text-slate-500'
                                  }
                                >
                                  {row.model}%
                                </span>
                              </span>
                            ))}
                          </div>
                          <p className="text-[10px] leading-relaxed text-slate-400">
                            First figure is the de-vigged book price, second is the
                            API-Football model. They are shown side by side, never
                            averaged into one number.
                          </p>
                        </div>
                      )}

                      {analysisError && (
                        <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                          <AlertCircle
                            className="w-4 h-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span>{analysisError}</span>
                        </div>
                      )}

                      {deepAnalysis && (
                        <div className="pt-2 border-t border-slate-200 space-y-2 text-xs text-slate-700">
                          <p className="font-semibold text-slate-900">
                            API-Football Predictions &amp; Injury Watch
                          </p>
                          <p className="leading-relaxed">{deepAnalysis.summary}</p>
                          <p>
                            <span className="font-semibold text-slate-900">
                              Injuries &amp; Absences:{' '}
                            </span>
                            {deepAnalysis.teamNews}
                          </p>
                          {deepAnalysis.keyFactors.length > 0 && (
                            <ul className="list-disc pl-4 space-y-1 text-slate-600">
                              {deepAnalysis.keyFactors.map((factor, idx) => (
                                <li key={idx}>{factor}</li>
                              ))}
                            </ul>
                          )}
                          <p>
                            <span className="font-semibold text-slate-900">
                              Analyst note:{' '}
                            </span>
                            {deepAnalysis.bestAngle}
                          </p>
                        </div>
                      )}

                      {fixture.pricedAt && (
                        <p className="pt-2 border-t border-slate-200 text-[10px] leading-relaxed text-slate-400">
                          Prices captured {formatArchiveTime(fixture.pricedAt)}.
                          Once a match kicks off these odds are frozen permanently,
                          so reopening this date later resolves the same pick from
                          the same prices.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Interactive Market Odds Grid — highest probability first */}
                  {displayMarkets.length > 0 ? (
                    <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-1">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {marketChipsActive
                          ? `Markets · ${displayMarkets.length} of ${fixture.markets.length} meeting your filters`
                          : 'Markets · ranked by win probability'}
                      </p>
                      {!marketChipsActive &&
                        shortestPrice &&
                        shortestPrice.id !== pickMarket?.id &&
                        shortestPrice.id !== angle?.cover?.id && (
                          <p
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400"
                            title="Highest margin-adjusted win probability on this fixture — market context, not a recommendation"
                          >
                            <TrendingUp
                              className="w-3 h-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Shortest price</span>
                            <span className="font-medium text-slate-500">
                              {shortestPrice.label}
                            </span>
                            <span className="font-mono font-semibold text-slate-500 tabular-nums">
                              {marketProbability(shortestPrice).toFixed(0)}%
                            </span>
                          </p>
                        )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                      {displayMarkets.map((market) => {
                        const isSelected = activeLeg?.marketId === market.id;
                        const isRecommended = market.id === pickMarket?.id;
                        const probability = marketProbability(market);
                        const modelPct = modelPercentFor(
                          market,
                          fixture.modelProbabilities
                        );
                        const marketOutcome =
                          fixture.status === 'Finished' || fixture.status === 'Void'
                            ? evaluateMarketSettlement(fixture, market)
                            : null;
                        const unselectedTone =
                          marketOutcome === 'Win'
                            ? 'bg-emerald-50/70 border-emerald-200 text-slate-900 hover:bg-emerald-50 hover:border-emerald-300'
                            : marketOutcome === 'Lost'
                            ? 'bg-red-50/45 border-red-200/80 text-slate-900 hover:bg-red-50/70 hover:border-red-300'
                            : marketOutcome === 'Void'
                            ? 'bg-amber-50/60 border-amber-200 text-slate-900 hover:bg-amber-50 hover:border-amber-300'
                            : 'bg-slate-50 border-slate-200 text-slate-900 hover:border-slate-300 hover:bg-white';
                        return (
                          <button
                            key={market.id}
                            type="button"
                            onClick={() => onToggleMarket(fixture, market)}
                            disabled={!isPreMatch}
                            aria-pressed={isSelected}
                            title={[
                              !isPreMatch
                                ? 'Kickoff has passed — this price is no longer available for a new bet.'
                                : null,
                              market.rationale,
                              modelPct !== null
                                ? `API-Football model: ${modelPct}%`
                                : null,
                              market.bookmaker,
                            ]
                              .filter(Boolean)
                              .join(' — ')}
                            className={`group flex flex-col justify-between p-2.5 text-left rounded-lg border transition-colors cursor-pointer disabled:opacity-95 disabled:cursor-not-allowed min-h-[60px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-700 ${
                              isSelected
                                ? 'bg-emerald-700 border-emerald-700 text-white'
                                : unselectedTone
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 w-full">
                              <span
                                className={`inline-flex items-center gap-1 min-w-0 text-[11px] font-medium ${
                                  isSelected
                                    ? 'text-emerald-100'
                                    : 'text-slate-500'
                                }`}
                              >
                                {isSelected && (
                                  <Check
                                    className="w-3 h-3 shrink-0"
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="truncate">
                                  {marketTypeShortLabel(market.marketType)}
                                </span>
                              </span>
                              {marketOutcome ? (
                                <SettlementLabel
                                  status={marketOutcome}
                                  inverted={isSelected}
                                />
                              ) : (
                                isRecommended && (
                                  <span
                                    className={`text-[11px] font-semibold whitespace-nowrap ${
                                      isSelected
                                        ? 'text-white'
                                        : 'text-emerald-700'
                                    }`}
                                  >
                                    {pickLabel}
                                  </span>
                                )
                              )}
                            </div>
                            <div className="mt-1 flex items-end justify-between gap-1.5 w-full">
                              <span className="text-xs font-medium truncate">
                                {market.label}
                              </span>
                              <span className="text-right shrink-0 leading-tight">
                                <span
                                  className={`block text-sm font-mono font-semibold tabular-nums ${
                                    isSelected ? 'text-white' : 'text-slate-900'
                                  }`}
                                >
                                  {market.odds.toFixed(2)}
                                </span>
                                <span
                                  className={`block text-[10px] font-mono tabular-nums ${
                                    isSelected
                                      ? 'text-emerald-100'
                                      : probability >= 70
                                      ? 'text-emerald-700 font-semibold'
                                      : 'text-slate-400'
                                  }`}
                                  title="Margin-adjusted win probability"
                                >
                                  {probability.toFixed(0)}%
                                </span>
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    </>
                  ) : marketChipsActive ? (
                    <p className="text-xs text-slate-400 pt-1">
                      No markets on this match meet the current market,
                      probability and price filters.
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400 pt-1">
                      Pre-match bookmaker odds are not currently published for this fixture.
                    </p>
                  )}
                </div>

              </article>
            );
          })}
          </>

          {filteredFixtures.length > visibleLimit && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs">
              <span className="text-slate-600 font-mono tabular-nums">
                Showing {Math.min(visibleLimit, filteredFixtures.length)} of{' '}
                {filteredFixtures.length} matches
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 40)}
                  className="px-3.5 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Show 40 More
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleLimit(filteredFixtures.length)}
                  className="px-3.5 py-1.5 font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Show All ({filteredFixtures.length})
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
