import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { TopBar, type ActiveTab } from './components/TopBar.tsx';
import { DateNavigator } from './components/DateNavigator.tsx';
import { FixtureBoard } from './components/FixtureBoard.tsx';
import { AccaTicketSlip } from './components/AccaTicketSlip.tsx';
import { CuratedAccaView } from './components/CuratedAccaView.tsx';
import { SavedSlipsView } from './components/SavedSlipsView.tsx';
import { MyActivityView } from './components/MyActivityView.tsx';
import { SourcesView } from './components/SourcesView.tsx';
import { AuthDialog } from './components/AuthDialog.tsx';
import { AdminPanel } from './components/AdminPanel.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { useAuth } from './context/AuthContext.tsx';
import type {
  AccaLeg,
  AccaStrategy,
  DailySlateResponse,
  DeepAnalysisResponse,
  Fixture,
  GroundingSource,
  MarketOption,
  PublicSlateResponse,
  SavedTicket,
} from './types/fixtures.ts';
import {
  buildLegsFromRefs,
  calculateTotalOdds,
} from './utils/accaMath.ts';
import { completeAccaToTargetOdds } from './utils/accaEngine.ts';
import { MAX_RECOMMENDED_LEGS, guardTicket } from './utils/ticketGuard.ts';
import { apiFetch } from './utils/api.ts';
import { describeStrategy } from './utils/strategy.ts';
import type { TicketShape } from './utils/ticketShapes.ts';
import { isPreMatchFixture } from './utils/priceQuality.ts';
import {
  loadSlateFilterState,
  parseSlateFilterState,
} from './utils/slateFilterState.ts';
import type { SlateFilterState } from './utils/slateFilterState.ts';
import type { UserPreferences } from './types/user.ts';
import {
  loadFixtureSnapshots,
  mergeFixturesIntoSnapshots,
  persistFixtureSnapshots,
  withSnapshot,
  type FixtureSnapshots,
} from './utils/fixtureSnapshots.ts';
import {
  deleteCachedSlate,
  getCachedSlateOwner,
  readCachedSlate,
  setCachedSlateOwner,
  writeCachedSlate,
} from './utils/slateClientCache.ts';

const SAVED_STORAGE_KEY = 'matchslip_saved_tickets_v1';

type TicketSource = 'local' | 'server';

function loadLocalTickets(): SavedTicket[] {
  try {
    const raw = localStorage.getItem(SAVED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLocalTickets(): void {
  try {
    localStorage.removeItem(SAVED_STORAGE_KEY);
  } catch {
    // Storage unavailable; nothing to clear.
  }
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
  const {
    user,
    profile,
    loading: authLoading,
    notice,
    noticeTone,
    openAuth,
    signOut,
    dismissNotice,
    refresh: refreshAuth,
    resendVerification,
  } = useAuth();
  const todayDate = getClientLocalIsoDate();
  const isGuest = !authLoading && !user;
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

  // Guests only ever receive the sanitized match list; the full priced slate
  // is fetched exclusively for signed-in users.
  const [publicSlate, setPublicSlate] = useState<PublicSlateResponse | null>(null);
  const [publicLoading, setPublicLoading] = useState<boolean>(true);
  const [publicError, setPublicError] = useState<string | null>(null);

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
  const [ticketSource, setTicketSource] = useState<TicketSource>('local');
  const [importPrompt, setImportPrompt] = useState<SavedTicket[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SlateFilterState>(loadSlateFilterState);
  const [prefsReady, setPrefsReady] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  // Slate controls are read at fetch time from a ref so applying saved
  // preferences does not add them as refetch dependencies.
  const slateControlsRef = useRef({ strategy, minOdds, maxLegs });
  slateControlsRef.current = { strategy, minOdds, maxLegs };

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

  // Browser storage mirrors guest slips only. Once signed in, the server is
  // the source of truth and localStorage is left untouched (ready for import).
  useEffect(() => {
    if (ticketSource !== 'local') return;
    try {
      localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(savedTickets));
    } catch {
      // Ignore storage quota errors
    }
  }, [savedTickets, ticketSource]);

  /**
   * Loads account-owned tickets and preferences on sign-in, and reverts to
   * browser-local state on sign-out. Guest browsing stays fully functional.
   */
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    // Read the owner from storage, not a ref: a different account can reopen
    // the app in a fresh page load, and its priced slates must not be reused.
    const cacheOwner = user?.id ?? 'guest';
    const previousOwner = getCachedSlateOwner();
    if (previousOwner !== null && previousOwner !== cacheOwner) {
      deleteCachedSlate();
    }
    setCachedSlateOwner(cacheOwner);

    if (!user) {
      setTicketSource('local');
      setSavedTickets(loadLocalTickets());
      setFilters(loadSlateFilterState());
      setImportPrompt(null);
      setAdminOpen(false);
      // Priced slates are cleared above on the identity change; guests never
      // receive one from the public endpoint in the first place.
      setSlate(null);
      setSelectedLegs([]);
      setActiveTab('slate');
      setPrefsReady(true);
      return;
    }

    setTicketSource('server');
    setPrefsReady(false);
    void (async () => {
      try {
        const [ticketsResult, prefsResult] = await Promise.all([
          apiFetch<{ tickets: SavedTicket[] }>('/api/tickets'),
          apiFetch<UserPreferences>('/api/preferences'),
        ]);
        if (cancelled) return;

        const serverTickets = Array.isArray(ticketsResult.tickets)
          ? ticketsResult.tickets
          : [];
        setSavedTickets(serverTickets);
        if (serverTickets.length > 0) clearLocalTickets();

        try {
          setFilters(
            prefsResult.filtersJson
              ? parseSlateFilterState(JSON.parse(prefsResult.filtersJson))
              : loadSlateFilterState()
          );
        } catch {
          setFilters(loadSlateFilterState());
        }

        try {
          if (prefsResult.slateJson) {
            const saved = JSON.parse(prefsResult.slateJson) as Record<
              string,
              unknown
            >;
            if (isAccaStrategy(saved.strategy)) setStrategy(saved.strategy);
            if (typeof saved.minOdds === 'number' && Number.isFinite(saved.minOdds)) {
              setMinOdds(saved.minOdds);
            }
            if (typeof saved.maxLegs === 'number' && Number.isFinite(saved.maxLegs)) {
              // Older preference payloads can hold 4/6/8; the structural cap
              // applies on read as well as on write.
              setMaxLegs(
                Math.max(2, Math.min(saved.maxLegs, MAX_RECOMMENDED_LEGS))
              );
            }
          }
        } catch {
          // Corrupt preference payload: keep the defaults.
        }

        setPrefsReady(true);

        if (serverTickets.length === 0) {
          const local = loadLocalTickets();
          if (local.length > 0) setImportPrompt(local);
        }
      } catch {
        if (!cancelled) {
          setTicketSource('local');
          setSavedTickets(loadLocalTickets());
          setPrefsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, authLoading]);

  // Debounced sync of slate filters and controls to the signed-in account.
  useEffect(() => {
    if (!user || ticketSource !== 'server' || !prefsReady) return;
    const timer = window.setTimeout(() => {
      void apiFetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filtersJson: JSON.stringify(filters),
          slateJson: JSON.stringify({ strategy, minOdds, maxLegs }),
        }),
      }).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [user?.id, ticketSource, prefsReady, filters, strategy, minOdds, maxLegs]);

  const applySlateResponse = useCallback(
    (
      typed: DailySlateResponse,
      targetStrategy: AccaStrategy,
      targetMinOdds: number,
      targetMaxLegs: number
    ) => {
      prefRecomputedSlateRef.current = '';
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
      forceRefresh = false
    ) => {
      // A rapid date change cancels the previous request instead of merely
      // ignoring its response after it has consumed server work.
      slateAbortRef.current?.abort();

      // The response is keyed by date only; applySlateResponse rebuilds the
      // legs for whatever strategy and odds are active at render time.
      const cached = forceRefresh ? null : readCachedSlate(targetDate);
      if (cached) {
        ++requestIdRef.current;
        setErrorMessage(null);
        setIsLoading(false);
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
        if (requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [applySlateResponse]
  );

  useEffect(() => () => slateAbortRef.current?.abort(), []);

  // The priced slate does not depend on preferences, so start it as soon as
  // auth resolves instead of waiting for /tickets and /preferences to finish.
  useEffect(() => {
    if (authLoading || !user) return;
    const controls = slateControlsRef.current;
    fetchSlateForDate(
      todayDate,
      controls.strategy,
      controls.minOdds,
      controls.maxLegs,
      false
    );
  }, [fetchSlateForDate, todayDate, authLoading, user?.id]);

  // Saved controls may land while that request is in flight. Rebuild the legs
  // from the slate we already have rather than fetching the same date twice.
  useEffect(() => {
    if (!prefsReady || !user || !slate) return;
    const key = `${user.id}:${slate.cachedAt}`;
    if (prefRecomputedSlateRef.current === key) return;
    prefRecomputedSlateRef.current = key;

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
  }, [prefsReady, slate, user, strategy, minOdds, maxLegs]);

  const fetchPublicMatches = useCallback(async () => {
    setPublicLoading(true);
    setPublicError(null);
    try {
      const data = await apiFetch<PublicSlateResponse>(
        '/api/fixtures/public/today'
      );
      setPublicSlate(data);
    } catch (err) {
      setPublicError(
        err instanceof Error
          ? err.message
          : 'Unable to retrieve today’s match schedule.'
      );
    } finally {
      setPublicLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isGuest) return;
    void fetchPublicMatches();
  }, [isGuest, fetchPublicMatches]);

  const handleChangeDate = (nextDate: string) => {
    setSelectedDate(nextDate);
    fetchSlateForDate(nextDate, strategy, minOdds, maxLegs, false);
  };

  const handleChangeStrategy = (nextStrategy: AccaStrategy) => {
    setStrategy(nextStrategy);
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
    setSelectedLegs((prev) => guardLegs(prev));
  };

  const handleSaveTicket = async (ticketStake: number) => {
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

    if (user && ticketSource === 'server') {
      try {
        await apiFetch('/api/tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickets: [ticket] }),
        });
        setSavedTickets((prev) => [
          ticket,
          ...prev.filter((entry) => entry.id !== ticket.id),
        ]);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not save your slip.'
        );
      }
      return;
    }

    setSavedTickets((prev) => [ticket, ...prev]);
  };

  const handleLoadTicket = (ticket: SavedTicket) => {
    setSelectedLegs(ticket.legs);
    setStake(ticket.stake);
    setActiveTab('slate');
  };

  const handleDeleteTicket = async (ticketId: string) => {
    if (user && ticketSource === 'server') {
      try {
        await apiFetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
          method: 'DELETE',
        });
      } catch {
        // Remove locally regardless; the next reload reconciles with server.
      }
    }
    setSavedTickets((prev) => prev.filter((t) => t.id !== ticketId));
  };

  const handleImportLocal = async () => {
    if (!importPrompt || importPrompt.length === 0) return;
    setImportBusy(true);
    setErrorMessage(null);
    try {
      await apiFetch('/api/account/migrate-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets: importPrompt }),
      });
      const data = await apiFetch<{ tickets: SavedTicket[] }>('/api/tickets');
      setSavedTickets(Array.isArray(data.tickets) ? data.tickets : []);
      clearLocalTickets();
      setImportPrompt(null);
      void refreshAuth();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Could not import your saved slips.'
      );
    } finally {
      setImportBusy(false);
    }
  };

  const handleResendVerification = async () => {
    setVerificationBusy(true);
    setVerificationError(null);
    try {
      await resendVerification();
    } catch (err) {
      setVerificationError(
        err instanceof Error ? err.message : 'Could not send the verification email.'
      );
    } finally {
      setVerificationBusy(false);
    }
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

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onRefresh={() => fetchSlateForDate(selectedDate, strategy, minOdds, maxLegs, true)}
        isLoading={isLoading}
        savedCount={savedTickets.length}
        user={user}
        profile={profile}
        onSignIn={openAuth}
        onSignOut={() => void signOut()}
        onResendVerification={() => void handleResendVerification()}
        isAdmin={profile?.role === 'admin'}
        onAdmin={() => setAdminOpen((open) => !open)}
        isGuest={isGuest}
      />

      {notice && (
        <div
          role={noticeTone === 'error' ? 'alert' : 'status'}
          className={
            noticeTone === 'error'
              ? 'bg-amber-50 border-b border-amber-200'
              : 'bg-emerald-50 border-b border-emerald-200'
          }
        >
          <div
            className={`max-w-[1380px] mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs ${
              noticeTone === 'error' ? 'text-amber-900' : 'text-emerald-900'
            }`}
          >
            <span>{notice}</span>
            <div className="flex items-center gap-3 shrink-0">
              {noticeTone === 'error' && user && (
                <button
                  type="button"
                  onClick={() => void refreshAuth()}
                  className="font-semibold text-amber-900 underline hover:text-amber-700 cursor-pointer"
                >
                  Retry
                </button>
              )}
              {noticeTone === 'error' && !user && (
                <button
                  type="button"
                  onClick={openAuth}
                  className="font-semibold text-amber-900 underline hover:text-amber-700 cursor-pointer"
                >
                  Sign in
                </button>
              )}
              <button
                type="button"
                onClick={dismissNotice}
                aria-label="Dismiss"
                className={
                  noticeTone === 'error'
                    ? 'text-amber-800 hover:text-amber-950 cursor-pointer'
                    : 'text-emerald-700 hover:text-emerald-900 cursor-pointer'
                }
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {user && !user.emailVerified && (
        <div className="bg-amber-50 border-b border-amber-200" role="status">
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-amber-900">
            <div>
              <span className="font-semibold">Verify your email address.</span>{' '}
              <span className="text-amber-800">
                Check your inbox for the verification link, or send it again.
              </span>
              {verificationError && (
                <span className="block mt-1 text-red-700" role="alert">
                  {verificationError}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => void handleResendVerification()}
              disabled={verificationBusy}
              className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60 cursor-pointer"
            >
              {verificationBusy ? 'Sending…' : 'Resend verification email'}
            </button>
          </div>
        </div>
      )}

      {importPrompt && (
        <div className="bg-indigo-50 border-b border-indigo-200">
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-indigo-900">
              <span className="font-semibold">
                Bring your {importPrompt.length} saved slip
                {importPrompt.length === 1 ? '' : 's'} with you?
              </span>{' '}
              <span className="text-indigo-700">
                Import them into your account so they sync across devices. Your
                local copy stays until the import succeeds.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={importBusy}
                onClick={() => setImportPrompt(null)}
                className="px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 rounded-lg cursor-pointer disabled:opacity-60"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={importBusy}
                onClick={() => void handleImportLocal()}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {importBusy ? 'Importing…' : 'Import slips'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Universal Matchday Date Bar across all views (signed-in only) */}
      <div
        className={`bg-white border-b border-slate-200 ${
          isGuest ? 'hidden' : ''
        }`}
      >
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
            onChangeDate={handleChangeDate}
          />
        </div>
      </div>

      <main
        className={`flex-1 w-full max-w-[1380px] mx-auto px-4 sm:px-6 ${
          isGuest ? 'py-8 sm:py-12' : 'py-6 sm:py-8'
        }`}
      >
        {adminOpen && profile?.role === 'admin' && (
          <AdminPanel onClose={() => setAdminOpen(false)} />
        )}

        {isGuest ? (
          <LandingPage
            fixtures={publicSlate?.fixtures ?? []}
            displayDate={publicSlate?.displayDate ?? todayDate}
            timezoneLabel={
              publicSlate?.timezoneLabel ?? 'CAT (GMT+2) Kickoff Times'
            }
            loading={publicLoading}
            error={publicError}
            onRetry={() => void fetchPublicMatches()}
            onSignIn={openAuth}
          />
        ) : isLoading && !slate ? (
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
                    filters={filters}
                    onFiltersChange={setFilters}
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
                    onTrimToRecommended={handleTrimToRecommended}
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

            {activeTab === 'activity' && (
              <MyActivityView
                savedTickets={savedTickets}
                fixtures={slate.fixtures}
                fixtureSnapshots={fixtureSnapshots}
                signedIn={Boolean(user)}
                onGoToSlate={() => setActiveTab('slate')}
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
          <span>MatchSlip · Built on evidence, not hunches.</span>
          <span>
            18+ only · Bet responsibly · Odds and match schedules should be
            verified with your sportsbook prior to placement.
          </span>
        </div>
      </footer>

      <AuthDialog />
    </div>
  );
}
