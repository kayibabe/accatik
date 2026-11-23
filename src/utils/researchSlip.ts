import type { AccaLeg } from '../types/fixtures.ts';

/**
 * Merge research selections into the working slip without applying the
 * recommendation cap. Positive Reads and AI Desk use this path so the user's
 * whole selection stays visible; Ticket Review labels the wide shape instead
 * of silently trimming it.
 *
 * One leg per fixture: a later selection replaces the leg already held for
 * that match rather than creating a same-match combination.
 */
export function mergeResearchLegs(
  current: AccaLeg[],
  incoming: AccaLeg[]
): AccaLeg[] {
  const byFixture = new Map<string, AccaLeg>();
  for (const leg of incoming) {
    if (!byFixture.has(leg.fixtureId)) byFixture.set(leg.fixtureId, leg);
  }
  if (byFixture.size === 0) return current;

  const next = [...current];
  for (const leg of byFixture.values()) {
    const index = next.findIndex((item) => item.fixtureId === leg.fixtureId);
    if (index >= 0) next[index] = leg;
    else next.push(leg);
  }
  return next;
}
