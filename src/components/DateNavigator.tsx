import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePickerControl } from './DatePickerControl.tsx';
import { formatDateStripTile, shiftIsoDate } from '../utils/dateGroups.ts';

// Re-exported for existing callers that import the helper from here.
export { shiftIsoDate };

interface DateNavigatorProps {
  selectedDate: string;
  todayDate: string;
  onChangeDate: (date: string) => void;
}

const STRIP_OFFSETS = [-2, -1, 0, 1, 2] as const;

/**
 * Qwantej-style matchday strip: a five-day window centred on the selection,
 * step arrows, a Today reset that appears only when needed, and a compact
 * native calendar for any other date.
 *
 * Date controls stay enabled while a slate loads. fetchSlateForDate aborts
 * the previous request and ignores stale responses, so rapid clicks are safe
 * and feel immediate instead of being swallowed by a disabled state.
 */
export function DateNavigator({
  selectedDate,
  todayDate,
  onChangeDate,
}: DateNavigatorProps) {
  const isToday = selectedDate === todayDate;
  const stripDates = STRIP_OFFSETS.map((offset) =>
    shiftIsoDate(selectedDate, offset)
  );

  const arrowClass =
    'grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer';

  return (
    <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
      <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1">
        <button
          type="button"
          onClick={() => onChangeDate(shiftIsoDate(selectedDate, -1))}
          aria-label="Previous day"
          className={arrowClass}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <div
          role="group"
          aria-label="Choose match date"
          className="inline-flex shrink-0 items-center gap-0.5"
        >
          {stripDates.map((dateIso, index) => {
            const tile = formatDateStripTile(dateIso, todayDate);
            const isSelected = dateIso === selectedDate;
            const isTodayTile = dateIso === todayDate;
            // Weekday labels stay a step below page copy at 13px and may read
            // "Today", so each tile needs room to wrap without clipping. An
            // inset ring keeps the selection edge off the text, and the accessible name repeats the
            // visible label in the same upper case and line break so
            // voice-control users can say what they see and WCAG 2.5.3 is met.
            const accessibleLabel = `${tile.weekday.toUpperCase()}\n${tile.day} · ${tile.ariaLabel}`;
            return (
              <button
                key={`${dateIso}-${STRIP_OFFSETS[index]}`}
                type="button"
                onClick={() => onChangeDate(dateIso)}
                aria-label={accessibleLabel}
                aria-pressed={isSelected}
                aria-current={isTodayTile ? 'date' : undefined}
                title={tile.ariaLabel}
                className={`grid h-12 min-w-14 shrink-0 place-items-center gap-0.5 rounded-lg border border-transparent px-1 py-1.5 text-center leading-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer ${
                  isSelected
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-700'
                    : 'text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span
                  className={`whitespace-pre-line text-center text-xs font-semibold tabular-nums leading-tight tracking-wide ${
                    isSelected
                      ? 'text-emerald-700'
                      : isTodayTile
                        ? 'text-emerald-700'
                        : 'text-slate-800'
                  }`}
                >
                  {`${tile.weekday.toUpperCase()}\n${tile.day}`}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => onChangeDate(shiftIsoDate(selectedDate, 1))}
          aria-label="Next day"
          className={arrowClass}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="inline-flex items-center gap-1.5">
        {!isToday && (
          <button
            type="button"
            onClick={() => onChangeDate(todayDate)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold uppercase tracking-wide text-emerald-700 transition-colors hover:border-emerald-700 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer"
          >
            Today
          </button>
        )}
        <DatePickerControl
          value={selectedDate}
          onChange={onChangeDate}
          label="Select any match date"
        />
      </div>
    </div>
  );
}
