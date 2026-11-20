import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface DateNavigatorProps {
  selectedDate: string;
  todayDate: string;
  onChangeDate: (date: string) => void;
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function DateNavigator({
  selectedDate,
  todayDate,
  onChangeDate,
}: DateNavigatorProps) {
  const yesterdayDate = shiftIsoDate(todayDate, -1);
  const tomorrowDate = shiftIsoDate(todayDate, 1);
  const isToday = selectedDate === todayDate;

  // Date controls stay enabled while a slate loads. fetchSlateForDate aborts
  // the previous request and ignores stale responses, so rapid clicks are safe
  // and feel immediate instead of being swallowed by a disabled state.
  return (
    <div className="flex flex-wrap items-center gap-2 shrink-0">
      <div className="inline-flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
        <button
          type="button"
          onClick={() => onChangeDate(shiftIsoDate(selectedDate, -1))}
          aria-label="Previous day"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onChangeDate(yesterdayDate)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            selectedDate === yesterdayDate
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Yesterday
        </button>
        <button
          type="button"
          onClick={() => onChangeDate(todayDate)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            isToday
              ? 'bg-emerald-700 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onChangeDate(tomorrowDate)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
            selectedDate === tomorrowDate
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => onChangeDate(shiftIsoDate(selectedDate, 1))}
          aria-label="Next day"
          className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <label className="relative inline-flex items-center">
        <Calendar
          className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => {
            if (e.target.value) onChangeDate(e.target.value);
          }}
          aria-label="Select any match date"
          className="h-9 pl-8 pr-2.5 text-xs font-mono font-medium text-slate-800 bg-white border border-slate-200 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700 cursor-pointer"
        />
      </label>
    </div>
  );
}
