import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { METRIC_INFO } from '../../utils/uiTone.ts';

interface DataCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
}

/** The standard white bordered surface used by every data view. */
export function DataCard({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
  labelledBy,
}: DataCardProps) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`rounded-xl border border-slate-200 bg-white overflow-hidden ${className}`}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2
                id={labelledBy}
                className="text-sm font-bold uppercase tracking-wide text-slate-500"
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-slate-400">{subtitle}</p>
            )}
          </div>
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName || 'px-4 py-4'}>{children}</div>
    </section>
  );
}

interface InfoHintProps {
  /** Key into the shared METRIC_INFO catalogue. */
  infoKey?: string;
  label?: string;
  definition?: string;
  source?: string;
}

/** Accessible definition affordance: title for quick use, tooltip for detail. */
export function InfoHint({ infoKey, label, definition, source }: InfoHintProps) {
  const metric = infoKey ? METRIC_INFO[infoKey] : undefined;
  const resolvedLabel = label ?? metric?.label ?? 'Metric';
  const resolvedDefinition =
    definition ?? metric?.definition ?? 'No definition available.';
  const resolvedSource = source ?? metric?.source;

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${resolvedLabel}`}
        title={`${resolvedLabel}: ${resolvedDefinition}${
          resolvedSource ? ` Source: ${resolvedSource}` : ''
        }`}
        className="ml-1 inline-flex rounded-full text-slate-300 transition-colors hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-help"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 hidden w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-normal normal-case leading-relaxed text-slate-600 shadow-lg group-hover:block group-focus-within:block"
      >
        <strong className="block text-slate-800">{resolvedLabel}</strong>
        {resolvedDefinition}
        {resolvedSource && (
          <span className="mt-1 block text-[10px] text-slate-400">
            {resolvedSource}
          </span>
        )}
      </span>
    </span>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  detail?: ReactNode;
  tone?: string;
  infoKey?: string;
  className?: string;
}

/** Top-level KPI. Info hints make provenance discoverable without clutter. */
export function MetricCard({
  label,
  value,
  detail,
  tone = 'text-slate-900',
  infoKey,
  className = '',
}: MetricCardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white px-4 py-3 ${className}`}
    >
      <p className="flex items-center text-[11px] font-medium text-slate-500">
        {label}
        {infoKey && <InfoHint infoKey={infoKey} />}
      </p>
      <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${tone}`}>
        {value}
      </p>
      {detail && <p className="mt-1 text-[11px] text-slate-400">{detail}</p>}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {children}
    </div>
  );
}
