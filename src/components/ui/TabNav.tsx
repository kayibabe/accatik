interface TabNavItem<T extends string> {
  id: T;
  label: string;
}

interface TabNavProps<T extends string> {
  items: ReadonlyArray<TabNavItem<T>>;
  activeId: T;
  onSelect: (id: T) => void;
  /** Accessible name and optional visible caption for the tab strip. */
  label?: string;
}

/**
 * Page-level tab strip. Selecting a tab replaces the visible page and records
 * the choice in the URL, instead of scrolling to an anchor on one long view.
 */
export function TabNav<T extends string>({
  items,
  activeId,
  onSelect,
  label = 'Pages',
}: TabNavProps<T>) {
  return (
    <nav aria-label={label} className="border-b border-slate-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="px-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {label}
        </span>
        <div role="tablist" className="-mb-px flex flex-wrap gap-1">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(item.id)}
                className={`rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer ${
                  active
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-800'
                    : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
