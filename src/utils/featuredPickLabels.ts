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
