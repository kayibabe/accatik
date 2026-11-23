import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { PublicFixture } from '../types/fixtures.ts';

interface LandingPageProps {
  fixtures: PublicFixture[];
  displayDate: string;
  timezoneLabel: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSignIn: () => void;
}

const FREE_MODULES = [
  {
    title: 'Matchday Slate',
    detail: 'Fixture board with bookmaker prices and margin-adjusted probabilities.',
  },
  {
    title: 'Accumulator Builder',
    detail: 'Build a short ticket with a structural guard against poor value.',
  },
  {
    title: 'Saved Slips',
    detail: 'Keep your tickets synced to your account across devices.',
  },
  {
    title: 'My Activity',
    detail: 'Settlement results and a running view of your performance.',
  },
  {
    title: 'Sources',
    detail: 'The grounding links behind every slate and analysis.',
  },
];

const PRO_MODULES = [
  {
    title: 'Curated Acca',
    detail: 'A strategy-driven shortlist assembled from the day’s strongest angles.',
  },
  {
    title: 'Tactical Brief & Predictions',
    detail: 'On-demand team news, injuries and API-Football predictions.',
  },
  {
    title: 'Model Edge Comparison',
    detail: 'The provider’s model set beside the de-vigged book, side by side.',
  },
  {
    title: 'Advanced Slate Filters',
    detail: 'Narrow by angle, market, probability, price, edge and kickoff window.',
  },
  {
    title: 'Priority Data Refresh',
    detail: 'Pull fresh prices and results when you need an up-to-date board.',
  },
];

const HOW_IT_WORKS = [
  'Collect the day’s fixtures and pre-match bookmaker prices.',
  'Strip the margin and compare the book with the provider’s model.',
  'Assemble a capped 2–5 leg ticket using the structural guard.',
  'Settle saved slips and review how the approach performs over time.',
];

function statusLabel(status: PublicFixture['status']): string {
  switch (status) {
    case 'Live':
      return 'Live';
    case 'Finished':
      return 'Finished';
    case 'Void':
      return 'Void';
    default:
      return 'Scheduled';
  }
}

function statusTone(status: PublicFixture['status']): string {
  switch (status) {
    case 'Live':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'Finished':
      return 'border-slate-200 bg-slate-100 text-slate-700';
    case 'Void':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    default:
      return 'border-sky-200 bg-sky-50 text-sky-800';
  }
}

function ModuleList({
  items,
  accent,
}: {
  items: Array<{ title: string; detail: string }>;
  accent: 'plain' | 'pro';
}) {
  return (
    <ul className="mt-5 space-y-3">
      {items.map((item) => (
        <li key={item.title} className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border ${
              accent === 'pro'
                ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            <Check className="size-3" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{item.title}</p>
            <p className="text-xs leading-relaxed text-slate-600">{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LandingPage({
  fixtures,
  displayDate,
  timezoneLabel,
  loading,
  error,
  onRetry,
  onSignIn,
}: LandingPageProps) {
  const orderedFixtures = [...fixtures].sort((a, b) =>
    a.kickoffTime.localeCompare(b.kickoffTime)
  );

  return (
    <div className="space-y-10 sm:space-y-14">
      {/* Explanation */}
      <section
        id="how-it-works"
        aria-labelledby="landing-heading"
        className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white"
      >
        <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr] lg:items-center">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Grounded football analysis
            </span>
            <h1
              id="landing-heading"
              className="mt-4 text-2xl font-bold tracking-tight text-slate-900 [text-wrap:balance] sm:text-4xl"
            >
              Football accumulators, built on evidence — not hunches.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
              MatchSlip pulls today&apos;s fixtures and pre-match bookmaker prices
              from API-Football, removes the bookmaker margin, and compares the
              result with the provider&apos;s own model. It then assembles a short,
              structurally sound accumulator and keeps a settled record of every
              slip you save.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onSignIn}
                className="inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 cursor-pointer sm:w-auto"
              >
                Open the workbench
                <ArrowRight className="size-4" aria-hidden="true" />
              </button>
              <a
                href="#todays-matches"
                className="inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 sm:w-auto"
              >
                See today&apos;s matches
              </a>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Free to start · 18+ only · Bet responsibly
            </p>
          </div>

          <ol className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-5 sm:p-6">
            <li className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">
              How it works
            </li>
            {HOW_IT_WORKS.map((step, index) => (
              <li key={step} className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-700 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <span className="text-sm leading-relaxed text-slate-700">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Today's matches — names and kickoff times only, never prices or picks */}
      <section
        id="todays-matches"
        aria-labelledby="todays-matches-heading"
        className="scroll-mt-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <h2
              id="todays-matches-heading"
              className="text-2xl font-bold tracking-tight text-slate-900"
            >
              Today&apos;s matches
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {displayDate} · {timezoneLabel}
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Fixture list only — odds, picks and analysis appear after sign-in.
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loading ? (
            <ul className="divide-y divide-slate-100" aria-label="Loading matches">
              {[1, 2, 3, 4, 5].map((row) => (
                <li key={row} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                  <div className="h-4 w-14 rounded bg-slate-200 animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-56 max-w-full rounded bg-slate-200 animate-pulse" />
                    <div className="h-3 w-36 max-w-full rounded bg-slate-100 animate-pulse" />
                  </div>
                </li>
              ))}
            </ul>
          ) : error ? (
            <div className="p-8 text-center space-y-3">
              <AlertCircle
                className="size-7 text-red-600 mx-auto"
                aria-hidden="true"
              />
              <p className="text-sm font-semibold text-slate-900" role="alert">
                Could not load today&apos;s matches
              </p>
              <p className="text-xs text-slate-600">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Retry
              </button>
            </div>
          ) : orderedFixtures.length === 0 ? (
            <div className="p-10 text-center">
              <Clock3 className="size-7 text-slate-400 mx-auto" aria-hidden="true" />
              <p className="mt-3 text-sm font-semibold text-slate-900">
                No matches listed for today
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Check back later for the next matchday schedule.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orderedFixtures.map((fixture) => (
                <li
                  key={fixture.id}
                  className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                >
                  <span className="w-16 shrink-0 font-mono text-sm font-semibold text-slate-800 tabular-nums">
                    {fixture.kickoffTime}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {fixture.homeTeam}{' '}
                      <span className="font-normal text-slate-500">vs</span>{' '}
                      {fixture.awayTeam}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {fixture.competition} · {fixture.country}
                    </p>
                  </div>
                  <span
                    className={`inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusTone(
                      fixture.status
                    )}`}
                  >
                    {statusLabel(fixture.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Module alerts by account tier */}
      <section
        id="modules"
        aria-labelledby="modules-heading"
        className="scroll-mt-6 space-y-4"
      >
        <div>
          <h2
            id="modules-heading"
            className="text-2xl font-bold tracking-tight text-slate-900"
          >
            What you get when you sign in
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Every account opens the workbench. Pro adds the deeper analysis
            layer on top.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-slate-600" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-slate-900">
                Free account
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Everything you need to build and track a disciplined accumulator.
            </p>
            <ModuleList items={FREE_MODULES} accent="plain" />
            <button
              type="button"
              onClick={onSignIn}
              className="mt-6 inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Create a free account
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </article>

          <article className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-5 text-emerald-700" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-slate-900">Pro account</h3>
              <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Pro
              </span>
            </div>
            <p className="mt-1 text-xs text-emerald-900">
              All Free modules, plus the tools for deeper match-level decisions.
            </p>
            <ModuleList items={PRO_MODULES} accent="pro" />
            <button
              type="button"
              onClick={onSignIn}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
            >
              Sign in to explore
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </button>
          </article>
        </div>
        <p className="text-xs text-slate-500">
          Tier labels describe the planned packaging. Sign-in currently opens
          the full workbench while Pro access is being rolled out.
        </p>
      </section>
    </div>
  );
}
