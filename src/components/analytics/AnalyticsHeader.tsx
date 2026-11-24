import { RefreshCw, ShieldAlert } from 'lucide-react';
import { fmtCount, fmtShortDate } from '../../utils/format.ts';
import type { PickAnalyticsResponse } from '../../types/analytics.ts';
import { DataStatus } from '../ui/DataStatus.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { ErrorState, InlineLoading } from '../ui/States.tsx';

interface AnalyticsHeaderProps {
  strategyName: string;
  data: PickAnalyticsResponse | null;
  error: string | null;
  refreshError: string | null;
  staleResponse: boolean;
  loading: boolean;
  refreshingTables: boolean;
  lastChecked: string | null;
  onRefresh: () => void;
  onGoToSlate: () => void;
}

/**
 * Global-scope page shell, provenance strip and the three advisory banners.
 * The archive has no single capture timestamp, so DataStatus is used without
 * one — freshness is described by the local refresh check only.
 */
export function AnalyticsHeader({
  strategyName,
  data,
  error,
  refreshError,
  staleResponse,
  loading,
  refreshingTables,
  lastChecked,
  onRefresh,
  onGoToSlate,
}: AnalyticsHeaderProps) {
  const dateRange =
    data?.firstDateIso && data.lastDateIso
      ? `${fmtShortDate(data.firstDateIso)} – ${fmtShortDate(data.lastDateIso)}`
      : '—';

  return (
    <>
      <PageHeader
        eyebrow="Global record · since data collection began"
        title="Analytics"
        scope="global"
        meta={`Featured picks: ${strategyName} strategy · ${dateRange}`}
        onBack={onGoToSlate}
        backLabel="Back to Today's Slate"
        actions={
          <>
            <span
              className="text-[11px] text-slate-400"
              title="Archived results are checked on load, every 5 minutes, and when this tab becomes visible again."
            >
              {refreshingTables ? (
                <InlineLoading label="Checking for new results…" />
              ) : lastChecked ? (
                `Checked ${new Date(lastChecked).toLocaleTimeString()}`
              ) : (
                'Checking for new results…'
              )}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading || refreshingTables}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshingTables ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </>
        }
      />

      <DataStatus
        source="Global settled archive"
        mode="Archive · flat unit stake"
        note={
          <span>
            {fmtCount(data?.sampleDates ?? 0)} matchdays ·{' '}
            {fmtCount(data?.sampleFixtures ?? 0)} priced fixtures · results appear
            after matchdays settle
          </span>
        }
      />

      {error && (
        <ErrorState
          title="Analytics could not be loaded"
          description={error}
          onRetry={onRefresh}
          retryLabel="Retry load"
        />
      )}

      {refreshError && (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800"
        >
          Result check: {refreshError}
        </div>
      )}

      {staleResponse && data && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            Selection drill-downs are unavailable for this archived snapshot.
            The headline totals above are still current.
          </p>
        </div>
      )}
    </>
  );
}
