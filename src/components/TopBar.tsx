import { LogOut, RefreshCw, ShieldCheck, UserRound } from 'lucide-react';
import type { AppUser, UserProfile } from '../types/user.ts';

export type ActiveTab = 'slate' | 'acca' | 'saved' | 'activity' | 'sources';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onRefresh: () => void;
  isLoading: boolean;
  savedCount: number;
  user?: AppUser | null;
  profile?: UserProfile | null;
  onSignIn?: () => void;
  onSignOut?: () => void;
  onResendVerification?: () => void;
  isAdmin?: boolean;
  onAdmin?: () => void;
  /** Guests see landing-page anchors instead of the signed-in workbench tabs. */
  isGuest?: boolean;
}

export function TopBar({
  activeTab,
  onSelectTab,
  onRefresh,
  isLoading,
  savedCount,
  user,
  profile,
  onSignIn,
  onSignOut,
  onResendVerification,
  isAdmin,
  onAdmin,
  isGuest,
}: TopBarProps) {
  const guest = isGuest ?? !user;
  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'slate', label: 'Matchday Slate' },
    { id: 'acca', label: 'Curated Acca' },
    {
      id: 'saved',
      label: savedCount > 0 ? `Saved Slips (${savedCount})` : 'Saved Slips',
    },
    { id: 'activity', label: 'My Activity' },
    { id: 'sources', label: 'Sources' },
  ];
  const guestNavItems = [
    { href: '#how-it-works', label: 'How it works' },
    { href: '#todays-matches', label: "Today's matches" },
    { href: '#modules', label: 'Modules' },
  ];

  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() =>
            guest
              ? window.scrollTo({ top: 0, behavior: 'smooth' })
              : onSelectTab('slate')
          }
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          MatchSlip
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {guest
            ? guestNavItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="py-5 border-b-2 border-transparent text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  {item.label}
                </a>
              ))
            : navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTab(item.id)}
                    className={`py-5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 ${
                      isActive
                        ? 'border-emerald-700 text-slate-900 font-semibold'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
        </nav>

        {/* Zone 3: account + primary action */}
        <div className="flex items-center gap-2 shrink-0">
          {!guest && isAdmin && (
            <button
              type="button"
              onClick={onAdmin}
              title="Admin · manage user roles"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
              Admin
            </button>
          )}
          {!guest && user ? (
            <div className="hidden sm:flex items-center gap-2">
              {!user.emailVerified && onResendVerification && (
                <button
                  type="button"
                  onClick={onResendVerification}
                  title="Send a new verification email"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer"
                >
                  Resend verification
                </button>
              )}
              <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs">
                <UserRound className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span className="max-w-[140px] truncate text-slate-700">
                  {user.name}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                    profile
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                  title={
                    profile
                      ? undefined
                      : 'Your role could not be loaded. It will appear once the account service responds.'
                  }
                >
                  {profile ? profile.role : 'role unavailable'}
                </span>
                {!user.emailVerified && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                    unverified
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onSignOut}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className={
                guest
                  ? 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700'
                  : 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer'
              }
            >
              <UserRound className="w-3.5 h-3.5" aria-hidden="true" />
              Sign in
            </button>
          )}
          {!guest && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isLoading ? 'Loading Slate' : 'Refresh Slate'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation strip */}
      <nav
        aria-label="Mobile navigation"
        className="flex md:hidden items-center gap-4 px-4 pb-2.5 overflow-x-auto text-xs font-medium border-t border-slate-100"
      >
        {guest
          ? guestNavItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="pt-2 pb-1 border-b-2 border-transparent text-slate-600 whitespace-nowrap shrink-0"
              >
                {item.label}
              </a>
            ))
          : navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`pt-2 pb-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'border-emerald-700 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-600'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
        {!guest && user && !user.emailVerified && onResendVerification && (
          <button
            type="button"
            onClick={onResendVerification}
            className="pt-2 pb-1 text-amber-700 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            Resend verification
          </button>
        )}
        <button
          type="button"
          onClick={!guest && user ? onSignOut : onSignIn}
          className="ml-auto pt-2 pb-1 text-emerald-700 font-semibold whitespace-nowrap shrink-0 cursor-pointer"
        >
          {!guest && user ? 'Sign out' : 'Sign in'}
        </button>
      </nav>
    </header>
  );
}
