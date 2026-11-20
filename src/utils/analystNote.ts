import type { Fixture, MarketOption } from '../types/fixtures.ts';

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
  if (/\bto balance\b|\bvariance\b/i.test(note)) return null;

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

/** The note shown on the card: persisted model advice first, fresh API result second. */
export function getAnalystNote(
  fixture: Fixture,
  freshBestAngle?: string | null
): string | null {
  return fixture.modelAdvice?.trim() || freshBestAngle?.trim() || null;
}
