import { RefreshCw, UserRound } from 'lucide-react';
import { LOCAL_PROFILE, LOCAL_USER } from '../lib/localIdentity.ts';
import type { ActiveTab } from '../types/navigation.ts';

/** Kept as a re-export so existing imports keep working. */
export type { ActiveTab } from '../types/navigation.ts';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onRefresh: () => void;
  isLoading: boolean;
  onToggleMenu?: () => void;
  isMenuOpen?: boolean;
}

export function TopBar({
  onSelectTab,
  onRefresh,
  isLoading,
  onToggleMenu,
  isMenuOpen = false,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
      <div className="h-16 flex items-center gap-3 page-inset-app">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-label="Open navigation menu"
          aria-expanded={isMenuOpen}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:hidden"
        >
          <span className="flex flex-col gap-1" aria-hidden="true">
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('slate')}
          title="Go to Matchday Slate"
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          MatchSlip
        </button>

        <div className="hidden flex-1 sm:block" />

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm">
            <UserRound className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span className="max-w-[140px] truncate text-slate-700" title={LOCAL_USER.name}>
              {LOCAL_USER.name}
            </span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold uppercase text-emerald-800">
              {LOCAL_PROFILE.role}
            </span>
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label={
              isLoading ? 'Loading Matchday Slate' : 'Refresh Matchday Slate'
            }
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:px-4"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              {isLoading ? 'Loading Matchday Slate' : 'Refresh Matchday Slate'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
