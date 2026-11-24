import type { FrameworkStatus } from '../framework/config.ts';
import type { SettlementStatus } from '../types/fixtures.ts';
import type { AngleConfidence } from './recommendedAngle.ts';

/**
 * One palette for semantic states across the whole workbench.
 *
 * Colour is never the only signal: every place using these maps also renders
 * the status text (or an icon) so dense tables stay legible without colour.
 */

export const FRAMEWORK_TONE: Record<FrameworkStatus, string> = {
  QUALIFIED: 'text-emerald-800 bg-emerald-100/80 border-emerald-200',
  CONDITIONAL_REVIEW: 'text-amber-800 bg-amber-100/80 border-amber-200',
  SCREEN_ONLY: 'text-slate-700 bg-slate-100 border-slate-200',
  REJECTED: 'text-red-700 bg-red-100/80 border-red-200',
  INSUFFICIENT_DATA: 'text-slate-600 bg-slate-100 border-slate-200',
};

export const FRAMEWORK_DOT: Record<FrameworkStatus, string> = {
  QUALIFIED: 'bg-emerald-500',
  CONDITIONAL_REVIEW: 'bg-amber-500',
  SCREEN_ONLY: 'bg-slate-400',
  REJECTED: 'bg-red-500',
  INSUFFICIENT_DATA: 'bg-slate-300',
};

const FRAMEWORK_FALLBACK =
  'text-slate-700 bg-slate-100 border-slate-200';

export function frameworkTone(status: string | null | undefined): string {
  return (status && FRAMEWORK_TONE[status as FrameworkStatus]) || FRAMEWORK_FALLBACK;
}

export function frameworkDot(status: string | null | undefined): string {
  return (status && FRAMEWORK_DOT[status as FrameworkStatus]) || 'bg-slate-300';
}

export const ANGLE_TONE: Record<AngleConfidence, string> = {
  High: 'text-emerald-800 bg-emerald-100/80 border-emerald-200',
  Solid: 'text-sky-800 bg-sky-100/80 border-sky-200',
  Moderate: 'text-amber-800 bg-amber-100/80 border-amber-200',
  Speculative: 'text-slate-700 bg-slate-100 border-slate-200',
};

export function angleTone(band: string | null | undefined): string {
  return (band && ANGLE_TONE[band as AngleConfidence]) || ANGLE_TONE.Speculative;
}

/** Pill-style settlement tones (the compact counterpart to SettlementLabel). */
export const SETTLEMENT_TONE: Record<SettlementStatus, string> = {
  Win: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Lost: 'bg-red-50 text-red-700 border-red-200',
  Void: 'bg-amber-50 text-amber-700 border-amber-200',
  Live: 'bg-sky-50 text-sky-700 border-sky-200',
  Pending: 'bg-slate-50 text-slate-600 border-slate-200',
};

export function settlementTone(status: string | null | undefined): string {
  return (status && SETTLEMENT_TONE[status as SettlementStatus]) || SETTLEMENT_TONE.Pending;
}

/** P&L text tone shared by every analytics table and metric card. */
export function pnlTone(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'text-slate-500';
  }
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-red-600';
  return 'text-slate-600';
}

export type PageScope = 'personal' | 'global' | 'research';

export const SCOPE_META: Record<
  PageScope,
  { label: string; className: string; description: string }
> = {
  personal: {
    label: 'Personal',
    className: 'border-sky-200 bg-sky-50 text-sky-700',
    description: 'Only the slips saved in this account or browser.',
  },
  global: {
    label: 'Global',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
    description: 'Aggregated across every archived matchday.',
  },
  research: {
    label: 'Research',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    description: 'Read-only study data. Not a live betting recommendation.',
  },
};

/**
 * Canonical metric definitions used by the info affordances on data-heavy
 * screens. The same key always shows the same wording so numbers mean the
 * same thing in Analytics, My Activity and Saved Slips.
 */
export const METRIC_INFO: Record<
  string,
  { label: string; definition: string; source: string }
> = {
  fairProbability: {
    label: 'Fair probability',
    definition: 'Bookmaker price with the margin removed (de-vigged), or the model probability when no complete book is available.',
    source: 'Captured price snapshot · framework assessment',
  },
  impliedProbability: {
    label: 'Implied probability',
    definition: 'The raw probability implied by the decimal odds, including the bookmaker margin.',
    source: 'Captured price snapshot',
  },
  modelEdge: {
    label: 'Model edge (pp)',
    definition: 'Model probability minus the best fair book probability, in percentage points.',
    source: 'API-Football 1X2 model at capture time',
  },
  ticketEdge: {
    label: 'Ticket edge (pp)',
    definition: 'De-vigged fair chance minus the ticket’s break-even chance, in percentage points.',
    source: 'Captured price snapshot · ticket guard',
  },
  ticketEv: {
    label: 'EV %',
    definition: 'Fair chance as a fraction multiplied by the combined decimal odds, minus one, shown as a percent. Positive means the captured fair price beats break-even.',
    source: 'Captured price snapshot · ticket guard',
  },
  roi: {
    label: 'ROI',
    definition: 'Net profit divided by total stake across settled selections. Voids return stake but are excluded from hit rate.',
    source: 'Settled archive / saved slips',
  },
  clv: {
    label: 'Closing line value',
    definition: 'Change between the price taken and the last pre-match price observed. Positive means a better price was taken.',
    source: 'Shadow ticket ledger · pre-match quote history',
  },
  confidence: {
    label: 'Confidence',
    definition: 'Framework confidence band after sample size, odds freshness, market calibration and risk-flag checks.',
    source: 'Framework assessment · settled market Brier',
  },
  calibration: {
    label: 'Market calibration',
    definition: 'Brier score of the captured model probability against settled outcomes for this market. Lower is better; too few settled legs means calibration is unavailable.',
    source: 'Settled shadow ledger · frozen matchday archive',
  },
  stake: {
    label: 'Suggested stake',
    definition: 'Quarter-Kelly suggestion from the stressed decision probability and model disagreement, capped at 2% of bankroll per selection.',
    source: 'AI desk ensemble',
  },
  pnl: {
    label: 'Profit / loss',
    definition: 'Returns minus stake for settled slips only. Open slips are excluded; voids are flat.',
    source: 'Saved slip settlement',
  },
  ev: {
    label: 'EV %',
    definition: 'Model probability multiplied by the price, minus one, expressed as a percentage. Positive means the price beats the model’s fair price.',
    source: 'Framework model · captured price snapshot',
  },
};
