import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';

export interface NoticeItem {
  id: string;
  tone: 'error' | 'warning' | 'info' | 'success';
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
}

const TONE: Record<
  NoticeItem['tone'],
  { shell: string; text: string; Icon: typeof Info }
> = {
  error: {
    shell: 'bg-amber-50 border-b border-amber-200',
    text: 'text-amber-900',
    Icon: AlertCircle,
  },
  warning: {
    shell: 'bg-amber-50 border-b border-amber-200',
    text: 'text-amber-900',
    Icon: TriangleAlert,
  },
  info: {
    shell: 'bg-indigo-50 border-b border-indigo-200',
    text: 'text-indigo-900',
    Icon: Info,
  },
  success: {
    shell: 'bg-emerald-50 border-b border-emerald-200',
    text: 'text-emerald-900',
    Icon: CheckCircle2,
  },
};

function NoticeRow({ item, inset }: { item: NoticeItem; inset: string }) {
  const tone = TONE[item.tone];
  const Icon = tone.Icon;
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={tone.shell}
    >
      <div
        className={`${inset} py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${tone.text}`}
      >
        <div className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <span className="font-semibold">{item.title}</span>
            {item.body && <div className="mt-0.5 leading-relaxed">{item.body}</div>}
          </div>
        </div>
        {item.actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {item.actions}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One prioritised notification region instead of several banners stacked above
 * the content. Only the highest-priority notice is expanded by default.
 */
export function NotificationRegion({
  items,
  inset,
}: {
  items: NoticeItem[];
  inset: string;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const [primary, ...rest] = items;

  return (
    <div aria-label="Notifications" className="space-y-0">
      <NoticeRow item={primary} inset={inset} />
      {rest.length > 0 && (
        <>
          <div className={`${inset} bg-slate-50 border-b border-slate-200 py-1.5`}>
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              className="rounded px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              {expanded ? 'Hide other notices' : `${rest.length} other notice${rest.length === 1 ? '' : 's'}`}
            </button>
          </div>
          {expanded && rest.map((item) => <NoticeRow key={item.id} item={item} inset={inset} />)}
        </>
      )}
    </div>
  );
}
