import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { Calendar } from 'lucide-react';

interface DatePickerControlProps {
  value: string;
  onChange: (dateIso: string) => void;
  /** Accessible name and hover text for the native date input. */
  label: string;
  /** `icon` overlays the native input on a calendar button; `field` shows the ISO date. */
  variant?: 'icon' | 'field';
  size?: 'sm' | 'md';
  /** The ledger filter uses an empty value to mean "all days". */
  allowEmpty?: boolean;
  className?: string;
}

/**
 * One native date input, two presentations. Keeping the input itself native
 * means there is no extra date library and the browser supplies the calendar,
 * keyboard editing and locale formatting; the wrapper only decides whether
 * the field is visible or hidden behind a compact calendar icon.
 */
export function DatePickerControl({
  value,
  onChange,
  label,
  variant = 'icon',
  size = 'md',
  allowEmpty = false,
  className = '',
}: DatePickerControlProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    if (next || allowEmpty) onChange(next);
  };

  const inputProps: InputHTMLAttributes<HTMLInputElement> = {
    type: 'date',
    value,
    onChange: handleChange,
    'aria-label': label,
  };

  if (variant === 'icon') {
    return (
      <label
        title={label}
        className={`relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:border-emerald-700 hover:text-emerald-700 focus-within:border-emerald-700 focus-within:ring-2 focus-within:ring-emerald-700/20 ${
          size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'
        } ${className}`}
      >
        <Calendar className="pointer-events-none h-4 w-4" aria-hidden="true" />
        <input {...inputProps} className="date-input-overlay" />
      </label>
    );
  }

  return (
    <label className={`relative inline-flex items-center ${className}`}>
      <Calendar
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-500"
        aria-hidden="true"
      />
      <input
        {...inputProps}
        title={label}
        className={`${
          size === 'sm' ? 'h-8' : 'h-9'
        } pl-8 pr-2.5 text-sm font-mono font-medium tabular-nums text-slate-800 bg-white border border-slate-200 rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700`}
      />
    </label>
  );
}
