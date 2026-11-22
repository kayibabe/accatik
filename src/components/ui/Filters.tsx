import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

export type FilterChipTone = 'neutral' | 'angle' | 'cover' | 'note';

const FILTER_CHIP_ACTIVE_TONE: Record<FilterChipTone, string> = {
  neutral: 'bg-slate-900 border-slate-900 text-white',
  angle: 'bg-emerald-700 border-emerald-700 text-white',
  cover: 'bg-sky-700 border-sky-700 text-white',
  note: 'bg-violet-700 border-violet-700 text-white',
};

interface FilterChipProps {
  label: ReactNode;
  count?: number;
  active?: boolean;
  onClick: () => void;
  tone?: FilterChipTone;
  ariaLabel?: string;
}

export function FilterChip({
  label,
  count,
  active = false,
  onClick,
  tone = 'neutral',
  ariaLabel,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
        active
          ? FILTER_CHIP_ACTIVE_TONE[tone]
          : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`font-mono tabular-nums ${
            active ? 'text-white/70' : 'text-slate-400'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

interface FilterChipGroupProps<T extends string> {
  label: string;
  ariaLabel: string;
  options: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  tone?: FilterChipTone;
}

/** One labelled row of filter chips, shared by the slate and analytics views. */
export function FilterChipGroup<T extends string>({
  label,
  ariaLabel,
  options,
  value,
  onChange,
  tone = 'neutral',
}: FilterChipGroupProps<T>) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1">
        {options.map((option) => (
          <FilterChip
            key={option.id}
            label={option.label}
            count={option.count}
            active={option.id === value}
            onClick={() => onChange(option.id)}
            tone={tone}
          />
        ))}
      </div>
    </div>
  );
}

interface AdvancedFiltersProps {
  id: string;
  open: boolean;
  onToggle: () => void;
  /** Number of active controls hidden behind the disclosure. */
  activeCount: number;
  children: ReactNode;
}

/** Progressive disclosure for low-use filter dimensions. */
export function AdvancedFilters({
  id,
  open,
  onToggle,
  activeCount,
  children,
}: AdvancedFiltersProps) {
  return (
    <div className="border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        Advanced filters
        {activeCount > 0 && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] text-emerald-800">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div id={id} className="mt-3 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
