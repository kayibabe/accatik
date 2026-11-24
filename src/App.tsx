import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { TopBar } from './components/TopBar.tsx';
import type { ActiveTab } from './types/navigation.ts';
import { SideMenu } from './components/SideMenu.tsx';
import { DateNavigator } from './components/DateNavigator.tsx';
import { FixtureBoard } from './components/FixtureBoard.tsx';
import { AccaTicketSlip } from './components/AccaTicketSlip.tsx';
import { CuratedAccaView } from './components/CuratedAccaView.tsx';
import { PickGuideView } from './components/PickGuideView.tsx';
import { SavedSlipsView } from './components/SavedSlipsView.tsx';
import { MyActivityView } from './components/MyActivityView.tsx';
import { AnalyticsView } from './components/AnalyticsView.tsx';
import { PositiveRoiView } from './components/PositiveRoiView.tsx';
import { PositiveReadMatches } from './components/analytics/PositiveReadMatches.tsx';
import { SourcesView } from './components/SourcesView.tsx';
import { AiView } from './components/AiView.tsx';
import { ErrorState } from './components/ui/States.tsx';
import type { AiTicketLeg } from './types/ai.ts';
import type { PositiveReadPick } from './types/analytics.ts';
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
import {
  eligiblePositiveReadPicks,
  mergePositiveReadPicks,
} from './utils/positiveReadSlip.ts';
import { mergeResearchLegs } from './utils/researchSlip.ts';
import {
  originFromTicketName,
  renameLegacyTicketName,
  ticketName,
  type SlipOrigin,
} from './utils/ticketNaming.ts';
import { MAX_RECOMMENDED_LEGS, guardTicket } from './utils/ticketGuard.ts';
import { apiFetch } from './utils/api.ts';
import { describeStrategy } from './utils/strategy.ts';
import type { TicketShape } from './utils/ticketShapes.ts';
import { isPreMatchFixture } from './utils/priceQuality.ts';
import {
  loadSlateFilterState,
  saveSlateFilterState,
} from './utils/slateFilterState.ts';
import type { SlateFilterState } from './utils/slateFilterState.ts';
import {
  detectFilterPreset,
  loadPresetPreference,
  presetFilters,
  savePresetPreference,
} from './utils/slateFilterPresets.ts';
import type { SlateFilterPresetSelection } from './utils/slateFilterPresets.ts';
import {
  parseAppUrlState,
  writeAppUrl,
} from './utils/urlState.ts';
import {
  loadFixtureSnapshots,
  mergeFixturesIntoSnapshots,
  persistFixtureSnapshots,
  withSnapshot,
  type FixtureSnapshots,
} from './utils/fixtureSnapshots.ts';
import {
  readCachedSlate,
  writeCachedSlate,
} from './utils/slateClientCache.ts';

const SAVED_STORAGE_KEY = 'matchslip_saved_tickets_v1';

function loadLocalTickets(): SavedTicket[] {
  try {
    const raw = localStorage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Slips saved before origin tracking get an origin prefix on first load.
    return renameLegacyTickets(parsed as SavedTicket[]);
  } catch {
    return [];
  }
}

/** One-off provenance rename applied to slips saved before origin tracking. */
function renameLegacyTickets(tickets: SavedTicket[]): SavedTicket[] {
  return tickets.map((ticket) => {
    const renamed = renameLegacyTicketName(ticket.name);
    return renamed ? { ...ticket, name: renamed } : ticket;
  });
}

function isAccaStrategy(value: unknown): value is AccaStrategy {
  return (
    value === 'balanced' ||
    value === 'favorites' ||
    value === 'goals' ||
    value === 'high-yield' ||
    value === 'probability'
  );
}

const SLATE_CONTROLS_STORAGE_KEY = 'matchslip_slate_controls_v1';

interface SlateControls {
  strategy: AccaStrategy;
  minOdds: number;
  maxLegs: number;
}

function loadSlateControls(): SlateControls {
  const defaults: SlateControls = {
    strategy: 'balanced',
    minOdds: 2.8,
    maxLegs: 3,
  };
  try {
    const raw = localStorage.getItem(SLATE_CONTROLS_STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    return {
      strategy: isAccaStrategy(saved.strategy) ? saved.strategy : defaults.strategy,
      minOdds:
        typeof saved.minOdds === 'number' && Number.isFinite(saved.minOdds)
          ? saved.minOdds
          : defaults.minOdds,
      maxLegs:
        typeof saved.maxLegs === 'number' && Number.isFinite(saved.maxLegs)
          ? Math.max(2, Math.min(saved.maxLegs, MAX_RECOMMENDED_LEGS))
          : defaults.maxLegs,
    };
  } catch {
    return defaults;
  }
}

function persistSlateControls(controls: SlateControls): void {
  try {
    localStorage.setItem(SLATE_CONTROLS_STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Storage unavailable; controls still work for this session.
  }
}

function getClientLocalIsoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Blantyre',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Trim engine output to the structural guard, preserving explicit locks. */
function guardLegs(legs: AccaLeg[]): AccaLeg[] {
  return guardTicket(legs, { preserveLocked: true }).legs;
}

export default function App() {
  const todayDate = getClientLocalIsoDate();
  // Tab, matchday and filter preset are deep-linkable (see utils/urlState.ts).
  const [initialUrl] = useState(() =>
    parseAppUrlState(
      typeof window === 'undefined' ? '' : window.location.search,
      todayDate
    )
  );
  const [initialControls] = useState(loadSlateControls);
  const [selectedDate, setSelectedDate] = useState<string>(
    initialUrl.date ?? todayDate
  );
  const [activeTab, setActiveTab] = useState<ActiveTab>(initialUrl.tab);
  const [activeSection, setActiveSection] = useState<string | undefined>(
    initialUrl.section
  );
  // Slate section links may point at content that renders after the slate loads.
  const pendingSectionRef = useRef<string | null>(initialUrl.section ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [strategy, setStrategy] = useState<AccaStrategy>(initialControls.strategy);
  const [minOdds, setMinOdds] = useState<number>(initialControls.minOdds);
  const [maxLegs, setMaxLegs] = useState<number>(initialControls.maxLegs);
  const [stake, setStake] = useState<number>(1);

  const [slate, setSlate] = useState<DailySlateResponse | null>(null);
  const [selectedLegs, setSelectedLegs] = useState<AccaLeg[]>([]);
  /** Carried into the saved ticket name so research slips stay traceable. */
  const [slipOrigin, setSlipOrigin] = useState<SlipOrigin>('slate');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRecapturing, setIsRecapturing] = useState<boolean>(false);
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
  const slateAbortRef = useRef<AbortController | null>(null);
  // Slate requests can start before saved controls arrive; this marks which
  // slate has already been reconciled with them.
  const prefRecomputedSlateRef = useRef('');

  const [savedTickets, setSavedTickets] = useState<SavedTicket[]>(loadLocalTickets);
  const [filterPreset, setFilterPreset] = useState<SlateFilterPresetSelection>(
    () => initialUrl.preset ?? loadPresetPreference()
  );
  const [filters, setFilters] = useState<SlateFilterState>(() =>
    initialUrl.preset && initialUrl.preset !== 'custom'
      ? presetFilters(initialUrl.preset)
      : loadSlateFilterState()
  );

  // Slate controls are read at fetch time from a ref so loading a cached slate
  // does not add them as refetch dependencies.
  const slateControlsRef = useRef({ strategy, minOdds, maxLegs });
  slateControlsRef.current = { strategy, minOdds, maxLegs };

  const [fixtureSnapshots, setFixtureSnapshots] = useState<FixtureSnapshots>(() =>
    loadFixtureSnapshots()
  );

  // Navigation writes history entries; date/preset changes only replace the
  // current one so typing or chip-clicking does not flood the back stack.
  const scrollPositionsRef = useRef<Partial<Record<ActiveTab, number>>>({});
  const navigate = useCallback(
    (tab: ActiveTab) => {
      if (tab === activeTab) return;
      scrollPositionsRef.current[activeTab] = window.scrollY;
      writeAppUrl({ tab, date: selectedDate, preset: filterPreset });
      setActiveSection(undefined);
      pendingSectionRef.current = null;
      setActiveTab(tab);
      const target = scrollPositionsRef.current[tab] ?? 0;
      window.requestAnimationFrame(() => window.scrollTo({ top: target }));
    },
    [activeTab, selectedDate, filterPreset]
  );

  /** Section tabs swap the visible page, so start each one at the top. */
  const selectSection = useCallback((id: string) => {
    setActiveSection(id);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
  }, []);

  useEffect(() => {
    writeAppUrl(
      { tab: activeTab, date: selectedDate, preset: filterPreset, section: activeSection },
      { replace: true }
    );
  }, [activeTab, selectedDate, filterPreset, activeSection]);

  useEffect(() => {
    const handlePopState = () => {
      const state = parseAppUrlState(window.location.search, todayDate);
      setActiveTab(state.tab);
      if (state.date) setSelectedDate(state.date);
      if (state.preset) {
        setFilterPreset(state.preset);
        if (state.preset !== 'custom') setFilters(presetFilters(state.preset));
      }
      setActiveSection(state.section);
      pendingSectionRef.current = state.section ?? null;
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [todayDate]);

  // Restore the original Slate in-page subnav behaviour: a deep-linked section
  // may not exist until the slate renders, so re-assert the scroll briefly.
  useEffect(() => {
    const id = pendingSectionRef.current;
    if (!id || activeTab !== 'slate') return;
    if (id !== 'slate-filters' && id !== 'slate-results') return;

    const startedAt = Date.now();
    const deadlineMs = 8000;
    const quietMs = 700;
    let lastMutationAt = startedAt;
    let lastTop: number | null = null;
    let lastTopAt = startedAt;
    let hasScrolled = false;

    const scrollToTarget = () => {
      const target = document.getElementById(id);
      if (!target) return;
      target.scrollIntoView({ behavior: 'instant', block: 'start' });
      hasScrolled = true;
    };

    const observer = new MutationObserver(() => {
      lastMutationAt = Date.now();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const interval = window.setInterval(() => {
      const now = Date.now();
      if (now - startedAt >= deadlineMs) {
        scrollToTarget();
        observer.disconnect();
        window.clearInterval(interval);
        pendingSectionRef.current = null;
        return;
      }
      const target = document.getElementById(id);
      if (!target) return;
      const top = target.getBoundingClientRect().top + window.scrollY;
      const moved = lastTop === null || Math.abs(top - lastTop) > 1;
      if (moved) {
        lastTop = top;
        lastTopAt = now;
        scrollToTarget();
      } else if (
        hasScrolled &&
        now - lastTopAt >= quietMs &&
        now - lastMutationAt >= quietMs
      ) {
        scrollToTarget();
        observer.disconnect();
        window.clearInterval(interval);
        pendingSectionRef.current = null;
      }
    }, 100);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, [activeTab, activeSection]);

  // Keep Slate section links out of the URL hash; they sync the query state.
  useEffect(() => {
    const handleSectionClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        'a[data-section-link][href^="#"]'
      );
      if (!anchor) return;
      const id = anchor.getAttribute('href')?.slice(1);
      if (!id) return;
      event.preventDefault();
      setActiveSection(id);
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        pendingSectionRef.current = null;
      } else {
        pendingSectionRef.current = id;
      }
    };
    document.addEventListener('click', handleSectionClick);
    return () => document.removeEventListener('click', handleSectionClick);
  }, []);

  const applyFilterPreset = useCallback((id: SlateFilterPresetSelection) => {
    setFilterPreset(id);
    savePresetPreference(id);
    if (id !== 'custom') setFilters(presetFilters(id));
  }, []);

  const handleFiltersChange = useCallback(
    (next: SlateFilterState) => {
      setFilters(next);
      const inferred = detectFilterPreset(next);
      setFilterPreset((current) => (current === inferred ? current : inferred));
      savePresetPreference(inferred);
    },
    []
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

  // Local-only persistence: saved slips, filters and slate controls all live
  // in this browser's localStorage while the app is being tested offline.
  useEffect(() => {
    try {
      localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedTickets));
    } catch {
      // Ignore storage quota errors.
    }
  }, [savedTickets]);

  useEffect(() => {
    saveSlateFilterState(filters);
  }, [filters]);

  useEffect(() => {
    persistSlateControls({ strategy, minOdds, maxLegs });
  }, [strategy, minOdds, maxLegs]);

  const applySlateResponse = useCallback(
    (
      typed: DailySlateResponse,
      targetStrategy: AccaStrategy,
      targetMinOdds: number,
      targetMaxLegs: number
    ) => {
      prefRecomputedSlateRef.current = '';
      setSlate(typed);
      setSlipOrigin('slate');
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
      setSelectedLegs(
        guardLegs(
          completeAccaToTargetOdds(
            typed.fixtures,
            initialLegs,
            targetMinOdds,
            targetStrategy,
            Math.min(targetMaxLegs, MAX_RECOMMENDED_LEGS)
          )
        )
      );
    },
    []
  );

  const fetchSlateForDate = useCallback(
    async (
      targetDate: string,
      targetStrategy: AccaStrategy,
      targetMinOdds: number,
      targetMaxLegs: number,
      forceRefresh = false,
      recapturePrices = false
    ) => {
      // A rapid date change cancels the previous request instead of merely
      // ignoring its response after it has consumed server work.
      slateAbortRef.current?.abort();
      setIsRecapturing(recapturePrices);

      // The response is keyed by date only; applySlateResponse rebuilds the
      // legs for whatever strategy and odds are active at render time.
      const cached = forceRefresh ? null : readCachedSlate(targetDate);
      if (cached) {
        ++requestIdRef.current;
        setErrorMessage(null);
        setIsLoading(false);
        setIsRecapturing(false);
        applySlateResponse(
          cached,
          targetStrategy,
          targetMinOdds,
          targetMaxLegs
        );
        return;
      }

      const controller = new AbortController();
      slateAbortRef.current = controller;
      // Ignore responses that land after a newer request (rapid date switching).
      const requestId = ++requestIdRef.current;
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const typed = await apiFetch<DailySlateResponse>('/api/fixtures/today', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: targetDate,
            strategy: targetStrategy,
            minOdds: targetMinOdds,
            maxLegs: targetMaxLegs,
            forceRefresh,
            recapturePrices,
          }),
          signal: controller.signal,
        });
        if (requestId !== requestIdRef.current) return;

        writeCachedSlate(targetDate, typed);
        applySlateResponse(typed, targetStrategy, targetMinOdds, targetMaxLegs);
      } catch (err) {
        if (requestId === requestIdRef.current) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Unable to retrieve the football schedule for this date.'
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
          setIsRecapturing(false);
        }
      }
    },
    [applySlateResponse]
  );

  useEffect(() => () => slateAbortRef.current?.abort(), []);

  // Controls are restored from localStorage before the first render, so the
  // initial slate request can start immediately.
  useEffect(() => {
    const controls = slateControlsRef.current;
    fetchSlateForDate(
      todayDate,
      controls.strategy,
      controls.minOdds,
      controls.maxLegs,
      false
    );
  }, [fetchSlateForDate, todayDate]);

  // Rebuild legs from the slate we already have when a cached response lands.
  useEffect(() => {
    if (!slate) return;
    const key = slate.cachedAt;
    if (prefRecomputedSlateRef.current === key) return;
    prefRecomputedSlateRef.current = key;
    setSlipOrigin('slate');

    const initialLegs = buildLegsFromRefs(slate.fixtures, slate.recommendedLegIds);
    setSelectedLegs(
      guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          initialLegs,
          minOdds,
          strategy,
          Math.min(maxLegs, MAX_RECOMMENDED_LEGS)
        )
      )
    );
  }, [slate, strategy, minOdds, maxLegs]);

  const handleChangeDate = (nextDate: string) => {
    setSelectedDate(nextDate);
    fetchSlateForDate(nextDate, strategy, minOdds, maxLegs, false);
  };

  // Explicitly unfreezes the selected matchday: fresh odds, a new capture
  // stamp, and picks rebuilt from that book. Ordinary refreshes never do this.
  const handleRecapturePrices = () => {
    if (isRecapturing) return;
    fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true, true);
  };

  const handleChangeStrategy = (nextStrategy: AccaStrategy) => {
    setStrategy(nextStrategy);
    setSlipOrigin('slate');
    if (slate && slate.fixtures.length > 0) {
      const locked = selectedLegs.filter((l) => l.locked);
      const rebuilt = guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          locked,
          minOdds,
          nextStrategy,
          maxLegs
        )
      );
      setSelectedLegs(rebuilt);
    } else {
      fetchSlateForDate(selectedDate, nextStrategy, minOdds, maxLegs, false);
    }
  };

  const handleChangeMinOdds = (nextMinOdds: number) => {
    setMinOdds(nextMinOdds);
    setSlipOrigin('slate');
    if (slate && slate.fixtures.length > 0) {
      const updated = guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          selectedLegs,
          nextMinOdds,
          strategy,
          maxLegs
        )
      );
      setSelectedLegs(updated);
    }
  };

  const handleChangeMaxLegs = (nextMaxLegs: number) => {
    const cappedMaxLegs = Math.min(nextMaxLegs, MAX_RECOMMENDED_LEGS);
    setMaxLegs(cappedMaxLegs);
    setSlipOrigin('slate');
    if (slate && slate.fixtures.length > 0) {
      const updated = guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          selectedLegs,
          minOdds,
          strategy,
          cappedMaxLegs
        )
      );
      setSelectedLegs(updated);
    }
  };

  const handleApplyShape = (shape: TicketShape) => {
    const cappedMaxLegs = Math.min(shape.maxLegs, MAX_RECOMMENDED_LEGS);
    setStrategy(shape.strategy);
    setMinOdds(shape.targetOdds);
    setMaxLegs(cappedMaxLegs);
    setSlipOrigin('slate');

    if (!slate) return;
    const locked = selectedLegs.filter((leg) => leg.locked);
    setSelectedLegs(
      guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          locked,
          shape.targetOdds,
          shape.strategy,
          cappedMaxLegs
        )
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
    setSlipOrigin('slate');
    setSelectedLegs((prev) =>
      guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          prev,
          minOdds,
          strategy,
          maxLegs
        )
      )
    );
  };

  const handleRebuildUnlocked = () => {
    if (!slate) return;
    setSlipOrigin('slate');
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
      guardLegs(
        completeAccaToTargetOdds(
          rotatedFixtures,
          locked,
          minOdds,
          strategy,
          maxLegs
        )
      )
    );
  };

  const handleResetRecommended = () => {
    if (!slate) return;
    setSlipOrigin('slate');
    const recommended = buildLegsFromRefs(
      slate.fixtures,
      slate.recommendedLegIds
    );
    setSelectedLegs(
      guardLegs(
        completeAccaToTargetOdds(
          slate.fixtures,
          recommended,
          minOdds,
          strategy,
          maxLegs
        )
      )
    );
  };

  /**
   * Manual escape hatch: a user can click past the cap, but the slip offers a
   * single action that returns to the structurally sound shape.
   */
  const handleTrimToRecommended = () => {
    setSlipOrigin('slate');
    setSelectedLegs((prev) => guardLegs(prev));
  };

  /** Pick Selection's audited shortlist enters the same slip as slate picks. */
  const handleApplyPickGuideLegs = (legs: AccaLeg[]) => {
    if (legs.length === 0) return;
    setSlipOrigin('slate');
    setSelectedLegs(guardLegs(legs));
    navigate('acca');
  };

  /**
   * AI-desk picks are research selections, like Positive Reads. They fold into
   * the slip without the recommendation cap; one leg per fixture still holds.
   */
  const handleApplyAiTicket = useCallback(
    (legs: AiTicketLeg[]) => {
      if (!slate || legs.length === 0) return;
      const built = buildLegsFromRefs(
        slate.fixtures,
        legs.map((leg) => ({ fixtureId: leg.fixtureId, marketId: leg.marketId }))
      );
      if (built.length === 0) return;
      setSlipOrigin('ai-desk');
      setSelectedLegs((prev) => mergeResearchLegs(prev, built));
      navigate('slate');
    },
    [slate, navigate]
  );

  /**
   * Positive-read cards carry their own market and price, so they go straight
   * into the slip. One pick per fixture: a later selection replaces the leg
   * already held for that match rather than creating a same-match combination.
   * Unlike the recommendation builders, this research path keeps every leg.
   */
  const handleAddPositiveReadPicks = useCallback((picks: PositiveReadPick[]): number => {
    const eligible = eligiblePositiveReadPicks(picks);
    if (eligible.length === 0) return 0;
    setSlipOrigin('positive-reads');
    setSelectedLegs((prev) => mergePositiveReadPicks(prev, eligible));
    return eligible.length;
  }, []);

  /** Resolves true only after the slip is actually persisted (or stored locally). */
  const handleSaveTicket = async (ticketStake: number): Promise<boolean> => {
    if (selectedLegs.length === 0) return false;

    // Never save a slip containing a match that has already started: the
    // price is no longer available and the settlement would be meaningless.
    const hasStartedLeg = selectedLegs.some((leg) => {
      const fixture = slate?.fixtures.find((entry) => entry.id === leg.fixtureId);
      return fixture ? !isPreMatchFixture(fixture) : false;
    });
    if (hasStartedLeg) return false;

    const totalOdds = calculateTotalOdds(selectedLegs);
    const ticket: SavedTicket = {
      id: `slip-${Date.now()}`,
      name: ticketName({
        origin: slipOrigin,
        legCount: selectedLegs.length,
        strategy,
        totalOdds,
      }),
      createdAt: new Date().toISOString(),
      date: slate?.displayDate || getClientLocalIsoDate(),
      dateIso: slate?.date,
      stake: ticketStake,
      totalOdds,
      legs: selectedLegs,
    };

    setSavedTickets((prev) => [ticket, ...prev]);
    return true;
  };

  const handleLoadTicket = (ticket: SavedTicket) => {
    setSelectedLegs(ticket.legs);
    setSlipOrigin(originFromTicketName(ticket.name) ?? 'slate');
    setStake(ticket.stake);
    navigate('slate');
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

      const data = await apiFetch<{ fixtures: Fixture[] }>(
        '/api/fixtures/results',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixtureIds, forceRefresh }),
        }
      );

      const refreshed: Fixture[] = Array.isArray(data?.fixtures)
        ? data.fixtures
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

      const data = await apiFetch<{ fixtures: Fixture[] }>(
        '/api/fixtures/detail',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateIso, fixtureIds }),
        }
      );

      return Array.isArray(data?.fixtures) ? data.fixtures : [];
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
      const typed = await apiFetch<DeepAnalysisResponse>('/api/fixtures/analyze', {
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

  // Outer page gutters are centralized in src/index.css (`--page-gutter*`,
  // `--page-menu-width*` and `--page-menu-gap*`). Tune them there to resize
  // the whole layout.
  const contentInset = 'page-inset-app';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={navigate}
        onRefresh={() => fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)}
        isLoading={isLoading}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        isMenuOpen={menuOpen}
      />

      <SideMenu
        activeTab={activeTab}
        onSelectTab={navigate}
        savedCount={savedTickets.length}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      {/* Universal Matchday Date Bar across all views */}
      <div className="sticky top-16 z-30 bg-white border-b border-slate-200 sm:ml-[var(--page-menu-width)] lg:ml-[var(--page-menu-width-lg)]">
        <div className="page-inset-guest py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
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
            onChangeDate={handleChangeDate}
          />
        </div>
      </div>

      <main className={`flex-1 w-full ${contentInset} py-6 sm:py-8`}>
        {activeTab === 'analytics' ? (
          <AnalyticsView
            strategy={strategy}
            strategyName={strategyCopy.title}
            minOdds={minOdds}
            maxLegs={maxLegs}
            todayDate={todayDate}
            activeSection={activeSection}
            onSectionChange={selectSection}
            onGoToSlate={() => navigate('slate')}
          />
        ) : activeTab === 'ai' ? (
          <AiView
            selectedDate={selectedDate}
            displayDate={slate?.displayDate || selectedDate}
            strategy={strategy}
            minOdds={minOdds}
            maxLegs={maxLegs}
            canApplyTicket={Boolean(slate)}
            onGoToSlate={() => navigate('slate')}
            onApplyTicket={handleApplyAiTicket}
          />
        ) : activeTab === 'positive-reads' ? (
          <div className="space-y-10">
            <PositiveReadMatches
              strategy={strategy}
              todayDate={todayDate}
              refreshKey={0}
              mode="build"
              selectedDate={selectedDate}
              onAddPicks={handleAddPositiveReadPicks}
              onOpenTicket={() => navigate('acca')}
            />
            <div className="border-t border-slate-200 pt-10">
              <PositiveRoiView
                strategy={strategy}
                selectedDate={selectedDate}
                displayDate={slate?.displayDate || selectedDate}
                activeSection={activeSection}
                onSectionChange={selectSection}
                onGoToSlate={() => navigate('slate')}
              />
            </div>
          </div>
        ) : activeTab === 'saved' ? (
          <SavedSlipsView
            savedTickets={savedTickets}
            fixtures={slate?.fixtures ?? []}
            fixtureSnapshots={fixtureSnapshots}
            todayDate={todayDate}
            hasCurrentTicket={selectedLegs.length > 0}
            onLoadTicket={handleLoadTicket}
            onDeleteTicket={handleDeleteTicket}
            onGoToSlate={() => navigate('slate')}
            onGoToActivity={() => navigate('activity')}
            onRefreshResults={handleRefreshSavedResults}
            onLoadMatchDetails={handleLoadMatchDetails}
          />
        ) : activeTab === 'activity' ? (
          <MyActivityView
            savedTickets={savedTickets}
            fixtures={slate?.fixtures ?? []}
            fixtureSnapshots={fixtureSnapshots}
            todayDate={todayDate}
            onGoToSlate={() => navigate('slate')}
          />
        ) : activeTab === 'sources' ? (
          <SourcesView
            sources={allSources}
            displayDate={slate?.displayDate ?? selectedDate}
            cachedAt={slate?.cachedAt ?? ''}
            onGoToSlate={() => navigate('slate')}
          />
        ) : activeTab === 'pick-guide' ? (
          <PickGuideView
            fixtures={slate?.fixtures ?? []}
            strategy={strategy}
            slateGuard={slate?.ticketGuard}
            onGoToSlate={() => navigate('slate')}
            onApplyLegs={handleApplyPickGuideLegs}
          />
        ) : isLoading && !slate ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 space-y-4">
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
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
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
          <ErrorState
            className="max-w-xl mx-auto"
            title={`Could not load fixtures for ${selectedDate}`}
            description={
              <>
                {errorMessage}
                <span className="mt-3 flex justify-center">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) handleChangeDate(e.target.value);
                    }}
                    aria-label="Pick another date"
                    className="h-9 px-3 text-xs font-mono text-slate-800 bg-white border border-slate-200 rounded-lg"
                  />
                </span>
              </>
            }
            onRetry={() =>
              fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)
            }
            retryLabel="Retry Loading Slate"
          />
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
                <div className="lg:col-span-7 min-w-0">
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
                    isRecapturing={isRecapturing}
                    onRecapturePrices={handleRecapturePrices}
                    selectedLegs={selectedLegs}
                    strategy={strategy}
                    onToggleMarket={handleToggleMarket}
                    deepAnalyses={deepAnalyses}
                    analyzingIds={analyzingIds}
                    analysisErrors={analysisErrors}
                    onRequestDeepAnalysis={handleRequestDeepAnalysis}
                    filters={filters}
                    onFiltersChange={handleFiltersChange}
                    activePreset={filterPreset}
                    onPresetChange={(id) =>
                      applyFilterPreset(id === 'custom' ? 'default' : id)
                    }
                  />
                </div>
                <div className="lg:col-span-5 min-w-0">
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
                    onTrimToRecommended={handleTrimToRecommended}
                    onClearAll={() => {
                      setSelectedLegs([]);
                      setSlipOrigin('slate');
                    }}
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
                savedTickets={savedTickets}
                fixtureSnapshots={fixtureSnapshots}
                todayDate={todayDate}
                minOdds={minOdds}
                stake={stake}
                onGoToSlate={() => navigate('slate')}
                onOpenArchive={() => navigate('saved')}
                onRefreshResults={handleRefreshSavedResults}
                onSaveTicket={handleSaveTicket}
                onAutoComplete={handleAutoCompleteToTarget}
              />
            )}

          </>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12">
        <div className={`${contentInset} py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500`}>
          <span>MatchSlip · Built on evidence, not hunches.</span>
          <span>
            18+ only · Bet responsibly · Odds and match schedules should be
            verified with your sportsbook prior to placement.
          </span>
        </div>
      </footer>
    </div>
  );
}
