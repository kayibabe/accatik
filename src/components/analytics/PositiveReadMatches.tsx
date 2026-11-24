import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Plus,
  Radio,
  RefreshCw,
  Target,
} from 'lucide-react';
import type { AccaStrategy, SettlementStatus } from '../../types/fixtures.ts';
import type {
  PositiveReadCombo,
  PositiveReadMatchesResponse,
  PositiveReadPick,
} from '../../types/analytics.ts';
import { apiFetch } from '../../utils/api.ts';
import { fmtCount, fmtOdds, fmtShortDate, fmtSignedPercent } from '../../utils/format.ts';
import {
  POSITIVE_READ_ROI_LABEL,
  POSITIVE_READ_TITLE,
  POSITIVE_READ_UNIVERSE_LABEL,
  positiveReadEyebrow,
  positiveReadIntroduction,
  positiveReadModeNote,
} from '../../utils/positiveReadCopy.ts';
import {
  applyPositiveReadFilters,
  derivePositiveReadOptions,
  groupPositiveReadCombos,
  loadPositiveReadFilters,
  positiveReadTier,
  reconcilePositiveReadFilters,
  samePositiveReadFilters,
  savePositiveReadFilters,
  DEFAULT_POSITIVE_READ_FILTERS,
  type PositiveReadFilterState,
  type PositiveReadTier,
} from '../../utils/positiveReadFilters.ts';
import { DateNavigator } from '../DateNavigator.tsx';
import { DataCard } from '../ui/DataCard.tsx';
import { EmptyState, ErrorState, InlineLoading, LoadingState } from '../ui/States.tsx';
import { PositiveReadDrillDown } from './PositiveReadDrillDown.tsx';

interface PositiveReadMatchesProps {
  strategy: AccaStrategy;
  todayDate: string;
  /** Bumped by the parent when settled results change. */
  refreshKey: number;
  /** `build` exposes add-to-slip actions and uses the app-wide date bar. */
  mode?: 'analytics' | 'build';
  /** Controlled matchday for Build mode. */
  selectedDate?: string;
  /** Returns the number of picks sent to the slip. */
  onAddPicks?: (picks: PositiveReadPick[]) => number;
  onOpenTicket?: () => void;
}

const TIER_STYLES: Record<PositiveReadTier, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed', className: 'bg-emerald-800 text-white' },
  qualified: { label: 'Qualified', className: 'bg-emerald-100 text-emerald-800' },
  observed: { label: 'Observed', className: 'bg-slate-100 text-slate-600' },
  'small-sample': { label: 'Small sample', className: 'bg-amber-100 text-amber-800' },
};

/** Settled picks read at a glance: green win, red loss, amber void. */
const PICK_STATUS_STYLES: Record<Exclude<SettlementStatus, 'Pending'>, string> = {
  Win: 'bg-emerald-100 text-emerald-800',
  Lost: 'bg-red-100 text-red-700',
  Void: 'bg-amber-100 text-amber-800',
  Live: 'bg-sky-100 text-sky-700',
};

function ComboChip({
  combo,
  pick,
  onAdd,
  matchCount,
  onJump,
  block = false,
}: {
  combo: PositiveReadCombo;
  pick?: PositiveReadPick;
  onAdd?: (pick: PositiveReadPick) => number;
  /** Fixtures on this matchday that matched this parameter. */
  matchCount?: number;
  onJump?: () => void;
  /** Equal-width columns for the Active parameters grid. */
  block?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const addable = Boolean(pick && pick?.status === 'Pending' && onAdd);
  const tier = TIER_STYLES[positiveReadTier(combo)];
  const title = [
    combo.label,
    `Inception ROI ${fmtSignedPercent(combo.roi)} from ${fmtCount(combo.staked)} staked picks`,
    `95% interval ${fmtSignedPercent(combo.roiCiLow)} to ${fmtSignedPercent(combo.roiCiHigh)}`,
    `${combo.positiveDates} of ${combo.totalDates} matchdays positive`,
    matchCount === undefined
      ? null
      : `${fmtCount(matchCount)} matched ${matchCount === 1 ? 'fixture' : 'fixtures'} on this matchday`,
    tier.label,
    combo.stable ? 'Stable' : null,
    pick?.bandDrift ? `Live band ${pick.band} drifted from study band ${combo.band}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const detailRows: Array<[string, string]> = [
    ['Parameter', combo.label],
    ['ROI', fmtSignedPercent(combo.roi)],
    ['95% interval', `${fmtSignedPercent(combo.roiCiLow)} to ${fmtSignedPercent(combo.roiCiHigh)}`],
    ['Staked picks', fmtCount(combo.staked)],
    ['Positive matchdays', `${fmtCount(combo.positiveDates)} / ${fmtCount(combo.totalDates)}`],
    ['Evidence', tier.label + (combo.stable ? ' · Stable' : '')],
  ];
  if (matchCount !== undefined) {
    detailRows.push(['Fixtures on this matchday', fmtCount(matchCount)]);
  }
  if (pick) {
    detailRows.push(['Market', pick.marketLabel]);
    detailRows.push(['Odds', fmtOdds(pick.odds)]);
    if (pick.fairProbability != null) {
      detailRows.push(['Fair probability', `${pick.fairProbability.toFixed(1)}%`]);
    }
    detailRows.push(['Implied probability', `${pick.impliedProbability.toFixed(1)}%`]);
    if (pick.bookmaker) detailRows.push(['Bookmaker', pick.bookmaker]);
    if (pick.bandDrift) detailRows.push(['Band drift', `Live ${pick.band} vs study ${pick.studyBand}`]);
    detailRows.push(['Status', pick.status]);
  }

  const hasMatches = (matchCount ?? 0) > 0;
  const accent = hasMatches
    ? {
        container: 'border-sky-400 bg-sky-100 text-sky-900',
        icon: 'text-sky-700',
        roi: 'text-sky-700',
        badge: 'text-sky-700',
        expand: 'text-sky-700 hover:bg-sky-100',
        detailBorder: 'border-sky-200/70',
      }
    : {
        container: 'border-emerald-200 bg-emerald-50 text-emerald-900',
        icon: 'text-emerald-700',
        roi: 'text-emerald-700',
        badge: 'text-emerald-700',
        expand: 'text-emerald-700 hover:bg-emerald-100',
        detailBorder: 'border-emerald-200/70',
      };
  const containerClass = `max-w-full rounded-lg border px-2.5 py-1.5 text-[11px] ${accent.container} ${
    block ? 'w-full' : 'inline-flex flex-col'
  }`;

  const summary = (
    <>
      <Target className={`h-3 w-3 shrink-0 ${accent.icon}`} aria-hidden="true" />
      <span className={`min-w-0 truncate font-semibold ${block ? 'flex-1 text-left' : ''}`}>
        {combo.label}
      </span>
      <span
        className={`shrink-0 font-mono tabular-nums ${accent.roi} ${
          block ? 'w-[54px] text-right' : ''
        }`}
      >
        {fmtSignedPercent(combo.roi)}
      </span>
      {pick && (
        <span className="shrink-0 rounded bg-white/80 px-1 py-0.5 font-mono tabular-nums text-emerald-800">
          {fmtOdds(pick.odds)}
        </span>
      )}
      {matchCount !== undefined && (
        <span
          className={`shrink-0 rounded bg-white/80 px-1 py-0.5 font-mono tabular-nums ${accent.badge} ${
            block ? 'w-[68px] text-center' : ''
          }`}
        >
          {fmtCount(matchCount)} {matchCount === 1 ? 'fixture' : 'fixtures'}
        </span>
      )}
      <span
        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${
          tier.className
        } ${block ? 'w-[84px] text-center' : ''}`}
      >
        {tier.label}
      </span>
      {pick?.bandDrift && (
        <span
          className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800"
          title={`Live ${pick.band} vs study ${combo.band}`}
        >
          Band drift
        </span>
      )}
      {pick && pick.status !== 'Pending' && (
        <span
          className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${PICK_STATUS_STYLES[pick.status]}`}
        >
          {pick.status}
        </span>
      )}
    </>
  );

  const expandButton = (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Hide' : 'Show'} details for ${combo.label}`}
      className={`inline-flex shrink-0 items-center rounded p-0.5 ${accent.expand} cursor-pointer`}
      title={expanded ? 'Hide details' : 'Show details'}
    >
      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );

  const details = expanded ? (
    <div className={`mt-2 w-full border-t ${accent.detailBorder} pt-2 text-[11px] text-slate-700 whitespace-normal`}>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {detailRows.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="shrink-0 text-slate-500">{label}</dt>
            <dd className="min-w-0 font-medium text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
      {pick?.rationale && (
        <p className="mt-2 leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">Explanation: </span>
          {pick.rationale}
        </p>
      )}
    </div>
  ) : null;

  if (onJump) {
    return (
      <div className={containerClass} title={title}>
        <div className={`flex items-center gap-1.5 ${block ? 'w-full' : ''}`}>
          <button
            type="button"
            onClick={onJump}
            className={`min-w-0 flex-1 inline-flex items-center gap-1.5 text-left cursor-pointer hover:underline focus-visible:outline-2 focus-visible:outline-emerald-700 rounded`}
          >
            {summary}
          </button>
          {expandButton}
        </div>
        {details}
      </div>
    );
  }

  return (
    <div className={containerClass} title={title}>
      <div className={`flex items-center gap-1.5 ${block ? 'w-full' : ''}`}>
        <div className={`min-w-0 flex-1 ${block ? 'flex items-center gap-1.5' : 'inline-flex items-center gap-1.5'}`}>
          {summary}
        </div>
        {addable && (
          <button
            type="button"
            onClick={() => onAdd?.(pick!)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add
          </button>
        )}
        {expandButton}
      </div>
      {details}
    </div>
  );
}

/**
 * Daily matches behind the positive cells of the section x band x market study.
 *
 * Archive is the default so a settled matchday and the ROI study read the same
 * frozen prices. `Live` is an explicit opt-in for upcoming fixtures and may
 * trigger an upstream slate fetch. In Build mode each labelled card can be
 * copied straight into the accumulator slip.
 */
export function PositiveReadMatches({
  strategy,
  todayDate,
  refreshKey,
  mode = 'analytics',
  selectedDate,
  onAddPicks,
  onOpenTicket,
}: PositiveReadMatchesProps) {
  const isBuild = mode === 'build';
  const [data, setData] = useState<PositiveReadMatchesResponse | null>(null);
  const [dateIso, setDateIso] = useState('');
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const [lastAdded, setLastAdded] = useState<number | null>(null);
  const [filters, setFilters] = useState<PositiveReadFilterState>(() =>
    loadPositiveReadFilters()
  );

  const effectiveDate = isBuild ? selectedDate || '' : dateIso;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await apiFetch<PositiveReadMatchesResponse>(
          '/api/analytics/positive-read-matches',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              strategy,
              dateIso: effectiveDate || undefined,
              live,
              force: localReload > 0,
            }),
          }
        );
        if (cancelled) return;
        setData(result);
        // The server resolves the default matchday when no date is supplied.
        // Keep `dateIso` as the user's choice only: writing the resolved date
        // back here would change this effect's dependency and refetch the same
        // report. The navigator reads data.dateIso instead.
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load qualifying reads.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy, effectiveDate, live, refreshKey, localReload, isBuild, dateIso]);

  const effectiveFilters = useMemo(
    () => (data ? reconcilePositiveReadFilters(filters, data.combos) : filters),
    [filters, data]
  );

  // Stored or stale choices that are no longer in the feed are cleaned up once.
  useEffect(() => {
    if (!data || samePositiveReadFilters(effectiveFilters, filters)) return;
    setFilters(effectiveFilters);
  }, [data, effectiveFilters, filters]);

  useEffect(() => {
    savePositiveReadFilters(filters);
  }, [filters]);

  const options = useMemo(
    () => (data ? derivePositiveReadOptions(data.combos, effectiveFilters) : null),
    [data, effectiveFilters]
  );
  const filtered = useMemo(
    () => (data ? applyPositiveReadFilters(data, effectiveFilters) : null),
    [data, effectiveFilters]
  );
  const groups = useMemo(
    () => (filtered ? groupPositiveReadCombos(filtered.combos) : []),
    [filtered]
  );

  // Match counts and jump targets come from the same filtered feed shown below,
  // so a chip never promises a fixture the current filters have hidden.
  const matchIdsByCombo = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const match of filtered?.matches ?? []) {
      for (const combo of match.combos) {
        const list = ids.get(combo.key);
        if (list) list.push(match.fixtureId);
        else ids.set(combo.key, [match.fixtureId]);
      }
    }
    return ids;
  }, [filtered]);

  const matchIdsBySection = useMemo(() => {
    const ids = new Map<string, string[]>();
    for (const match of filtered?.matches ?? []) {
      for (const section of new Set(match.combos.map((combo) => combo.section))) {
        const list = ids.get(section);
        if (list) list.push(match.fixtureId);
        else ids.set(section, [match.fixtureId]);
      }
    }
    return ids;
  }, [filtered]);

  const [focusedFixtureId, setFocusedFixtureId] = useState<string | null>(null);
  const [jumpCursor, setJumpCursor] = useState<Record<string, number>>({});

  /** Repeated clicks walk through every fixture behind a parameter. */
  const jumpToMatches = (cursorKey: string, fixtureIds: string[]) => {
    if (fixtureIds.length === 0) return;
    const next = ((jumpCursor[cursorKey] ?? -1) + 1) % fixtureIds.length;
    setJumpCursor((prev) => ({ ...prev, [cursorKey]: next }));
    const fixtureId = fixtureIds[next];
    setFocusedFixtureId(fixtureId);
    // Scroll synchronously: the target is already rendered, and this matches
    // the app's deep-link settling instead of depending on animation frames.
    document
      .getElementById(`positive-read-match-${fixtureId}`)
      ?.scrollIntoView({ behavior: 'instant', block: 'start' });
  };

  const reload = () => setLocalReload((value) => value + 1);

  const updateFilters = (patch: Partial<PositiveReadFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };
  const resetFilters = () => setFilters(DEFAULT_POSITIVE_READ_FILTERS);

  const addPicks = (picks: PositiveReadPick[]): number => {
    if (!onAddPicks) return 0;
    const sent = onAddPicks(picks);
    if (sent > 0) setLastAdded(sent);
    return sent;
  };

  const pendingPicks = filtered?.eligiblePicks ?? [];
  const universe = data?.universe;
  const universeLabel = universe
    ? `${universe.sections.length} sections × ${universe.bands.length} bands × ${universe.markets.length} markets`
    : POSITIVE_READ_UNIVERSE_LABEL;
  const displayedDate = data?.dateIso || effectiveDate || todayDate;
  const surface = isBuild ? 'build' : 'analytics';

  return (
    <section aria-label="Daily qualifying reads" className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            {positiveReadEyebrow({ strategy, mode: surface, source: live ? 'live' : 'archive' })}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <CalendarDays className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            {POSITIVE_READ_TITLE}
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            {positiveReadIntroduction(fmtShortDate(displayedDate))}
          </p>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">
            {positiveReadModeNote(surface)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isBuild && (
            <DateNavigator
              selectedDate={dateIso || data?.dateIso || todayDate}
              todayDate={todayDate}
              onChangeDate={setDateIso}
            />
          )}
          <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
            <button
              type="button"
              onClick={() => setLive(false)}
              aria-pressed={!live}
              className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                !live ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Archive
            </button>
            <button
              type="button"
              onClick={() => setLive(true)}
              aria-pressed={live}
              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                live ? 'bg-emerald-700 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Radio className="h-3 w-3" aria-hidden="true" />
              Live
            </button>
          </div>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          {isBuild && onOpenTicket && (
            <button
              type="button"
              onClick={onOpenTicket}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
            >
              Open ticket
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {isBuild && lastAdded !== null && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
        >
          {fmtCount(lastAdded)} {lastAdded === 1 ? 'pick' : 'picks'} sent to your slip. Open the
          ticket to check the final shape — qualifying reads keep every pending pick, one per
          fixture.
        </p>
      )}

      {isBuild && !live && filtered && filtered.matches.length > 0 && pendingPicks.length === 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          These archived picks are already settled, so they cannot join a slip.{' '}
          <button
            type="button"
            onClick={() => setLive(true)}
            className="font-semibold underline cursor-pointer"
          >
            Switch to Live prices
          </button>{' '}
          to add upcoming fixtures.
        </p>
      )}

      {loading && !data ? (
        <LoadingState label="Loading qualifying reads…" count={3} />
      ) : error ? (
        <ErrorState title="Could not load qualifying reads" description={error} onRetry={reload} />
      ) : !data || data.combos.length === 0 ? (
        <EmptyState
          title="No qualifying reads yet"
          description={`The fixed combination study has no section × band × market parameter with inception-to-date ROI of ${POSITIVE_READ_ROI_LABEL} or more, so there is no qualifying parameter to ${
            isBuild ? 'pick from' : 'match'
          } yet.`}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <span>
              Study as of <strong className="font-semibold">{fmtShortDate(data.studyGeneratedAt)}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Universe: <strong className="font-semibold">{universeLabel}</strong>, fixed for every
              read
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Qualifying reads: ROI <strong className="font-semibold">≥ {POSITIVE_READ_ROI_LABEL}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold">{fmtCount(data.qualifiedCount)}</strong> qualified
              parameters
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold">{fmtCount(data.confirmedCount)}</strong> confirmed
              parameters
            </span>
            <span aria-hidden="true">·</span>
            <span>min sample {fmtCount(data.minSample)} for evidence badges</span>
            <span aria-hidden="true">·</span>
            {data.studyExcludedDateIso ? (
              <span className="font-medium text-emerald-700">
                {fmtShortDate(data.studyExcludedDateIso)} excluded from study (out-of-sample)
              </span>
            ) : (
              <span className="font-medium text-emerald-700">
                Live study includes every archived matchday
              </span>
            )}
          </div>

          {options && filtered && (
            <PositiveReadDrillDown
              options={options}
              state={effectiveFilters}
              onChange={updateFilters}
              onReset={resetFilters}
              idPrefix={isBuild ? 'build-positive-reads' : 'analytics-positive-reads'}
              counts={{
                combos: filtered.combos.length,
                totalCombos: data.combos.length,
                matches: filtered.matches.length,
                totalMatches: data.matches.length,
              }}
            />
          )}

          <DataCard
            title="Qualifying parameters"
            subtitle={`${fmtCount(filtered?.combos.length ?? 0)} of ${fmtCount(data.combos.length)} qualifying ${data.combos.length === 1 ? 'combination' : 'combinations'} with ROI ≥ ${POSITIVE_READ_ROI_LABEL}`}
            actions={
              <div className="flex items-center gap-2">
                {isBuild && pendingPicks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => addPicks(pendingPicks)}
                    title="Add every currently filtered, pending pick without the five-leg cut"
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                  >
                    Add all pending picks
                  </button>
                )}
                {loading && <InlineLoading label="Refreshing…" />}
              </div>
            }
          >
            {filtered && filtered.combos.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No parameters match these filters"
                  description="Loosen the section, band, market, sample or ROI filters to bring parameters back."
                  action={
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Reset filters
                    </button>
                  }
                />
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <p className="text-[11px] text-slate-400">
                  Select a section or parameter to jump to its fixtures on{' '}
                  {fmtShortDate(displayedDate)}.
                </p>
                {groups.map((group) => {
                  const sectionFixtureIds = matchIdsBySection.get(group.combos[0]?.section ?? '') ?? [];
                  return (
                    <div key={group.sectionLabel}>
                      <button
                        type="button"
                        disabled={sectionFixtureIds.length === 0}
                        onClick={() =>
                          jumpToMatches(`section:${group.sectionLabel}`, sectionFixtureIds)
                        }
                        title={`Jump to a fixture matched by ${group.sectionLabel}`}
                        className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:cursor-default disabled:hover:bg-transparent cursor-pointer"
                      >
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {group.sectionLabel}
                        </span>
                        <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-slate-600">
                          {fmtCount(group.combos.length)} params
                        </span>
                        <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-700">
                          {fmtCount(sectionFixtureIds.length)} fixtures
                        </span>
                        <ArrowRight className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
                      </button>
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 items-start">
                        {group.combos.map((combo) => {
                          const fixtureIds = matchIdsByCombo.get(combo.key) ?? [];
                          return (
                            <ComboChip
                              key={combo.key}
                              combo={combo}
                              block
                              matchCount={fixtureIds.length}
                              onJump={
                                fixtureIds.length > 0
                                  ? () => jumpToMatches(combo.key, fixtureIds)
                                  : undefined
                              }
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </DataCard>

          {filtered && filtered.combos.length > 0 && filtered.matches.length === 0 ? (
            data.matches.length === 0 ? (
              <EmptyState
                title={`No fixtures on ${data.dateIso}`}
                description={
                  data.source === 'archive'
                    ? 'No fixture on this matchday produced one of the qualifying parameters. Try another date or switch to Live for upcoming games.'
                    : 'No upcoming fixture currently produces one of the qualifying parameters. Try another date or switch back to Archive.'
                }
                action={
                  <button
                    type="button"
                    onClick={() => setLive(!live)}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {live ? 'View archive' : 'View live slate'}
                  </button>
                }
              />
            ) : (
              <EmptyState
                title="No fixtures match these filters"
                description="Those parameters exist in the study, but no fixture on this matchday matches the current drill-down or search. Reset the filters or change the matchday."
                action={
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Reset filters
                  </button>
                }
              />
            )
          ) : (
            <div className="space-y-2">
              {(filtered?.matches ?? []).map((match) => {
                const picksByCombo = new Map(match.picks.map((pick) => [pick.comboKey, pick]));
                return (
                  <div
                    key={match.fixtureId}
                    id={`positive-read-match-${match.fixtureId}`}
                    className={`scroll-mt-20 rounded-xl ${
                      focusedFixtureId === match.fixtureId
                        ? 'ring-2 ring-emerald-400 ring-offset-2'
                        : ''
                    }`}
                  >
                    <DataCard
                      className="[&>div:first-child]:border-b-0"
                      bodyClassName="hidden"
                      title={
                        <span className="text-sm font-semibold normal-case tracking-normal text-slate-900">
                          {match.homeTeam} <span className="text-slate-400">vs</span> {match.awayTeam}
                        </span>
                      }
                      subtitle={
                        <span className="text-[11px] font-normal text-slate-500">
                          {match.competition} · {match.country} · {match.kickoffTime}
                          {match.score ? ` · ${match.score}` : ` · ${match.status}`}
                        </span>
                      }
                      actions={
                        <div className="flex flex-wrap items-center gap-2">
                          {match.combos.map((combo) => (
                            <ComboChip
                              key={combo.key}
                              combo={combo}
                              pick={picksByCombo.get(combo.key)}
                              onAdd={isBuild ? (pick) => addPicks([pick]) : undefined}
                            />
                          ))}
                        </div>
                      }
                    >
                      {null}
                    </DataCard>
                  </div>
                );
              })}
            </div>
          )}

          <ul className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[11px] leading-relaxed text-slate-600">
            {data.caveats.map((caveat) => (
              <li key={caveat}>· {caveat}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
