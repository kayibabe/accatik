import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
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
}: {
  combo: PositiveReadCombo;
  pick?: PositiveReadPick;
  onAdd?: (pick: PositiveReadPick) => number;
}) {
  const addable = Boolean(pick && pick?.status === 'Pending' && onAdd);
  const tier = TIER_STYLES[positiveReadTier(combo)];
  const title = [
    combo.label,
    `Inception ROI ${fmtSignedPercent(combo.roi)} from ${fmtCount(combo.staked)} staked picks`,
    `95% interval ${fmtSignedPercent(combo.roiCiLow)} to ${fmtSignedPercent(combo.roiCiHigh)}`,
    `${combo.positiveDates} of ${combo.totalDates} matchdays positive`,
    tier.label,
    combo.stable ? 'Stable' : null,
    pick?.bandDrift ? `Live band ${pick.band} drifted from study band ${combo.band}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900"
      title={title}
    >
      <Target className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
      <span className="min-w-0 truncate font-semibold">{combo.label}</span>
      <span className="shrink-0 font-mono tabular-nums text-emerald-700">
        {fmtSignedPercent(combo.roi)}
      </span>
      {pick && (
        <span className="shrink-0 rounded bg-white/80 px-1 py-0.5 font-mono tabular-nums text-emerald-800">
          {fmtOdds(pick.odds)}
        </span>
      )}
      <span
        className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase ${tier.className}`}
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
    </span>
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
        if (!isBuild && !dateIso) setDateIso(result.dateIso);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load positive-read matches.');
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

  const eligiblePicks = filtered?.eligiblePicks ?? [];
  const universe = data?.universe;
  const universeLabel = universe
    ? `${universe.sections.length} sections × ${universe.bands.length} bands × ${universe.markets.length} markets`
    : '3 sections × 4 bands × 18 markets';

  return (
    <section aria-label="Daily positive-read matches" className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Daily feed · {strategy} strategy · {data?.source === 'live' ? 'live prices' : 'archived matchday'}
            {isBuild ? ' · all eligible picks are kept' : ''}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <CalendarDays className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Positive-read matches
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            {isBuild ? (
              <>
                Fixtures whose cards hit a <strong>section × band × market</strong> combination with a
                positive inception-to-date ROI. Add a labelled card to your slip; the market and price
                are copied from the same frozen pick the study measured.
              </>
            ) : (
              <>
                Fixtures whose cards hit a <strong>section × band × market</strong> combination with a
                positive inception-to-date ROI in the study below. Each match is labelled with the
                exact parameter that fired. Archive is the default; switch to Live for upcoming games.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isBuild && (
            <DateNavigator
              selectedDate={dateIso || todayDate}
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
          ticket to check the final shape — Positive Reads keeps every eligible pick, one per match.
          Wide slips are research only and are not marked as recommended.
        </p>
      )}

      {isBuild && !live && filtered && filtered.matches.length > 0 && eligiblePicks.length === 0 && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          These archived picks are already settled, so they cannot join a live slip.{' '}
          <button
            type="button"
            onClick={() => setLive(true)}
            className="font-semibold underline cursor-pointer"
          >
            Switch to Live prices
          </button>{' '}
          to add upcoming picks.
        </p>
      )}

      {loading && !data ? (
        <LoadingState label="Loading positive-read matches…" count={3} />
      ) : error ? (
        <ErrorState title="Could not load matches" description={error} onRetry={reload} />
      ) : !data || data.combos.length === 0 ? (
        <EmptyState
          title="No positive reads yet"
          description={
            isBuild
              ? 'The section × band × market study has no row with a positive inception-to-date ROI, so there is no parameter to pick from yet.'
              : 'The section × band × market study has no row with a positive inception-to-date ROI, so there is no parameter to match yet. Check the study below.'
          }
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
              <strong className="font-semibold">{fmtCount(data.qualifiedCount)}</strong> qualified
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold">{fmtCount(data.confirmedCount)}</strong> confirmed
            </span>
            <span aria-hidden="true">·</span>
            <span>min sample {fmtCount(data.minSample)}</span>
            <span aria-hidden="true">·</span>
            {data.studyExcludedDateIso ? (
              <span className="font-medium text-emerald-700">
                {fmtShortDate(data.studyExcludedDateIso)} excluded (out-of-sample)
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
            title="Active parameters"
            subtitle={`${fmtCount(filtered?.combos.length ?? 0)} of ${fmtCount(data.combos.length)} positive ${data.combos.length === 1 ? 'combination' : 'combinations'} from the study`}
            actions={
              <div className="flex items-center gap-2">
                {isBuild && eligiblePicks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => addPicks(eligiblePicks)}
                    title="Add every currently filtered, pending pick without the five-leg cut"
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                  >
                    Add all eligible
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
              <div className="space-y-3 p-4">
                {groups.map((group) => (
                  <div key={group.sectionLabel}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {group.sectionLabel} · {fmtCount(group.combos.length)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.combos.map((combo) => (
                        <ComboChip key={combo.key} combo={combo} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DataCard>

          {filtered && filtered.combos.length > 0 && filtered.matches.length === 0 ? (
            data.matches.length === 0 ? (
              <EmptyState
                title={`No matches on ${data.dateIso}`}
                description={
                  data.source === 'archive'
                    ? 'No fixture on this matchday produced one of the positive parameters. Try another date or switch to Live for upcoming games.'
                    : 'No upcoming fixture currently produces one of the positive parameters. Try another date or switch back to Archive.'
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
                title="No matches match these filters"
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
                  <DataCard
                    key={match.fixtureId}
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
                  >
                    <div className="flex flex-wrap gap-2 p-4">
                      {match.combos.map((combo) => (
                        <ComboChip
                          key={combo.key}
                          combo={combo}
                          pick={picksByCombo.get(combo.key)}
                          onAdd={isBuild ? (pick) => addPicks([pick]) : undefined}
                        />
                      ))}
                    </div>
                  </DataCard>
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
