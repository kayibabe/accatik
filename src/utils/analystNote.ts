import type { Fixture, MarketOption } from '../types/fixtures.ts';
import { isPriced } from './pickResolver.ts';
import { marketProbability, mostLikelyMarket } from './probability.ts';

/**
 * API-Football's on-demand fallback is guidance, never a real pick. It must not
 * replace a note derived from the board's own data.
 */
const GENERIC_ADVICE = /\bto balance\b|\bvariance\b/i;

/**
 * Turns API-Football's one-line `predictions.advice` into the priced market it
 * refers to, when that can be done unambiguously.
 *
 * The note is text, not a bet, so it cannot be settled on its own. Attaching a
 * concrete market is what lets the note carry the same Win/Lost qualifier as
 * the Recommended Angle and Safer cover. When the advice names two different
 * bets ("Use Double Chance or Over 1.5 Goals...") or nothing at all, we return
 * null rather than inventing a result.
 */
export function resolveAnalystNoteMarket(
  fixture: Fixture,
  advice?: string | null
): MarketOption | null {
  const note = advice?.trim();
  if (!note) return null;

  // Captured when the note was stored; always the most reliable link.
  const recorded = fixture.markets.find(
    (market) => market.id === fixture.analystNoteMarketId
  );
  if (recorded) return recorded;

  // The server's generic fallback is guidance, never a pick.
  if (GENERIC_ADVICE.test(note)) return null;

  const lower = note.toLowerCase();
  const find = (predicate: (market: MarketOption) => boolean) =>
    fixture.markets.find(predicate) ?? null;

  const over = lower.match(/over\s+(\d+(?:\.\d+)?)/);
  if (over) {
    const target = `over ${over[1]}`;
    return find(
      (market) =>
        market.marketType === 'Goals' &&
        market.label.toLowerCase().startsWith(target)
    );
  }

  const under = lower.match(/under\s+(\d+(?:\.\d+)?)/);
  if (under) {
    const target = `under ${under[1]}`;
    return find(
      (market) =>
        market.marketType === 'Goals' &&
        market.label.toLowerCase().startsWith(target)
    );
  }

  if (lower.includes('both teams') || lower.includes('btts')) {
    const isNo = /\bno\b|\bnot\b|\bfail\b/.test(lower);
    return find(
      (market) =>
        market.marketType === 'BTTS' &&
        market.label.toLowerCase().includes('no') === isNo
    );
  }

  const isDoubleChance =
    lower.includes('double chance') ||
    /\b1x\b|\bx2\b|\b12\b/.test(lower) ||
    /home\s*(?:\/|or|and)\s*draw|draw\s*(?:\/|or|and)\s*away/.test(lower);
  if (isDoubleChance) {
    if (/\bx2\b|draw\s*(?:\/|or|and)\s*away/.test(lower)) {
      return find((market) => market.id.endsWith('-dc-x2'));
    }
    return find((market) => market.id.endsWith('-dc-1x'));
  }

  if (lower.includes('draw no bet') || lower.includes('dnb')) {
    const away = /\baway\b|dnb-a/.test(lower) || lower.includes(fixture.awayTeam.toLowerCase());
    return find((market) => market.id.endsWith(away ? '-dnb-a' : '-dnb-h'));
  }

  const homeName = fixture.homeTeam.toLowerCase();
  const awayName = fixture.awayTeam.toLowerCase();
  if (/\bhome\b/.test(lower) || (homeName.length > 2 && lower.includes(homeName))) {
    return find((market) => market.id.endsWith('-1x2-h'));
  }
  if (/\baway\b/.test(lower) || (awayName.length > 2 && lower.includes(awayName))) {
    return find((market) => market.id.endsWith('-1x2-a'));
  }
  if (/\bdraw\b/.test(lower)) {
    return find((market) => market.id.endsWith('-1x2-d'));
  }

  return null;
}

function formPoints(form?: string): number | null {
  if (!form) return null;
  const results = form.replace(/[^WDLwdl]/g, '').toUpperCase();
  if (!results) return null;
  return [...results].reduce(
    (points, result) => points + (result === 'W' ? 3 : result === 'D' ? 1 : 0),
    0
  );
}

function formSentence(fixture: Fixture): string | null {
  const home = formPoints(fixture.formHome);
  const away = formPoints(fixture.formAway);
  if (home === null || away === null) return null;
  if (home > away) {
    return `Recent form favours ${fixture.homeTeam} (${home} pts vs ${away})`;
  }
  if (away > home) {
    return `Recent form favours ${fixture.awayTeam} (${away} pts vs ${home})`;
  }
  return `Recent form is even (${home} pts each)`;
}

/**
 * A note built entirely from data already on the fixture. Slate prediction
 * enrichment is quota-bound and archived matchdays skip it, so without this
 * fallback most games only showed a note after a user opened the brief and
 * loaded the on-demand API result. Every fixture now has something to say on
 * first render; the API result, when it arrives, is still the fresher override.
 */
export function deriveAnalystNote(fixture: Fixture): string {
  const parts: string[] = [];
  const probabilities = fixture.modelProbabilities;
  const modelLean = probabilities
    ? ([
        { label: 'Home', value: probabilities.home },
        { label: 'Draw', value: probabilities.draw },
        { label: 'Away', value: probabilities.away },
      ]
        .filter((side) => side.value !== null)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0] ?? null)
    : null;

  if (modelLean && modelLean.value !== null && modelLean.value !== undefined) {
    parts.push(`Model leans ${modelLean.label} at ${modelLean.value.toFixed(0)}%`);
  } else {
    const priced = fixture.markets.filter(isPriced);
    const strongest = mostLikelyMarket({ ...fixture, markets: priced });
    parts.push(
      strongest
        ? `Price board's clearest line is ${strongest.label} at ${marketProbability(
            strongest
          ).toFixed(0)}% fair`
        : 'No priced line is available for this fixture yet'
    );
  }

  const form = formSentence(fixture);
  if (form) parts.push(form);

  const sentence = parts.join('; ');
  return sentence.endsWith('.') ? sentence : `${sentence}.`;
}

/**
 * The note shown on the card. Persisted provider advice wins, then a fresh
 * on-demand API result, then the board-derived note that lets every fixture
 * render without user interaction.
 */
export function getAnalystNote(
  fixture: Fixture,
  freshBestAngle?: string | null
): string | null {
  const persisted = fixture.modelAdvice?.trim();
  if (persisted) return persisted;

  const fresh = freshBestAngle?.trim();
  if (fresh && !GENERIC_ADVICE.test(fresh)) return fresh;

  return deriveAnalystNote(fixture);
}
