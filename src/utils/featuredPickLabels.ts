import type { FeaturedPickSource } from '../types/analytics.ts';

/**
 * Display names for the three featured cards.
 *
 * The ROI studies and the daily positive-read feed must label a `source` the
 * same way, so the mapping lives here instead of inside either component.
 */
export const FEATURED_SOURCE_LABELS: Record<FeaturedPickSource, string> = {
  angle: 'Model angle',
  cover: 'Alternative cover',
  note: 'Research note',
};

/** Matching accents so the same card is the same colour across every view. */
export const FEATURED_SOURCE_TONE: Record<FeaturedPickSource, string> = {
  angle: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  cover: 'border-sky-200 bg-sky-100 text-sky-800',
  note: 'border-violet-200 bg-violet-100 text-violet-800',
};
