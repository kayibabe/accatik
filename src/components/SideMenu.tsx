import { useEffect } from 'react';
import {
  Activity,
  BookOpen,
  Bookmark,
  CalendarDays,
  ClipboardList,
  LogOut,
  ShieldCheck,
  TrendingUp,
  X,
  ChartColumn,
} from 'lucide-react';
import { NAV_GROUPS, type ActiveTab } from '../types/navigation.ts';
import type { AppUser, UserProfile } from '../types/user.ts';

interface SideMenuProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  savedCount: number;
  user?: AppUser | null;
  profile?: UserProfile | null;
  onSignOut?: () => void;
  onResendVerification?: () => void;
  isAdmin?: boolean;
  onAdmin?: () => void;
  open: boolean;
  onClose: () => void;
}

const TAB_ICONS: Record<ActiveTab, typeof CalendarDays> = {
  slate: CalendarDays,
  acca: ClipboardList,
  saved: Bookmark,
  activity: Activity,
  analytics: ChartColumn,
  roi: TrendingUp,
  sources: BookOpen,
};

export function SideMenu({
  activeTab,
  onSelectTab,
  savedCount,
  user,
  profile,
  onSignOut,
  onResendVerification,
  isAdmin,
  onAdmin,
  open,
  onClose,
}: SideMenuProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleSelect = (tab: ActiveTab) => {
    onSelectTab(tab);
    onClose();
  };

  const navContent = (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="pb-3">
          <p
            title={group.description}
            className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400"
          >
            {group.label}
          </p>
          <nav aria-label={`${group.label} navigation`} className="space-y-1">
            {group.items.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = TAB_ICONS[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                    isActive
                      ? 'bg-emerald-50 font-semibold text-emerald-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isActive ? 'text-emerald-700' : 'text-slate-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                  {item.research && (
                    <span
                      title="Read-only research — never a live betting recommendation"
                      className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-800"
                    >
                      Lab
                    </span>
                  )}
                  {item.id === 'saved' && savedCount > 0 && (
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                        isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {savedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      ))}

      <div className="mt-auto pt-3">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Account
        </p>
        <div className="space-y-1">
          {isAdmin && (
            <button
              type="button"
              onClick={onAdmin}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span>Admin · user roles</span>
            </button>
          )}
          {user && !user.emailVerified && onResendVerification && (
            <button
              type="button"
              onClick={onResendVerification}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-amber-800 hover:bg-amber-50 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
              <span>Resend verification</span>
            </button>
          )}
          {user && (
            <div className="px-3 py-2.5">
              <p className="truncate text-xs font-semibold text-slate-800">{user.name}</p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                {profile ? profile.role : 'role unavailable'}
              </p>
            </div>
          )}
          {user && (
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <LogOut className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed top-16 bottom-0 left-0 z-30 hidden page-menu flex-col border-r border-slate-200 bg-white sm:flex">
        {navContent}
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={onClose}
            className="absolute inset-0 bg-slate-900/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col border-r border-slate-200 bg-white shadow-2xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                MatchSlip
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation menu"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {navContent}
          </div>
        </div>
      )}
    </>
  );
}
