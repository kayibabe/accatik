import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';

interface StateProps {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** Consistent empty surface with an explicit next step. */
export function EmptyState({
  title,
  description,
  action,
  className = '',
}: StateProps) {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center space-y-3 ${className}`}
    >
      <Inbox className="mx-auto h-7 w-7 text-slate-300" aria-hidden="true" />
      <p className="text-base font-semibold text-slate-900">{title}</p>
      {description && (
        <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="flex justify-center pt-2">{action}</div>}
    </div>
  );
}

interface ErrorStateProps extends StateProps {
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({
  title,
  description,
  action,
  onRetry,
  retryLabel = 'Retry',
  className = '',
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`bg-red-50 border border-red-200 rounded-xl p-6 sm:p-8 text-center space-y-3 ${className}`}
    >
      <AlertTriangle
        className="mx-auto h-7 w-7 text-red-400"
        aria-hidden="true"
      />
      <p className="text-base font-semibold text-red-800">{title}</p>
      {description && (
        <p className="text-xs text-red-700 max-w-xl mx-auto leading-relaxed">
          {description}
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {action}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/** Skeleton block for data-heavy views, with an announced loading label. */
export function LoadingState({
  label = 'Loading data…',
  count = 4,
  className = '',
}: {
  label?: string;
  count?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={`space-y-3 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

/** Inline compact spinner line used for in-view refreshes. */
export function InlineLoading({ label }: { label: string }) {
  return (
    <span
      role="status"
      className="inline-flex items-center gap-2 text-[11px] text-slate-500"
    >
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}
