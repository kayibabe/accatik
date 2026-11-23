import { useEffect, useState } from 'react';
import { CalendarDays, Radio, RefreshCw, Target } from 'lucide-react';
import type { AccaStrategy } from '../../types/fixtures.ts';
import type {
  PositiveReadCombo,
  PositiveReadMatchesResponse,
} from '../../types/analytics.ts';
import { apiFetch } from '../../utils/api.ts';
import { fmtCount, fmtSignedPercent } from '../../utils/format.ts';
import { DateNavigator } from '../DateNavigator.tsx';
import { DataCard } from '../ui/DataCard.tsx';
import { EmptyState, ErrorState, InlineLoading, LoadingState } from '../ui/States.tsx';

interface PositiveReadMatchesProps {
  strategy: AccaStrategy;
  todayDate: string;
  /** Bumped by the parent when settled results change. */
  refreshKey: number;
}

function ComboChip({ combo }: { combo: PositiveReadCombo }) {
  return (
    <span
      className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900"
      title={`Inception ROI ${fmtSignedPercent(combo.roi)} from ${fmtCount(combo.staked)} staked picks`}
    >
      <Target className="h-3 w-3 shrink-0 text-emerald-700" aria-hidden="true" />
      <span className="font-semibold">{combo.label}</span>
      <span className="font-mono tabular-nums text-emerald-700">
        {fmtSignedPercent(combo.roi)}
      </span>
      {combo.smallSample && (
        <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-amber-800">
          Small sample
        </span>
      )}
    </span>
  );
}

/**
 * Daily match feed for the positive cells of the section x band x market study.
 *
 * Archive is the default so a settled matchday and the ROI study read the same
 * frozen prices. `Live` is an explicit opt-in for upcoming fixtures and may
 * trigger an upstream slate fetch.
 */
export function PositiveReadMatches({
  strategy,
  todayDate,
  refreshKey,
}: PositiveReadMatchesProps) {
  const [data, setData] = useState<PositiveReadMatchesResponse | null>(null);
  const [dateIso, setDateIso] = useState('');
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);

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
              dateIso: dateIso || undefined,
              live,
              force: localReload > 0,
            }),
          }
        );
        if (cancelled) return;
        setData(result);
        if (!dateIso) setDateIso(result.dateIso);
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
  }, [strategy, dateIso, live, refreshKey, localReload]);

  const reload = () => setLocalReload((value) => value + 1);

  return (
    <section aria-label="Daily positive-read matches" className="space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Daily feed · {strategy} strategy · {data?.source === 'live' ? 'live prices' : 'archived matchday'}
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <CalendarDays className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Positive-read matches
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
            Fixtures whose cards hit a <strong>section × band × market</strong> combination with a
            positive inception-to-date ROI in the study below. Each match is labelled with the
            exact parameter that fired. Archive is the default; switch to Live for upcoming games.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DateNavigator
            selectedDate={dateIso || todayDate}
            todayDate={todayDate}
            onChangeDate={setDateIso}
          />
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
        </div>
      </div>

      {loading && !data ? (
        <LoadingState label="Loading positive-read matches…" count={3} />
      ) : error ? (
        <ErrorState title="Could not load matches" description={error} onRetry={reload} />
      ) : !data || data.combos.length === 0 ? (
        <EmptyState
          title="No positive reads yet"
          description="The section × band × market study has no row with a positive inception-to-date ROI, so there is no parameter to match yet. Check the study below."
        />
      ) : (
        <>
          <DataCard
            title="Active parameters"
            subtitle={`${fmtCount(data.combos.length)} positive ${data.combos.length === 1 ? 'combination' : 'combinations'} from the study`}
            actions={loading ? <InlineLoading label="Refreshing…" /> : undefined}
          >
            <div className="flex flex-wrap gap-2 p-4">
              {data.combos.map((combo) => (
                <ComboChip key={combo.key} combo={combo} />
              ))}
            </div>
          </DataCard>

          {data.matches.length === 0 ? (
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
            <div className="space-y-2">
              {data.matches.map((match) => (
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
                      <ComboChip key={combo.key} combo={combo} />
                    ))}
                  </div>
                </DataCard>
              ))}
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
