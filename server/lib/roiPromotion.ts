import type {
  FeaturedAnalyticsRow,
  FeaturedPickSource,
  PickAnalyticsResponse,
  RoiPromotionConfig,
  RoiPromotionResult,
  RoiRegistryEntry,
  RoiRegistryStatus,
} from '../../src/types/analytics.ts';
import type { AccaStrategy } from '../../src/types/fixtures.ts';

/**
 * Daily positive-ROI promotion state machine.
 *
 * A featured card is promoted only when its flat-stake record is large enough,
 * spans enough matchdays, and its ROI stays positive after resampling whole
 * matchdays. Promotion needs two consecutive qualifying snapshots and demotion
 * three failing ones, so a noisy day cannot flip the whitelist. Everything is
 * keyed by strategy: changing strategy re-baselines rather than inheriting a
 * promotion earned under different rules.
 */

export const DEFAULT_ROI_PROMOTION_CONFIG: RoiPromotionConfig = {
  prematchOnly: true,
  minSettled: 20,
  minSpanDays: 10,
  requirePositiveCi: true,
  promoteAfter: 2,
  demoteAfter: 3,
  retireAfterDays: 7,
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** 95% Wilson interval for a proportion, as percentages. */
export function wilson(wins: number, n: number): [number, number] {
  if (n <= 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [
    round1(Math.max(0, centre - margin) * 100),
    round1(Math.min(1, centre + margin) * 100),
  ];
}

/**
 * ROI interval that resamples whole matchdays, not individual legs. Legs on the
 * same slate share a book and a set of margins, so treating them as independent
 * would understate the uncertainty.
 */
export function clusterRoiCi(
  rows: Array<{ dateIso: string; odds: number; won: boolean }>,
  iterations = 2000
): [number, number] {
  const days = new Map<string, Array<{ odds: number; won: boolean }>>();
  for (const row of rows) {
    const list = days.get(row.dateIso) ?? [];
    list.push({ odds: row.odds, won: row.won });
    days.set(row.dateIso, list);
  }
  const keys = [...days.keys()];
  if (keys.length < 2) return [0, 0];

  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let n = 0;
    let returned = 0;
    for (let k = 0; k < keys.length; k += 1) {
      const day = days.get(keys[Math.floor(Math.random() * keys.length)])!;
      for (const row of day) {
        n += 1;
        returned += row.won ? row.odds : 0;
      }
    }
    samples.push(((returned - n) / n) * 100);
  }
  samples.sort((a, b) => a - b);
  return [
    round1(samples[Math.floor(iterations * 0.025)]),
    round1(samples[Math.floor(iterations * 0.975)]),
  ];
}

export function daysBetweenIso(first: string | null, last: string): number {
  if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first)) return 0;
  const a = Date.parse(`${first}T00:00:00Z`);
  const b = Date.parse(`${last}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function registryKey(
  strategy: AccaStrategy,
  source: FeaturedPickSource,
  selectionKey: string
): string {
  return `${strategy}::${source}::${selectionKey}`;
}

interface Evaluation {
  qualifies: boolean;
  roiCi: [number, number];
  hitRateCi: [number, number];
  spanDays: number;
  reasons: string[];
}

function evaluate(
  row: FeaturedAnalyticsRow,
  samples: Array<{ dateIso: string; odds: number; won: boolean }>,
  config: RoiPromotionConfig
): Evaluation {
  const reasons: string[] = [];
  const decided = row.wins + row.losses;
  const roiCi = clusterRoiCi(samples);
  const hitRateCi = wilson(row.wins, decided);
  const firstDateIso = row.firstDateIso ?? null;
  const lastDateIso = row.lastDateIso ?? null;
  const spanDays = daysBetweenIso(firstDateIso, lastDateIso ?? '');

  if (row.settled < config.minSettled) {
    reasons.push(`only ${row.settled}/${config.minSettled} settled picks`);
  }
  if (spanDays < config.minSpanDays) {
    reasons.push(`date span ${spanDays}/${config.minSpanDays} days`);
  }
  if (row.roi === null || row.roi <= 0) {
    reasons.push(`ROI ${row.roi === null ? 'unknown' : `${row.roi}%`} is not positive`);
  }
  if (config.requirePositiveCi && roiCi[0] <= 0) {
    reasons.push(`ROI ${roiCi[0]}%..${roiCi[1]}% interval crosses zero`);
  }

  return {
    qualifies: reasons.length === 0,
    roiCi,
    hitRateCi,
    spanDays,
    reasons,
  };
}

function statusAfterFailure(
  prior: RoiRegistryEntry | undefined,
  failingStreak: number,
  config: RoiPromotionConfig
): RoiRegistryStatus {
  if (prior?.status === 'promoted') {
    return failingStreak >= config.demoteAfter ? 'demoted' : 'promoted';
  }
  if (prior?.status === 'demoted') return 'demoted';
  return 'watch';
}

/** Applies one daily snapshot to the previous registry, keeping all history. */
export function applyRoiPromotion(
  previous: RoiRegistryEntry[],
  analytics: PickAnalyticsResponse,
  strategy: AccaStrategy,
  config: RoiPromotionConfig = DEFAULT_ROI_PROMOTION_CONFIG,
  snapshotDateIso: string = analytics.generatedAt.slice(0, 10)
): RoiPromotionResult {
  const priorByKey = new Map(
    previous
      .filter((entry) => entry.strategy === strategy)
      .map((entry) => [registryKey(strategy, entry.source, entry.selectionKey), entry])
  );
  const samplesByKey = new Map<string, Array<{ dateIso: string; odds: number; won: boolean }>>();
  for (const sample of analytics.featuredSelectionSamples ?? []) {
    const list = samplesByKey.get(sample.key) ?? [];
    list.push({ dateIso: sample.dateIso, odds: sample.odds, won: sample.won });
    samplesByKey.set(sample.key, list);
  }

  const entries: RoiRegistryEntry[] = [];
  const transitions: string[] = [];
  const seenKeys = new Set<string>();

  for (const row of analytics.featuredBySelection) {
    const key = registryKey(strategy, row.source, row.selectionKey);
    seenKeys.add(key);
    const prior = priorByKey.get(key);
    const samples = samplesByKey.get(row.key) ?? [];
    const evaluation = evaluate(row, samples, config);

    const settledGrew = !prior || row.settled > prior.settled;
    const lastSeenDateIso = settledGrew
      ? snapshotDateIso
      : (prior?.lastSeenDateIso ?? snapshotDateIso);
    const stale =
      daysBetweenIso(lastSeenDateIso, snapshotDateIso) > config.retireAfterDays;

    let status: RoiRegistryStatus;
    let qualifyingStreak: number;
    let failingStreak: number;
    let reason: string;

    if (evaluation.qualifies) {
      qualifyingStreak = (prior?.qualifyingStreak ?? 0) + 1;
      failingStreak = 0;
      if (stale) {
        status = 'retired';
        reason = `Evidence is ${daysBetweenIso(lastSeenDateIso, snapshotDateIso)} days old; needs a fresh settled pick.`;
      } else if (qualifyingStreak >= config.promoteAfter) {
        status = 'promoted';
        reason = `Promoted: ROI ${row.roi}% with ${row.settled} settled picks across ${evaluation.spanDays} days; clustered interval ${evaluation.roiCi[0]}%..${evaluation.roiCi[1]}%.`;
      } else {
        status = prior?.status === 'promoted' ? 'promoted' : 'watch';
        reason = `Qualifying snapshot ${qualifyingStreak}/${config.promoteAfter}; ${evaluation.roiCi[0]}%..${evaluation.roiCi[1]}% interval.`;
      }
    } else {
      qualifyingStreak = 0;
      failingStreak = (prior?.failingStreak ?? 0) + 1;
      if (stale) {
        status = 'retired';
        reason = `Evidence is ${daysBetweenIso(lastSeenDateIso, snapshotDateIso)} days old; no new settled pick.`;
      } else {
        status = statusAfterFailure(prior, failingStreak, config);
        reason = `Not qualified (${evaluation.reasons.join(', ')}); failing ${failingStreak}/${config.demoteAfter}.`;
      }
    }

    const entry: RoiRegistryEntry = {
      strategy,
      source: row.source,
      selectionKey: row.selectionKey,
      marketType: row.marketType,
      label: row.label,
      settled: row.settled,
      wins: row.wins,
      losses: row.losses,
      roi: row.roi,
      roiCiLow: evaluation.roiCi[0],
      roiCiHigh: evaluation.roiCi[1],
      hitRateCiLow: evaluation.hitRateCi[0],
      hitRateCiHigh: evaluation.hitRateCi[1],
      avgOdds: row.avgOdds,
      firstDateIso: row.firstDateIso ?? null,
      lastDateIso: row.lastDateIso ?? null,
      status,
      promotedAt:
        status === 'promoted' ? (prior?.promotedAt ?? snapshotDateIso) : null,
      lastSeenDateIso,
      qualifyingStreak,
      failingStreak,
      reason,
      snapshotDateIso,
    };
    entries.push(entry);
    if (prior && prior.status !== status) {
      transitions.push(`${key}: ${prior.status} -> ${status}`);
    } else if (!prior && status === 'promoted') {
      transitions.push(`${key}: new -> promoted`);
    }
  }

  // Rows the current scan no longer emits keep their history but are retired:
  // an absent row means the strategy no longer produces that selection.
  for (const prior of previous) {
    if (prior.strategy !== strategy || seenKeys.has(registryKey(strategy, prior.source, prior.selectionKey))) {
      continue;
    }
    const retired: RoiRegistryEntry = {
      ...prior,
      status: 'retired',
      reason: 'Selection no longer produced by this strategy.',
      snapshotDateIso,
    };
    entries.push(retired);
    if (prior.status !== 'retired') {
      transitions.push(`${registryKey(strategy, prior.source, prior.selectionKey)}: ${prior.status} -> retired`);
    }
  }

  entries.sort((a, b) =>
    registryKey(strategy, a.source, a.selectionKey).localeCompare(
      registryKey(strategy, b.source, b.selectionKey)
    )
  );

  return {
    strategy,
    snapshotDateIso,
    config,
    entries,
    promotedKeys: entries.filter((entry) => entry.status === 'promoted').map((entry) => entry.selectionKey),
    transitions,
    analytics: {
      generatedAt: analytics.generatedAt,
      sampleDates: analytics.sampleDates,
      sampleFixtures: analytics.sampleFixtures,
      priceQuality: analytics.priceQuality,
    },
  };
}

/** The whitelist as a set of `source:selectionKey` pairs. */
export function promotedWhitelist(entries: RoiRegistryEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.status === 'promoted')
      .map((entry) => `${entry.source}:${entry.selectionKey}`)
  );
}
