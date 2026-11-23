import { X } from 'lucide-react';
import type { ActiveFilterChip } from './fixtureShared.ts';

interface ActiveFilterBarProps {
  chips: ReadonlyArray<ActiveFilterChip>;
  onReset: () => void;
  /** Screen-reader label; defaults to the slate so existing callers need no change. */
  label?: string;
}

/** One-click undo for every narrowed dimension, kept visible while scrolling. */
export function ActiveFilterBar({
  chips,
  onReset,
  label = 'Active slate filters',
}: ActiveFilterBarProps) {
  if (chips.length === 0) return null;

  return (
    <div
      aria-label={label}
      className="sticky top-16 z-20 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-2 shadow-sm backdrop-blur"
    >
      <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Filters
      </span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.clear}
          title={`Remove ${chip.label} filter`}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900 cursor-pointer"
        >
          <span>{chip.label}</span>
          <X className="h-3 w-3 text-slate-400" aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="ml-auto px-2 py-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-900 underline underline-offset-2 cursor-pointer"
      >
        Clear all
      </button>
    </div>
  );
}
