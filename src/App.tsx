import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { TopBar, type ActiveTab } from './components/TopBar.tsx';
import { DateNavigator } from './components/DateNavigator.tsx';
import { FixtureBoard } from './components/FixtureBoard.tsx';
import { AccaTicketSlip } from './components/AccaTicketSlip.tsx';
import { CuratedAccaView } from './components/CuratedAccaView.tsx';
import { SavedSlipsView } from './components/SavedSlipsView.tsx';
import { SourcesView } from './components/SourcesView.tsx';
import type {
  AccaLeg,
  AccaStrategy,
  DailySlateResponse,
  DeepAnalysisResponse,
  Fixture,
  GroundingSource,
  MarketOption,
  SavedTicket,
} from './types/fixtures.ts';
import {
  buildLegsFromRefs,
  calculateTotalOdds,
} from './utils/accaMath.ts';
import { completeAccaToTargetOdds } from './utils/accaEngine.ts';
import { describeStrategy } from './utils/strategy.ts';
import type { TicketShape } from './utils/ticketShapes.ts';
import { isPreMatchFixture } from './utils/priceQuality.ts';
import {
  loadFixtureSnapshots,
  mergeFixturesIntoSnapshots,
  persistFixtureSnapshots,
  withSnapshot,
  type FixtureSnapshots,
} from './utils/fixtureSnapshots.ts';

const SAVED_STORAGE_KEY = 'matchslip_saved_tickets_v1';

function getClientLocalIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Blantyre',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function App() {
  const todayDate = getClientLocalIsoDate();
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [activeTab, setActiveTab] = useState<ActiveTab>('slate');
  const [strategy, setStrategy] = useState<AccaStrategy>('balanced');
  const [minOdds, setMinOdds] = useState<number>(2.8);
  const [maxLegs, setMaxLegs] = useState<number>(3);
  const [stake, setStake] = useState<number>(1);

  const [slate, setSlate] = useState<DailySlateResponse | null>(null);
  const [selectedLegs, setSelectedLegs] = useState<AccaLeg[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [deepAnalyses, setDeepAnalyses] = useState<
    Record<string, DeepAnalysisResponse>
  >({});
  const [analyzingIds, setAnalyzingIds] = useState<Record<string, boolean>>({});
  const [analysisErrors, setAnalysisErrors] = useState<Record<string, string>>(
    {}
  );
  const [extraSources, setExtraSources] = useState<GroundingSource[]>([]);
  const requestIdRef = useRef(0);

  const [savedTickets, setSavedTickets] = useState<SavedTicket[]>(() => {
    try {
      const raw = localStorage.getItem(SAVED_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [fixtureSnapshots, setFixtureSnapshots] = useState<FixtureSnapshots>(() =>
    loadFixtureSnapshots()
  );

  // Saved slips must keep their matchday even after the retention window.
  const savedTicketDatesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    savedTicketDatesRef.current = new Set(
      savedTickets
        .map((ticket) => ticket.dateIso)
        .filter((date): date is string => Boolean(date))
    );
  }, [savedTickets]);

  useEffect(() => {
    persistFixtureSnapshots(fixtureSnapshots, savedTicketDatesRef.current);
  }, [fixtureSnapshots]);

  useEffect(() => {
    try {
      localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedTickets));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedTickets]);

  const fetchSlateForDate = useCallback(
    async (
      targetDate: string,
      targetStrategy: AccaStrategy,
      targetMinOdds: number,
      targetMaxLegs: number,
      forceRefresh = false
    ) => {
      // Ignore responses that land after a newer request (rapid date switching).
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await fetch('/api/fixtures/today', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: targetDate,
            strategy: targetStrategy,
            minOdds: targetMinOdds,
            maxLegs: targetMaxLegs,
            forceRefresh,
          }),
        });

        const data = await res.json();
        if (requestId !== requestIdRef.current) return;
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load fixtures.');
        }

        const typed = data as DailySlateResponse;
        setSlate(typed);
        setFixtureSnapshots((prev) =>
          withSnapshot(
            prev,
            typed.date,
            typed.fixtures,
            savedTicketDatesRef.current
          )
        );

        const initialLegs = buildLegsFromRefs(
          typed.fixtures,
          typed.recommendedLegIds
        );
        const guaranteedLegs = completeAccaToTargetOdds(
          typed.fixtures,
          initialLegs,
          targetMinOdds,
          targetStrategy,
          targetMaxLegs
        );
        setSelectedLegs(guaranteedLegs);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Unable to retrieve the football schedule for this date.'
          );
        }
      } finally {
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchSlateForDate(todayDate, 'balanced', 2.8, 3, false);
  }, [fetchSlateForDate, todayDate]);

  const handleChangeDate = (nextDate: string) => {
    setSelectedDate(nextDate);
    fetchSlateForDate(nextDate, strategy, minOdds, maxLegs, false);
  };

  const handleChangeStrategy = (nextStrategy: AccaStrategy) => {
    setStrategy(nextStrategy);
    if (slate && slate.fixtures.length > 0) {
      const locked = selectedLegs.filter((l) => l.locked);
      const rebuilt = completeAccaToTargetOdds(
        slate.fixtures,
        locked,
        minOdds,
        nextStrategy,
        maxLegs
      );
      setSelectedLegs(rebuilt);
    } else {
      fetchSlateForDate(selectedDate, nextStrategy, minOdds, maxLegs, false);
    }
  };

  const handleChangeMinOdds = (nextMinOdds: number) => {
    setMinOdds(nextMinOdds);
    if (slate && slate.fixtures.length > 0) {
      const updated = completeAccaToTargetOdds(
        slate.fixtures,
        selectedLegs,
        nextMinOdds,
        strategy,
        maxLegs
      );
      setSelectedLegs(updated);
    }
  };

  const handleChangeMaxLegs = (nextMaxLegs: number) => {
    setMaxLegs(nextMaxLegs);
    if (slate && slate.fixtures.length > 0) {
      const updated = completeAccaToTargetOdds(
        slate.fixtures,
        selectedLegs,
        minOdds,
        strategy,
        nextMaxLegs
      );
      setSelectedLegs(updated);
    }
  };

  const handleApplyShape = (shape: TicketShape) => {
    setStrategy(shape.strategy);
    setMinOdds(shape.targetOdds);
    setMaxLegs(shape.maxLegs);

    if (!slate) return;
    const locked = selectedLegs.filter((leg) => leg.locked);
    setSelectedLegs(
      completeAccaToTargetOdds(
        slate.fixtures,
        locked,
        shape.targetOdds,
        shape.strategy,
        shape.maxLegs
      )
    );
  };

  const handleToggleMarket = (fixture: Fixture, market: MarketOption) => {
    // A price on a live or finished match is not a bet that can be placed.
    if (!isPreMatchFixture(fixture)) return;

    setSelectedLegs((prev) => {
      const existing = prev.find((l) => l.fixtureId === fixture.id);
      if (existing && existing.marketId === market.id) {
        return prev.filter((l) => l.fixtureId !== fixture.id);
      }

      const nextLeg: AccaLeg = {
        fixtureId: fixture.id,
        homeTeam: fixture.homeTeam,
        awayTeam: fixture.awayTeam,
        competition: fixture.competition,
        matchDate: fixture.matchDate,
        kickoffTime: fixture.kickoffTime,
        marketId: market.id,
        marketLabel: market.label,
        marketType: market.marketType,
        odds: market.odds,
        impliedProbability: market.impliedProbability,
        fairProbability: market.fairProbability,
        rationale: market.rationale,
        locked: existing?.locked ?? false,
      };

      if (existing) {
        return prev.map((l) => (l.fixtureId === fixture.id ? nextLeg : l));
      }
      return [...prev, nextLeg];
    });
  };

  const handleRemoveLeg = (fixtureId: string) => {
    setSelectedLegs((prev) => prev.filter((l) => l.fixtureId !== fixtureId));
  };

  const handleToggleLock = (fixtureId: string) => {
    setSelectedLegs((prev) =>
      prev.map((l) =>
        l.fixtureId === fixtureId ? { ...l, locked: !l.locked } : l
      )
    );
  };

  const handleAutoCompleteToTarget = () => {
    if (!slate) return;
    setSelectedLegs((prev) =>
      completeAccaToTargetOdds(slate.fixtures, prev, minOdds, strategy, maxLegs)
    );
  };

  const handleRebuildUnlocked = () => {
    if (!slate) return;
    const locked = selectedLegs.filter((l) => l.locked);
    const unlockedIds = new Set(
      selectedLegs.filter((l) => !l.locked).map((l) => l.fixtureId)
    );

    // Rotate fixtures so unlocked picks try fresh matches first
    const rotatedFixtures = [
      ...slate.fixtures.filter((f) => !unlockedIds.has(f.id)),
      ...slate.fixtures.filter((f) => unlockedIds.has(f.id)),
    ];

    setSelectedLegs(
      completeAccaToTargetOdds(
        rotatedFixtures,
        locked,
        minOdds,
        strategy,
        maxLegs
      )
    );
  };

  const handleResetRecommended = () => {
    if (!slate) return;
    const recommended = buildLegsFromRefs(
      slate.fixtures,
      slate.recommendedLegIds
    );
    setSelectedLegs(
      completeAccaToTargetOdds(
        slate.fixtures,
        recommended,
        minOdds,
        strategy,
        maxLegs
      )
    );
  };

  const handleSaveTicket = (ticketStake: number) => {
    if (selectedLegs.length === 0) return;

    // Never save a slip containing a match that has already started: the
    // price is no longer available and the settlement would be meaningless.
    const hasStartedLeg = selectedLegs.some((leg) => {
      const fixture = slate?.fixtures.find((entry) => entry.id === leg.fixtureId);
      return fixture ? !isPreMatchFixture(fixture) : false;
    });
    if (hasStartedLeg) return;

    const totalOdds = calculateTotalOdds(selectedLegs);
    const ticket: SavedTicket = {
      id: `slip-${Date.now()}`,
      name: `${selectedLegs.length}-Leg ${strategy.charAt(0).toUpperCase() + strategy.slice(1)} Acca (${totalOdds.toFixed(2)} Odds)`,
      createdAt: new Date().toISOString(),
      date: slate?.displayDate || getClientLocalIsoDate(),
      dateIso: slate?.date,
      stake: ticketStake,
      totalOdds,
      legs: selectedLegs,
    };
    setSavedTickets((prev) => [ticket, ...prev]);
  };

  const handleLoadTicket = (ticket: SavedTicket) => {
    setSelectedLegs(ticket.legs);
    setStake(ticket.stake);
    setActiveTab('slate');
  };

  const handleDeleteTicket = (ticketId: string) => {
    setSavedTickets((prev) => prev.filter((t) => t.id !== ticketId));
  };

  /**
   * Pulls fresh status/score for the fixtures behind saved slips, then folds
   * them into the local snapshots so settled slips stay settled after reload.
   */
  const handleRefreshSavedResults = useCallback(
    async (fixtureIds: string[], forceRefresh = false): Promise<Fixture[]> => {
      if (fixtureIds.length === 0) return [];

      const res = await fetch('/api/fixtures/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixtureIds, forceRefresh }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Could not refresh match results.');
      }

      const refreshed: Fixture[] = Array.isArray(data?.fixtures)
        ? (data.fixtures as Fixture[])
        : [];
      if (refreshed.length > 0) {
        setFixtureSnapshots((prev) =>
          mergeFixturesIntoSnapshots(
            prev,
            refreshed,
            savedTicketDatesRef.current
          )
        );
      }
      return refreshed;
    },
    []
  );

  /**
   * Reads the archived board for a saved leg's matchday. Read-only: the
   * archive keeps the prices, rationales, form, and model snapshot the slip
   * was actually built from.
   */
  const handleLoadMatchDetails = useCallback(
    async (dateIso: string, fixtureIds: string[]): Promise<Fixture[]> => {
      if (!dateIso || fixtureIds.length === 0) return [];

      const res = await fetch('/api/fixtures/detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateIso, fixtureIds }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Could not load the archived matchday.');
      }

      return Array.isArray(data?.fixtures)
        ? (data.fixtures as Fixture[])
        : [];
    },
    []
  );

  const handleRequestDeepAnalysis = async (fixture: Fixture) => {
    setAnalyzingIds((prev) => ({ ...prev, [fixture.id]: true }));
    setAnalysisErrors((prev) => {
      const next = { ...prev };
      delete next[fixture.id];
      return next;
    });

    try {
      const res = await fetch('/api/fixtures/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixtureId: fixture.id,
          homeTeam: fixture.homeTeam,
          awayTeam: fixture.awayTeam,
          competition: fixture.competition,
          date: slate?.date || getClientLocalIsoDate(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to analyze match.');
      }

      const typed = data as DeepAnalysisResponse;
      setDeepAnalyses((prev) => ({ ...prev, [fixture.id]: typed }));
      if (typed.sources?.length) {
        setExtraSources((prev) => {
          const existing = new Set(prev.map((s) => s.uri));
          const additions = typed.sources.filter((s) => !existing.has(s.uri));
          return [...prev, ...additions];
        });
      }
    } catch (err) {
      setAnalysisErrors((prev) => ({
        ...prev,
        [fixture.id]:
          err instanceof Error ? err.message : 'Unable to fetch live match report.',
      }));
    } finally {
      setAnalyzingIds((prev) => ({ ...prev, [fixture.id]: false }));
    }
  };

  const allSources = [
    ...(slate?.sources ?? []),
    ...extraSources.filter(
      (es) => !(slate?.sources ?? []).some((s) => s.uri === es.uri)
    ),
  ];

  // Derived from current state, never from the last server payload, so the
  // Curated Acca heading always matches the strategy actually applied to the legs.
  const strategyCopy = describeStrategy(strategy, minOdds);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onRefresh={() => fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)}
        isLoading={isLoading}
        savedCount={savedTickets.length}
      />

      {/* Universal Matchday Date Bar across all views */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-900">
              Matchday Schedule
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-mono text-slate-700 tabular-nums">
              {slate?.displayDate || selectedDate}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span>{slate?.timezoneLabel || 'CAT (GMT+2) Kickoff Times'}</span>
          </div>

          <DateNavigator
            selectedDate={selectedDate}
            todayDate={todayDate}
            isFetchingDate={isLoading}
            onChangeDate={handleChangeDate}
          />
        </div>
      </div>

      <main className="flex-1 w-full max-w-[1380px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {isLoading && !slate ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8 space-y-4">
              <div className="h-8 w-72 bg-slate-200 rounded-md animate-pulse" />
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="py-4 border-b last:border-b-0 border-slate-100 space-y-2.5"
                  >
                    <div className="h-3 w-48 bg-slate-200 rounded animate-pulse" />
                    <div className="h-5 w-64 bg-slate-200 rounded animate-pulse" />
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-1">
                      {[1, 2, 3, 4, 5].map((m) => (
                        <div
                          key={m}
                          className="h-14 bg-slate-100 rounded-lg animate-pulse"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="h-6 w-44 bg-slate-200 rounded animate-pulse" />
              <div className="h-16 bg-slate-100 rounded-lg animate-pulse" />
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-14 bg-slate-100 rounded-lg animate-pulse"
                />
              ))}
            </div>
          </div>
        ) : errorMessage && !slate ? (
          <div className="max-w-xl mx-auto bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
            <AlertCircle
              className="w-8 h-8 text-red-600 mx-auto"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <h1 className="text-lg font-bold text-slate-900">
                Could not load fixtures for {selectedDate}
              </h1>
              <p className="text-sm text-slate-600">{errorMessage}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) handleChangeDate(e.target.value);
                }}
                aria-label="Pick another date"
                className="h-9 px-3 text-xs font-mono text-slate-800 bg-white border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={() => fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry Loading Slate</span>
              </button>
            </div>
          </div>
        ) : slate ? (
          <>
            {errorMessage && (
              <div className="mb-6 flex items-center justify-between gap-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)}
                  className="font-semibold underline whitespace-nowrap cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {activeTab === 'slate' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8 min-w-0">
                  <FixtureBoard
                    fixtures={slate.fixtures}
                    selectedDate={selectedDate}
                    todayDate={todayDate}
                    displayDate={slate.displayDate}
                    timezoneLabel={slate.timezoneLabel}
                    dataProvider={slate.dataProvider || 'API-Football Pro'}
                    slateSource={slate.slateSource}
                    capturedAt={slate.capturedAt}
                    isFetchingDate={isLoading}
                    selectedLegs={selectedLegs}
                    strategy={strategy}
                    onToggleMarket={handleToggleMarket}
                    deepAnalyses={deepAnalyses}
                    analyzingIds={analyzingIds}
                    analysisErrors={analysisErrors}
                    onRequestDeepAnalysis={handleRequestDeepAnalysis}
                  />
                </div>
                <div className="lg:col-span-4 min-w-0">
                  <AccaTicketSlip
                    legs={selectedLegs}
                    fixtures={slate.fixtures}
                    minOdds={minOdds}
                    maxLegs={maxLegs}
                    strategy={strategy}
                    displayDate={slate.displayDate}
                    stake={stake}
                    onChangeStake={setStake}
                    onChangeStrategy={handleChangeStrategy}
                    onChangeMinOdds={handleChangeMinOdds}
                    onChangeMaxLegs={handleChangeMaxLegs}
                    onApplyShape={handleApplyShape}
                    onRemoveLeg={handleRemoveLeg}
                    onToggleLock={handleToggleLock}
                    onAutoCompleteToTarget={handleAutoCompleteToTarget}
                    onRebuildUnlocked={handleRebuildUnlocked}
                    onResetRecommended={handleResetRecommended}
                    onClearAll={() => setSelectedLegs([])}
                    onSaveTicket={handleSaveTicket}
                  />
                </div>
              </div>
            )}

            {activeTab === 'acca' && (
              <CuratedAccaView
                strategyName={strategyCopy.title}
                strategySummary={strategyCopy.summary}
                selectedDate={selectedDate}
                displayDate={slate.displayDate}
                isFetchingDate={isLoading}
                legs={selectedLegs}
                fixtures={slate.fixtures}
                minOdds={minOdds}
                stake={stake}
                onGoToSlate={() => setActiveTab('slate')}
                onSaveTicket={handleSaveTicket}
                onAutoComplete={handleAutoCompleteToTarget}
              />
            )}

            {activeTab === 'saved' && (
              <SavedSlipsView
                savedTickets={savedTickets}
                fixtures={slate.fixtures}
                fixtureSnapshots={fixtureSnapshots}
                todayDate={todayDate}
                onLoadTicket={handleLoadTicket}
                onDeleteTicket={handleDeleteTicket}
                onGoToSlate={() => setActiveTab('slate')}
                onRefreshResults={handleRefreshSavedResults}
                onLoadMatchDetails={handleLoadMatchDetails}
              />
            )}

            {activeTab === 'sources' && (
              <SourcesView
                sources={allSources}
                displayDate={slate.displayDate}
                cachedAt={slate.cachedAt}
                onGoToSlate={() => setActiveTab('slate')}
              />
            )}
          </>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>MatchSlip · Grounded Daily Football Accumulator Workbench</span>
          <span>
            18+ only · Bet responsibly · Odds and match schedules should be
            verified with your sportsbook prior to placement.
          </span>
        </div>
      </footer>
    </div>
  );
}
