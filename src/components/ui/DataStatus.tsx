import type { ReactNode } from 'react';
import { Clock3, Database, Radio, ShieldAlert } from 'lucide-react';

interface DataStatusProps {
  source?: string;
  capturedAt?: string | null;
  /** Archive or live snapshot label, e.g. "Archive" or "Live slate". */
  mode?: string;
  timezone?: string;
  /** Minutes after which a capture is flagged as stale. */
  staleAfterMinutes?: number;
  note?: ReactNode;
  className?: string;
}

function captureLabel(iso: string, timezone?: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const formatted = parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone || 'Africa/Blantyre',
    hour12: false,
  });
  return `${formatted}${timezone ? ` ${timezone.split('/').pop()?.replace('_', ' ')}` : ''}`;
}

/** Standard freshness/provenance cue for every data-heavy surface. */
export function DataStatus({
  source,
  capturedAt,
  mode,
  timezone,
  staleAfterMinutes = 180,
  note,
  className = '',
}: DataStatusProps) {
  const stale = (() => {
    if (!capturedAt) return false;
    const captured = new Date(capturedAt).getTime();
    if (!Number.isFinite(captured)) return false;
    return Date.now() - captured > staleAfterMinutes * 60_000;
  })();

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 ${className}`}
    >
      {source && (
        <span className="inline-flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
          <span className="font-semibold text-slate-700">{source}</span>
        </span>
      )}
      {mode && (
        <span className="inline-flex items-center gap-1.5">
          <Radio className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          {mode}
        </span>
      )}
      {capturedAt && (
        <span className="inline-flex items-center gap-1.5 font-mono tabular-nums">
          <Clock3 className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
          Captured {captureLabel(capturedAt, timezone)}
        </span>
      )}
      {stale && (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 font-semibold text-amber-700"
        >
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Older capture — refresh to verify
        </span>
      )}
      {note}
    </div>
  );
}

interface SectionNavProps {
  items: ReadonlyArray<{ id: string; label: string }>;
  label?: string;
}

/** Sticky in-page subnav for long scrolling views. */
export function SectionNav({
  items,
  label = 'On this page',
}: SectionNavProps) {
  return (
    <nav
      aria-label={label}
      className="sticky top-16 z-20 -mx-1 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur"
    >
      <span className="px-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
        {label}
      </span>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          data-section-link=""
          className="rounded-md px-2.5 py-1 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
