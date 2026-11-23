import { useEffect, useMemo, useState } from 'react';
import type {
  AccaLeg,
  AccaStrategy,
  DeepAnalysisResponse,
  Fixture,
  MarketOption,
  PickRecordsResponse,
} from '../types/fixtures.ts';
import { apiFetch } from '../utils/api.ts';
import {
  evaluateMarketSettlement,
  getFixtureMatchResultSummary,
} from '../utils/accaMath.ts';
import {
  getAnalystNote,
  resolveAnalystNoteMarket,
} from '../utils/analystNote.ts';
import {
  marketProbability,
  sortFixturesByProbability,
  sortMarketsByProbability,
} from '../utils/probability.ts';
import type { SortDirection, SortState } from '../utils/tableSort.ts';
import { SORT_ASC, sortRows, toggleSort } from '../utils/tableSort.ts';
import { resolvePick } from '../utils/pickResolver.ts';
import { isPreMatchFixture } from '../utils/priceQuality.ts';
import {
  angleConfidence,
  buildRecommendedAngle,
} from '../utils/recommendedAngle.ts';
import {
  MARKET_FILTERS,
  bestModelEdge,
  boardMarketPool,
  countAngleBands,
  countCoverBands,
  countMarketSelections,
  countMarketTypes,
  countModelEdges,
  countNoteBands,
  hasMarketFilters,
  matchingMarkets,
  matchesSlateFilters,
  parseOddsInput,
} from '../utils/slateFilters.ts';
import {
  DEFAULT_SLATE_FILTER_STATE,
  loadSlateFilterState,
  saveSlateFilterState,
} from '../utils/slateFilterState.ts';
import type { SlateFilterState } from '../utils/slateFilterState.ts';
import {
  detectFilterPreset,
  presetFilters,
} from '../utils/slateFilterPresets.ts';
import type { SlateFilterPresetSelection } from '../utils/slateFilterPresets.ts';
import { EmptyState, InlineLoading } from './ui/States.tsx';
import { SectionNav } from './ui/DataStatus.tsx';
import { ActiveFilterBar } from './fixtures/ActiveFilterBar.tsx';
import { FixtureCard } from './fixtures/FixtureCard.tsx';
import { FixtureFilters } from './fixtures/FixtureFilters.tsx';
import { PickRecordSummary } from './fixtures/PickRecordSummary.tsx';
import { SlateHeader } from './fixtures/SlateHeader.tsx';
import type {
  ActiveFilterChip,
  FixtureCardModel,
  StatusFilter,
  SortMode,
} from './fixtures/fixtureShared.ts';
import {
  CONFIDENCE_FILTER_LABELS,
  marketTypeShortLabel,
} from './fixtures/fixtureShared.ts';

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
  isRecapturing?: boolean;
  /** Explicitly replaces frozen prices with a fresh capture. */
  onRecapturePrices?: () => void;
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
  /** Optional controlled preset, deep-linked from the URL by App. */
  activePreset?: SlateFilterPresetSelection;
  onPresetChange?: (id: SlateFilterPresetSelection) => void;
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
  isRecapturing = false,
  onRecapturePrices,
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
  activePreset: controlledPreset,
  onPresetChange,
}: FixtureBoardProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState<string>('ALL');
  // One object so the chips, the saved copy and the storage write agree.
  // App may own this value to sync filters to the signed-in user's account.
  const [internalFilters, setInternalFilters] = useState<SlateFilterState>(
    loadSlateFilterState
  );
  const [internalPreset, setInternalPreset] = useState<SlateFilterPresetSelection>(
    () => detectFilterPreset(loadSlateFilterState())
  );
  const filters = controlledFilters ?? internalFilters;
  const activePreset = controlledPreset ?? internalPreset;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('board');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [compactCards, setCompactCards] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState<number>(40);
  // Default keeps the previous behaviour: most likely market first.
  const [marketSort, setMarketSort] = useState<SortState>({
    key: 'fair',
    direction: 'desc',
  });
  const [pickRecords, setPickRecords] = useState<PickRecordsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<PickRecordsResponse>('/api/fixtures/pick-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy }),
    })
      .then((data) => {
        if (!cancelled) setPickRecords(data);
      })
      .catch(() => {
        // The board works without history; never block fixtures on a stat.
        if (!cancelled) setPickRecords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  const handlePresetChange = (id: SlateFilterPresetSelection) => {
    if (onPresetChange) {
      onPresetChange(id);
      return;
    }
    setInternalPreset(id);
    if (id !== 'custom') setInternalFilters(presetFilters(id));
  };

  const updateFilters = (patch: Partial<SlateFilterState>) => {
    const next = { ...filters, ...patch };
    if (onFiltersChange) {
      onFiltersChange(next);
    } else {
      setInternalFilters(next);
      setInternalPreset(detectFilterPreset(next));
    }
  };

  const resetSlateFilters = () => {
    if (onFiltersChange) onFiltersChange(DEFAULT_SLATE_FILTER_STATE);
    else setInternalFilters(DEFAULT_SLATE_FILTER_STATE);
    if (onPresetChange) onPresetChange('default');
    else setInternalPreset('default');
  };

  const toggleSelection = (key: string) => {
    const next = marketSelections.includes(key)
      ? marketSelections.filter((item) => item !== key)
      : [...marketSelections, key];
    // A legacy type chip (from a shared link or saved preferences) must not
    // contradict the outcome the user just picked.
    updateFilters({ marketSelections: next, marketType: 'all' });
  };

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

  const slateFilters = useMemo(
    () => ({
      angle: filters.angle,
      cover: filters.cover,
      note: filters.note,
      marketType: filters.marketType,
      marketSelections: filters.marketSelections,
      minProbability: filters.minProbability,
      minOdds: parseOddsInput(filters.minOddsInput),
      maxOdds: parseOddsInput(filters.maxOddsInput),
      minModelEdge: filters.minModelEdge,
      kickoffWindowHours: filters.kickoffWindowHours,
    }),
    [filters]
  );

  // Selecting individual outcomes switches the board from its five-card
  // shortlist to the full priced ladder, where unders and other lines live.
  const marketPools = useMemo(() => {
    const map = new Map<string, MarketOption[]>();
    for (const fixture of fixtures) {
      map.set(fixture.id, boardMarketPool(fixture, slateFilters));
    }
    return map;
  }, [fixtures, slateFilters]);

  // One angle per fixture, shared by the filters, the facet counts and the
  // cards so the screen cannot rank the same match two different ways.
  const anglesByFixture = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildRecommendedAngle>>();
    for (const fixture of fixtures) {
      map.set(
        fixture.id,
        buildRecommendedAngle(fixture, strategy, marketPools.get(fixture.id))
      );
    }
    return map;
  }, [fixtures, strategy, marketPools]);

  const angleFor = (fixture: Fixture) => anglesByFixture.get(fixture.id) ?? null;

  // The note filter and the note card share one resolution. A fresh on-demand
  // brief can override the stored advice, so it is part of the cache key.
  const notesByFixture = useMemo(() => {
    const map = new Map<
      string,
      { text: string | null; market: MarketOption | null }
    >();
    for (const fixture of fixtures) {
      const text = getAnalystNote(fixture, deepAnalyses[fixture.id]?.bestAngle);
      map.set(fixture.id, {
        text,
        market: text ? resolveAnalystNoteMarket(fixture, text) : null,
      });
    }
    return map;
  }, [fixtures, deepAnalyses]);

  const noteMarketFor = (fixture: Fixture): MarketOption | null =>
    notesByFixture.get(fixture.id)?.market ?? null;

  const marketChipsActive = hasMarketFilters(slateFilters);

  const hasSlateFilters =
    angleFilter !== 'all' ||
    coverFilter !== 'all' ||
    noteFilter !== 'all' ||
    marketChipsActive ||
    minModelEdge > 0 ||
    kickoffWindowHours > 0;

  // What the sticky summary bar renders, one removable chip per active filter.
  const activeFilterChips: ActiveFilterChip[] = [];
  if (searchQuery.trim()) {
    activeFilterChips.push({
      key: 'search',
      label: `Search: ${searchQuery.trim()}`,
      clear: () => setSearchQuery(''),
    });
  }
  if (selectedCompetition !== 'ALL') {
    activeFilterChips.push({
      key: 'competition',
      label: `League: ${selectedCompetition}`,
      clear: () => setSelectedCompetition('ALL'),
    });
  }
  if (statusFilter !== 'all') {
    activeFilterChips.push({
      key: 'status',
      label: `Status: ${
        statusFilter === 'odds'
          ? 'With odds'
          : statusFilter === 'upcoming'
          ? 'Upcoming'
          : statusFilter === 'played'
          ? 'Live / finished'
          : 'Void'
      }`,
      clear: () => setStatusFilter('all'),
    });
  }
  if (angleFilter !== 'all') {
    activeFilterChips.push({
      key: 'angle',
      label: `Angle: ${CONFIDENCE_FILTER_LABELS[angleFilter]}`,
      clear: () => updateFilters({ angle: 'all' }),
    });
  }
  if (coverFilter !== 'all') {
    activeFilterChips.push({
      key: 'cover',
      label: `Cover: ${CONFIDENCE_FILTER_LABELS[coverFilter]}`,
      clear: () => updateFilters({ cover: 'all' }),
    });
  }
  if (noteFilter !== 'all') {
    activeFilterChips.push({
      key: 'note',
      label: `Note: ${CONFIDENCE_FILTER_LABELS[noteFilter]}`,
      clear: () => updateFilters({ note: 'all' }),
    });
  }
  if (marketType !== 'all') {
    activeFilterChips.push({
      key: 'market',
      label: `Market: ${marketTypeShortLabel(marketType)}`,
      clear: () => updateFilters({ marketType: 'all' }),
    });
  }
  if (marketSelections.length > 0) {
    activeFilterChips.push({
      key: 'selections',
      label: `Markets: ${marketSelections
        .map(
          (key) =>
            MARKET_FILTERS.find((selection) => selection.key === key)
              ?.shortLabel ?? key
        )
        .join(', ')}`,
      clear: () => updateFilters({ marketSelections: [], marketType: 'all' }),
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
    for (const fixture of fixtures) {
      if (fixture.hasLiveOdds) withOdds++;
      if (fixture.status === 'Scheduled' && !fixture.awaitingResult) upcoming++;
      else if (fixture.status === 'Void') voided++;
      else if (fixture.status === 'Live' || fixture.status === 'Finished') played++;
    }
    return { total: fixtures.length, withOdds, upcoming, played, voided };
  }, [fixtures]);

  const competitions = useMemo(() => {
    const compCounts = new Map<string, number>();
    for (const fixture of fixtures) {
      compCounts.set(
        fixture.competition,
        (compCounts.get(fixture.competition) ?? 0) + 1
      );
    }
    return Array.from(compCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([name, count]) => ({ name, count }));
  }, [fixtures]);

  // Search, status and competition narrow the pool before the slate filters,
  // so the facet counts describe what the chips would actually show.
  const baseFixtures = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return fixtures.filter((fixture) => {
      if (statusFilter === 'odds' && !fixture.hasLiveOdds) return false;
      if (
        statusFilter === 'upcoming' &&
        !(fixture.status === 'Scheduled' && !fixture.awaitingResult)
      ) {
        return false;
      }
      if (
        statusFilter === 'played' &&
        fixture.status !== 'Live' &&
        fixture.status !== 'Finished'
      ) {
        return false;
      }
      if (statusFilter === 'void' && fixture.status !== 'Void') return false;
      if (
        selectedCompetition !== 'ALL' &&
        fixture.competition !== selectedCompetition
      ) {
        return false;
      }
      if (!query) return true;
      return (
        fixture.homeTeam.toLowerCase().includes(query) ||
        fixture.awayTeam.toLowerCase().includes(query) ||
        fixture.competition.toLowerCase().includes(query) ||
        fixture.country.toLowerCase().includes(query)
      );
    });
  }, [fixtures, searchQuery, selectedCompetition, statusFilter]);

  const facetCounts = useMemo(
    () => ({
      angles: countAngleBands(baseFixtures, angleFor),
      covers: countCoverBands(baseFixtures, angleFor),
      notes: countNoteBands(baseFixtures, noteMarketFor),
      marketTypes: countMarketTypes(baseFixtures),
      selections: countMarketSelections(baseFixtures),
      modelEdges: countModelEdges(baseFixtures),
    }),
    // `angleFor` and `noteMarketFor` close over these caches.
    [baseFixtures, anglesByFixture, notesByFixture]
  );

  const filteredFixtures = useMemo(() => {
    const matching = baseFixtures.filter((fixture) =>
      matchesSlateFilters(
        fixture,
        slateFilters,
        angleFor(fixture),
        Date.now(),
        noteMarketFor(fixture)
      )
    );

    return sortMode === 'probability'
      ? sortFixturesByProbability(matching)
      : matching;
    // These helpers close over the per-fixture caches.
  }, [baseFixtures, slateFilters, anglesByFixture, notesByFixture, sortMode]);

  const selectedByFixture = useMemo(() => {
    const map = new Map<string, AccaLeg>();
    for (const leg of selectedLegs) {
      map.set(leg.fixtureId, leg);
    }
    return map;
  }, [selectedLegs]);

  const toggleExpanded = (id: string) => {
    const willExpand = !expandedIds[id];
    setExpandedIds((previous) => ({ ...previous, [id]: !previous[id] }));
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
    setMarketSort((previous) => toggleSort(previous, key, defaultDirection));
  };

  const hasFrozenPrices = fixtures.some(
    (fixture) => fixture.status !== 'Scheduled' && fixture.markets.length > 0
  );
  const showRecapture = Boolean(
    onRecapturePrices && (slateSource === 'archive' || hasFrozenPrices)
  );
  const pickLabel =
    strategy === 'probability' ? 'Highest chance' : 'Recommended';

  const fixtureModels: FixtureCardModel[] = filteredFixtures
    .slice(0, visibleLimit)
    .map((fixture) => {
      const isExpanded = Boolean(expandedIds[fixture.id]);
      // The tile grid follows the market chips too: a ≥70% filter hides
      // every 57% tile instead of just dropping the match.
      const displayMarkets = sortMarketsByProbability(
        matchingMarkets(fixture, slateFilters)
      );
      // Only the expanded brief renders this table.
      const tableMarkets = isExpanded
        ? sortRows<MarketOption>(matchingMarkets(fixture, slateFilters), marketSort, {
            market: (market) => market.label,
            odds: (market) => market.odds,
            fair: (market) => marketProbability(market),
            book: (market) => market.bookmaker ?? '',
            status: (market) => evaluateMarketSettlement(fixture, market),
            rationale: (market) => market.rationale,
          })
        : [];
      const deepAnalysis = deepAnalyses[fixture.id];
      const analystNote = notesByFixture.get(fixture.id)?.text ?? null;
      const noteMarket = noteMarketFor(fixture);
      const angle = angleFor(fixture);
      const isSettled =
        fixture.status === 'Finished' || fixture.status === 'Void';
      const homeForm = deepAnalysis?.formHome || fixture.formHome;
      const awayForm = deepAnalysis?.formAway || fixture.formAway;
      const hasScore =
        fixture.status !== 'Scheduled' &&
        fixture.status !== 'Void' &&
        fixture.score &&
        fixture.score.home !== null &&
        fixture.score.away !== null;

      return {
        fixture,
        isExpanded,
        activeLeg: selectedByFixture.get(fixture.id) ?? null,
        displayMarkets,
        tableMarkets,
        deepAnalysis,
        isAnalyzing: Boolean(analyzingIds[fixture.id]),
        analysisError: analysisErrors[fixture.id],
        homeForm,
        awayForm,
        hasScore: Boolean(hasScore),
        hasHalftime: Boolean(
          hasScore &&
            fixture.score?.halftimeHome !== null &&
            fixture.score?.halftimeHome !== undefined &&
            fixture.score?.halftimeAway !== null &&
            fixture.score?.halftimeAway !== undefined
        ),
        pickMarket: resolvePick(fixture, strategy, marketPools.get(fixture.id)),
        pickLabel,
        pickOutcome: null,
        resultSummary: getFixtureMatchResultSummary(fixture),
        angle,
        angleOutcome: null,
        coverOutcome: null,
        analystNote,
        noteBand: noteMarket
          ? angleConfidence(marketProbability(noteMarket))
          : null,
        noteOutcome: null,
        shortestPrice: angle?.shortestPrice ?? null,
        isPreMatch: isPreMatchFixture(fixture),
        isSettled,
        modelEdge: bestModelEdge(fixture),
        showModelEdge: minModelEdge > 0,
        marketChipsActive,
      };
    })
    .map((model) => {
      const { fixture } = model;
      const pickOutcome = model.pickMarket
        ? evaluateMarketSettlement(fixture, model.pickMarket)
        : fixture.status === 'Void'
        ? 'Void'
        : null;
      const noteMarket = notesByFixture.get(fixture.id)?.market ?? null;
      return {
        ...model,
        pickOutcome:
          fixture.status === 'Finished' || fixture.status === 'Void'
            ? pickOutcome
            : null,
        angleOutcome:
          model.angle && model.isSettled
            ? evaluateMarketSettlement(fixture, model.angle.market)
            : null,
        coverOutcome:
          model.angle?.cover && model.isSettled
            ? evaluateMarketSettlement(fixture, model.angle.cover)
            : null,
        noteOutcome:
          noteMarket && model.isSettled
            ? evaluateMarketSettlement(fixture, noteMarket)
            : null,
      };
    });

  return (
    <section aria-label="Football fixtures by date" className="space-y-4">
      <SlateHeader
        selectedDate={selectedDate}
        todayDate={todayDate}
        displayDate={displayDate}
        timezoneLabel={timezoneLabel}
        dataProvider={dataProvider}
        slateSource={slateSource}
        capturedAt={capturedAt}
        isFetchingDate={isFetchingDate}
        isRecapturing={isRecapturing}
        onRecapturePrices={onRecapturePrices}
        showRecapture={showRecapture}
        resultCount={filteredFixtures.length}
        totalCount={fixtures.length}
      />

      {pickRecords && pickRecords.sampleFixtures > 0 && (
        <PickRecordSummary {...pickRecords} />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCompactCards((value) => !value)}
          aria-pressed={compactCards}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
        >
          {compactCards ? 'Comfortable cards' : 'Compact cards'}
        </button>
      </div>

      <SectionNav
        label="On this page"
        items={[
          { id: 'slate-filters', label: 'Filters' },
          { id: 'slate-results', label: `Results (${filteredFixtures.length})` },
        ]}
      />

      <FixtureFilters
        filters={filters}
        activePreset={activePreset}
        onPresetChange={handlePresetChange}
        onUpdateFilters={updateFilters}
        onResetSlateFilters={resetSlateFilters}
        hasSlateFilters={hasSlateFilters}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCompetition={selectedCompetition}
        onCompetitionChange={setSelectedCompetition}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        counts={counts}
        baseCount={baseFixtures.length}
        competitions={competitions}
        facetCounts={facetCounts}
        minOdds={minOdds}
        maxOdds={maxOdds}
        onToggleSelection={toggleSelection}
      />

      <ActiveFilterBar chips={activeFilterChips} onReset={resetAllFilters} />

      <div id="slate-results" className="scroll-mt-24 space-y-3">
        {isFetchingDate && (
          <InlineLoading
            label={`Loading matches and live bookmaker odds for ${selectedDate}…`}
          />
        )}

        {fixtureModels.length === 0 ? (
          <EmptyState
            title="No fixtures match your current filters"
            description="Loosen the insight, market, probability or price filters — or clear the search and competition scope — to see more of this matchday."
            action={
              <button
                type="button"
                onClick={resetAllFilters}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Reset filters
              </button>
            }
          />
        ) : (
          <>
            {fixtureModels.map((model) => (
              <FixtureCard
                key={model.fixture.id}
                model={model}
                compact={compactCards}
                pickLabel={pickLabel}
                marketChipsActive={marketChipsActive}
                marketSort={marketSort}
                onMarketSort={handleMarketSort}
                onToggleExpanded={() => toggleExpanded(model.fixture.id)}
                onToggleMarket={(market) => onToggleMarket(model.fixture, market)}
                onRequestDeepAnalysis={() => onRequestDeepAnalysis(model.fixture)}
              />
            ))}

            {filteredFixtures.length > visibleLimit && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
                <span className="font-mono tabular-nums text-slate-600">
                  Showing {Math.min(visibleLimit, filteredFixtures.length)} of{' '}
                  {filteredFixtures.length} matches
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibleLimit((previous) => previous + 40)}
                    className="rounded-lg bg-emerald-700 px-3.5 py-1.5 font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                  >
                    Show 40 More
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleLimit(filteredFixtures.length)}
                    className="rounded-lg bg-slate-100 px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-200 cursor-pointer"
                  >
                    Show All ({filteredFixtures.length})
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
