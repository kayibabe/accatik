import type { AiPick } from '../types/ai.ts';

type SummaryPick = Pick<AiPick, 'aiScore' | 'evStress' | 'band'>;

/**
 * The ranked-picks summary follows the visible score bar. The briefing's own
 * summary describes the full eligible pool, so using it after the bar moves
 * would claim more picks than the list actually contains.
 */
export function aiPicksSummary(
  picks: readonly SummaryPick[],
  displayDate: string,
  minScore: number
): string {
  const gate = minScore > 0
    ? `model-score bar of ${minScore} and the stressed-EV gate`
    : 'stressed-EV gate';
  if (picks.length === 0) {
    return `No priced selection on ${displayDate} clears the ${gate}. ` +
      'That is a valid result: a quiet day is not a reason to force a pick.';
  }
  const avgScore = picks.reduce((sum, pick) => sum + pick.aiScore, 0) / picks.length;
  const bestEv = Math.max(...picks.map((pick) => pick.evStress));
  const strong = picks.filter((pick) => pick.band === 'High' || pick.band === 'Solid').length;
  return `${picks.length} selections clear the ${gate} on ${displayDate}. ` +
    `Average AI score ${avgScore.toFixed(0)}/100, best stressed EV ` +
    `${(bestEv * 100).toFixed(1)}%, ${strong} high/solid-confidence estimates. ` +
    'Ranked by stressed EV and model agreement, never by hit rate alone.';
}
