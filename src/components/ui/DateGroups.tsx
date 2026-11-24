import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  formatDateDayLabel,
  formatDateMonthLabel,
  formatDateYearLabel,
  type DateDayGroup,
  type DateYearGroup,
} from '../../utils/dateGroups.ts';
import { fmtCount } from '../../utils/format.ts';

interface ExpansionOverrides {
  years: Record<string, boolean>;
  months: Record<string, boolean>;
  days: Record<string, boolean>;
}

const EMPTY_OVERRIDES: ExpansionOverrides = {
  years: {},
  months: {},
  days: {},
};

const yearKey = (year: number): string => String(year);
const monthKey = (year: number, month: number): string => `${year}-${month}`;
const dayKey = (dateIso: string): string => dateIso;

interface GroupKeys {
  years: string[];
  months: string[];
  days: string[];
}

function collectKeys<T>(groups: ReadonlyArray<DateYearGroup<T>>): GroupKeys {
  const years = new Set<string>();
  const months = new Set<string>();
  const days = new Set<string>();

  for (const year of groups) {
    years.add(yearKey(year.year));
    for (const month of year.months) {
      months.add(monthKey(year.year, month.month));
      for (const day of month.days) days.add(dayKey(day.dateIso));
    }
  }

  return {
    years: [...years],
    months: [...months],
    days: [...days],
  };
}

/** The only path open before the user touches an accordion: today, if present. */
function defaultKeys<T>(
  groups: ReadonlyArray<DateYearGroup<T>>,
  todayDate: string
): GroupKeys {
  for (const year of groups) {
    for (const month of year.months) {
      for (const day of month.days) {
        if (day.dateIso === todayDate) {
          return {
            years: [yearKey(year.year)],
            months: [monthKey(year.year, month.month)],
            days: [dayKey(day.dateIso)],
          };
        }
      }
    }
  }
  return { years: [], months: [], days: [] };
}

function countRows<T>(group: DateYearGroup<T>): number {
  return group.months.reduce(
    (total, month) =>
      total + month.days.reduce((sum, day) => sum + day.rows.length, 0),
    0
  );
}

export interface DateGroupExpansion {
  isYearExpanded: (year: number) => boolean;
  isMonthExpanded: (year: number, month: number) => boolean;
  isDayExpanded: (dateIso: string) => boolean;
  toggleYear: (year: number) => void;
  toggleMonth: (year: number, month: number) => void;
  toggleDay: (dateIso: string) => void;
  setAll: (expanded: boolean) => void;
  allExpanded: boolean;
}

/**
 * Expansion state for a date accordion. Explicit toggles win over the default
 * "only today" path, so a user can collapse today or open older dates without
 * the component fighting them on the next render.
 */
export function useDateGroupExpansion<T>(
  groups: ReadonlyArray<DateYearGroup<T>>,
  todayDate: string
): DateGroupExpansion {
  const [overrides, setOverrides] = useState<ExpansionOverrides>(EMPTY_OVERRIDES);
  const keys = useMemo(() => collectKeys(groups), [groups]);
  const defaults = useMemo(
    () => defaultKeys(groups, todayDate),
    [groups, todayDate]
  );

  useEffect(() => {
    setOverrides(EMPTY_OVERRIDES);
  }, [todayDate]);

  const defaultYears = useMemo(() => new Set(defaults.years), [defaults]);
  const defaultMonths = useMemo(() => new Set(defaults.months), [defaults]);
  const defaultDays = useMemo(() => new Set(defaults.days), [defaults]);

  const isYearExpanded = (year: number): boolean =>
    overrides.years[yearKey(year)] ?? defaultYears.has(yearKey(year));
  const isMonthExpanded = (year: number, month: number): boolean =>
    overrides.months[monthKey(year, month)] ??
    defaultMonths.has(monthKey(year, month));
  const isDayExpanded = (dateIso: string): boolean =>
    overrides.days[dayKey(dateIso)] ?? defaultDays.has(dayKey(dateIso));

  const toggleYear = (year: number): void => {
    const key = yearKey(year);
    setOverrides((current) => ({
      ...current,
      years: { ...current.years, [key]: !isYearExpanded(year) },
    }));
  };

  const toggleMonth = (year: number, month: number): void => {
    const key = monthKey(year, month);
    setOverrides((current) => ({
      ...current,
      months: {
        ...current.months,
        [key]: !isMonthExpanded(year, month),
      },
    }));
  };

  const toggleDay = (dateIso: string): void => {
    const key = dayKey(dateIso);
    setOverrides((current) => ({
      ...current,
      days: { ...current.days, [key]: !isDayExpanded(dateIso) },
    }));
  };

  const setAll = (expanded: boolean): void => {
    setOverrides({
      years: Object.fromEntries(keys.years.map((key) => [key, expanded])),
      months: Object.fromEntries(keys.months.map((key) => [key, expanded])),
      days: Object.fromEntries(keys.days.map((key) => [key, expanded])),
    });
  };

  const allExpanded =
    keys.years.length > 0 &&
    keys.years.every((key) => overrides.years[key] ?? defaultYears.has(key)) &&
    keys.months.every(
      (key) => overrides.months[key] ?? defaultMonths.has(key)
    ) &&
    keys.days.every((key) => overrides.days[key] ?? defaultDays.has(key));

  return {
    isYearExpanded,
    isMonthExpanded,
    isDayExpanded,
    toggleYear,
    toggleMonth,
    toggleDay,
    setAll,
    allExpanded,
  };
}

export interface DateGroupsProps<T> {
  groups: ReadonlyArray<DateYearGroup<T>>;
  todayDate: string;
  /** Unique across the page so every aria-controls points at one panel. */
  idPrefix: string;
  /** Content for one open date. Table headers inside stay independently sortable. */
  renderDay: (rows: T[], day: DateDayGroup<T>) => ReactNode;
  /** Optional count/status summary shown beside the date label. */
  daySummary?: (rows: T[], day: DateDayGroup<T>) => ReactNode;
  empty?: ReactNode;
  className?: string;
  /** Supply the hook's value to share expansion state with page-level controls. */
  expansion?: DateGroupExpansion;
}

/** Shared Year → Month → Date accordion with today open by default. */
export function DateGroups<T,>({
  groups,
  todayDate,
  idPrefix,
  renderDay,
  daySummary,
  empty,
  className = '',
  expansion,
}: DateGroupsProps<T>) {
  const internalExpansion = useDateGroupExpansion(groups, todayDate);
  const expansionState = expansion ?? internalExpansion;

  if (groups.length === 0) return <>{empty ?? null}</>;

  return (
    <div className={`space-y-8 ${className}`}>
      {groups.map((yearGroup) => {
        const yearOpen = expansionState.isYearExpanded(yearGroup.year);
        const yearPanelId = `${idPrefix}-year-${yearGroup.year}`;

        return (
          <section
            key={yearGroup.year}
            aria-label={`${formatDateYearLabel(yearGroup.year)} groups`}
            className="space-y-3"
          >
            <button
              type="button"
              onClick={() => expansionState.toggleYear(yearGroup.year)}
              aria-expanded={yearOpen}
              aria-controls={yearPanelId}
              className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                  yearOpen ? 'rotate-90' : ''
                }`}
                aria-hidden="true"
              />
              <span className="text-sm font-bold uppercase tracking-wide text-slate-500">
                {formatDateYearLabel(yearGroup.year)}
              </span>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {fmtCount(countRows(yearGroup))} rows
              </span>
            </button>

            {yearOpen && (
              <div id={yearPanelId} className="space-y-4">
                {yearGroup.months.map((monthGroup) => {
                  const monthOpen = expansionState.isMonthExpanded(
                    yearGroup.year,
                    monthGroup.month
                  );
                  const monthPanelId = `${idPrefix}-month-${yearGroup.year}-${monthGroup.month}`;
                  const monthRows = monthGroup.days.reduce(
                    (total, day) => total + day.rows.length,
                    0
                  );

                  return (
                    <div key={monthGroup.month} className="space-y-2">
                      <button
                        type="button"
                        onClick={() =>
                          expansionState.toggleMonth(
                            yearGroup.year,
                            monthGroup.month
                          )
                        }
                        aria-expanded={monthOpen}
                        aria-controls={monthPanelId}
                        className="flex w-full items-center gap-2 rounded-lg pl-1 pr-2 py-1.5 text-left hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                            monthOpen ? 'rotate-90' : ''
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-semibold text-slate-500">
                          {formatDateMonthLabel(monthGroup.month)}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                          {fmtCount(monthRows)} rows
                        </span>
                      </button>

                      {monthOpen && (
                        <div
                          id={monthPanelId}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-200"
                        >
                          {monthGroup.days.map((day) => {
                            const dayOpen = expansionState.isDayExpanded(
                              day.dateIso
                            );
                            const dayPanelId = `${idPrefix}-day-${day.dateIso || 'unknown'}`;
                            const rows = day.rows;

                            return (
                              <div key={day.dateIso || 'unknown'}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    expansionState.toggleDay(day.dateIso)
                                  }
                                  aria-expanded={dayOpen}
                                  aria-controls={dayPanelId}
                                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:px-5"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <ChevronRight
                                      className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                                        dayOpen ? 'rotate-90' : ''
                                      }`}
                                      aria-hidden="true"
                                    />
                                    <span
                                      className={`truncate text-sm font-semibold ${
                                        day.dateIso === todayDate
                                          ? 'text-emerald-800'
                                          : 'text-slate-800'
                                      }`}
                                    >
                                      {formatDateDayLabel(day.dateIso, todayDate)}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-[11px] text-slate-500">
                                    {daySummary ? (
                                      daySummary(rows, day)
                                    ) : (
                                      <span className="font-mono tabular-nums">
                                        {fmtCount(rows.length)}{' '}
                                        {rows.length === 1 ? 'item' : 'items'}
                                      </span>
                                    )}
                                  </span>
                                </button>

                                {dayOpen && (
                                  <div
                                    id={dayPanelId}
                                    className="border-t border-slate-200 bg-slate-50/50"
                                  >
                                    {renderDay(rows, day)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
