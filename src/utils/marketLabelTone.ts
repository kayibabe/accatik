import type { MarketType } from '../types/fixtures.ts';

/**
 * One accent per betting market family.
 *
 * Market names carry meaning, so the colour is only ever an extra cue: the
 * label itself is always rendered next to it. The chip tones use a white fill
 * so they stay legible on the tinted model-angle / cover / note cards.
 */
export const MARKET_FAMILY_CHIP_TONE: Record<MarketType, string> = {
  '1X2': 'border-teal-200 bg-white/85 text-teal-800',
  Goals: 'border-indigo-200 bg-white/85 text-indigo-800',
  BTTS: 'border-rose-200 bg-white/85 text-rose-800',
  'Double Chance': 'border-orange-200 bg-white/85 text-orange-800',
  'Draw No Bet': 'border-violet-200 bg-white/85 text-violet-800',
};

/** Text-only counterpart for dense table cells that must stay compact. */
export const MARKET_FAMILY_TEXT_TONE: Record<MarketType, string> = {
  '1X2': 'text-teal-700',
  Goals: 'text-indigo-700',
  BTTS: 'text-rose-700',
  'Double Chance': 'text-orange-700',
  'Draw No Bet': 'text-violet-700',
};

const NEUTRAL_CHIP = 'border-slate-200 bg-white/85 text-slate-700';
const NEUTRAL_TEXT = 'text-slate-700';

export function marketChipTone(type: MarketType | null | undefined): string {
  return (type && MARKET_FAMILY_CHIP_TONE[type]) || NEUTRAL_CHIP;
}

export function marketTextTone(type: MarketType | null | undefined): string {
  return (type && MARKET_FAMILY_TEXT_TONE[type]) || NEUTRAL_TEXT;
}

/** Canonical keys such as `GOALS-O2.5`, `DC-X2` and `DNB-1`. */
export function marketTypeFromSelectionKey(key: string): MarketType | null {
  const byPrefix: Record<string, MarketType> = {
    '1X2': '1X2',
    GOALS: 'Goals',
    BTTS: 'BTTS',
    DC: 'Double Chance',
    DNB: 'Draw No Bet',
  };
  return byPrefix[key.split('-')[0].toUpperCase()] ?? null;
}

interface MarketPhrase {
  type: MarketType;
  pattern: RegExp;
}

/**
 * Ordered so that Draw No Bet is matched before Draw, and double chances
 * before their bare 1X / X2 / 12 codes.
 */
const MARKET_PHRASES: readonly MarketPhrase[] = [
  {
    type: 'Goals',
    pattern: /^(?:over|under)\s+\d+(?:\.\d+)?(?:\s+goals)?\b/i,
  },
  {
    type: 'BTTS',
    pattern: /^(?:btts\s+(?:yes|no)|both teams(?:\s+to)?\s+score(?:\s+(?:yes|no))?)\b/i,
  },
  { type: 'Draw No Bet', pattern: /^(?:draw no bet|dnb)\b/i },
  { type: 'Double Chance', pattern: /^(?:double chance|1x|12|x2)\b/i },
  { type: '1X2', pattern: /^(?:home win|away win|draw|x)\b/i },
];

/** Best-effort family detection for labels where no typed market is available. */
export function marketTypeFromLabel(label: string): MarketType | null {
  const text = label.trim().replace(/\s+/g, ' ');
  return MARKET_PHRASES.find(({ pattern }) => pattern.test(text))?.type ?? null;
}

export interface LeadingMarketLabel {
  /** The market phrase found at the start of the note, ready to display. */
  label: string;
  /** The rest of the note after the phrase and an optional separator. */
  rest: string;
  marketType: MarketType | null;
}

/**
 * Splits provider advice such as `Double chance : draw or Birmingham` into a
 * colourable market label plus the explanatory tail. Notes that do not start
 * with a known market phrase are returned unchanged.
 */
export function splitLeadingMarketLabel(note: string): LeadingMarketLabel {
  const text = note.trim().replace(/\s+/g, ' ');
  let matched: RegExpMatchArray | null = null;
  let marketType: MarketType | null = null;
  for (const phrase of MARKET_PHRASES) {
    const candidate = text.match(phrase.pattern);
    if (candidate) {
      matched = candidate;
      marketType = phrase.type;
      break;
    }
  }
  if (!matched || !marketType) {
    return { label: '', rest: text, marketType: null };
  }

  const raw = matched[0];
  const rest = text
    .slice(raw.length)
    .replace(/^\s*(?:[:;–—-]\s*)?/, '')
    .trim();
  const code = raw.toLowerCase();
  const canonical: Record<string, string> = {
    'double chance': 'Double Chance',
    'draw no bet': 'Draw No Bet',
    'btts yes': 'BTTS Yes',
    'btts no': 'BTTS No',
    'home win': 'Home Win',
    'away win': 'Away Win',
    draw: 'Draw',
  };
  const label =
    canonical[code] ??
    (['dnb', '1x', 'x2', '12'].includes(code)
      ? code.toUpperCase()
      : raw
          .replace(/\bgoals\b/i, 'Goals')
          .replace(/^./, (letter) => letter.toUpperCase()));

  return { label, rest, marketType };
}
