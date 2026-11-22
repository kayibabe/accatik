import type { Fixture, MarketOption, MarketType } from '../types/fixtures.ts';

/**
 * Stable identity for a priced selection.
 *
 * Market ids contain the fixture id, and labels contain team names, so neither
 * can be used as an analytics grouping key on its own: "Arsenal Win" and
 * "Chelsea Win" are the same bet as far as a performance table is concerned.
 * This module maps both the id suffix and the human label onto one canonical
 * key per selection so inception-to-date records can be compared across teams
 * and across archive formats.
 */
export interface MarketSelection {
  key: string;
  /** Long name used in tables and records. */
  label: string;
  /** Compact betting-shop code used by filter chips (1, X, O2.5, X2, ...). */
  shortLabel?: string;
  marketType: MarketType;
}

/** Market order used by the grouped analytics table. */
export const SELECTION_MARKET_ORDER: MarketType[] = [
  '1X2',
  'Goals',
  'BTTS',
  'Double Chance',
  'Draw No Bet',
];

/** Selection order inside each market, matching the board's betting vocabulary. */
const SELECTION_ORDER = [
  '1X2-H',
  '1X2-D',
  '1X2-A',
  'GOALS-O0.5',
  'GOALS-O1.5',
  'GOALS-O2.5',
  'GOALS-O3.5',
  'GOALS-O4.5',
  'GOALS-O5.5',
  'GOALS-U5.5',
  'GOALS-U4.5',
  'GOALS-U3.5',
  'GOALS-U2.5',
  'GOALS-U1.5',
  'GOALS-U0.5',
  'BTTS-YES',
  'BTTS-NO',
  'DC-1X',
  'DC-12',
  'DC-X2',
  'DNB-1',
  'DNB-2',
];

const ORDER_INDEX = new Map(SELECTION_ORDER.map((key, index) => [key, index]));

const DC_LABELS: Record<string, string> = {
  'DC-1X': '1X (Home or Draw)',
  'DC-12': '12 (Home or Away)',
  'DC-X2': 'X2 (Draw or Away)',
};

/**
 * Every selection the app understands, including lines no archive has priced
 * yet. The analytics view uses this to show empty rows on request instead of
 * silently omitting a market the collector will start publishing later.
 */
export const MARKET_SELECTION_CATALOG: MarketSelection[] = SELECTION_ORDER.map(
  (key): MarketSelection => {
    const [group, side] = key.split('-');
    if (group === '1X2') {
      const label =
        side === 'H' ? 'Home Win' : side === 'A' ? 'Away Win' : 'Draw';
      return {
        key,
        label,
        shortLabel: side === 'H' ? '1' : side === 'A' ? '2' : 'X',
        marketType: '1X2',
      };
    }
    if (group === 'GOALS') {
      return {
        key,
        label: `${side[0] === 'O' ? 'Over' : 'Under'} ${side.slice(1)} Goals`,
        shortLabel: side,
        marketType: 'Goals',
      };
    }
    if (group === 'BTTS') {
      const label = side === 'NO' ? 'BTTS No' : 'BTTS Yes';
      return { key, label, shortLabel: label, marketType: 'BTTS' };
    }
    if (group === 'DC') {
      return {
        key,
        label: DC_LABELS[key],
        shortLabel: side,
        marketType: 'Double Chance',
      };
    }
    const dnbLabel = side === '1' ? '1 (DNB)' : '2 (DNB)';
    return {
      key,
      label: dnbLabel,
      shortLabel: dnbLabel,
      marketType: 'Draw No Bet',
    };
  }
);

const KNOWN_SELECTIONS = new Map(
  MARKET_SELECTION_CATALOG.map((selection) => [selection.key, selection])
);

/**
 * The fixed market shortlist studied by the combination ROI report.
 *
 * Order is the betting-shop order used in the report, not the canonical
 * catalog order: 1X2 sides, the goal ladder, BTTS, then the cover markets.
 * Keeping it here means the API, the table and any future export agree on
 * exactly which 18 selections are measured.
 */
export const COMBINATION_ROI_MARKET_KEYS: readonly string[] = [
  '1X2-H',
  '1X2-A',
  'GOALS-O1.5',
  'GOALS-O2.5',
  'GOALS-O3.5',
  'GOALS-O4.5',
  'GOALS-U1.5',
  'GOALS-U2.5',
  'GOALS-U3.5',
  'GOALS-U4.5',
  'BTTS-YES',
  'BTTS-NO',
  'DC-1X',
  '1X2-D',
  'DC-12',
  'DC-X2',
  'DNB-1',
  'DNB-2',
];

/** Resolves the study shortlist to the shared labels and identities. */
export function combinationRoiMarkets(): MarketSelection[] {
  return COMBINATION_ROI_MARKET_KEYS.map(
    (key) => KNOWN_SELECTIONS.get(key) ?? { key, label: key, marketType: '1X2' }
  );
}

function withShortLabel(
  key: string,
  label: string,
  marketType: MarketType
): MarketSelection {
  return {
    key,
    label,
    shortLabel: KNOWN_SELECTIONS.get(key)?.shortLabel ?? label,
    marketType,
  };
}

/** `15` -> `1.5`, `05` -> `0.5`. Goal lines are stored compactly in market ids. */
function formatLine(compact: string): string {
  if (compact.length <= 1) return `0.${compact}`;
  return `${compact.slice(0, -1)}.${compact.slice(-1)}`;
}

function sideFromLabel(
  label: string,
  fixture?: Pick<Fixture, 'homeTeam' | 'awayTeam'>
): 'H' | 'A' | 'D' | null {
  if (/^draw\b|^x$|draw no bet/i.test(label)) return 'D';
  const home = fixture?.homeTeam.trim().toLowerCase();
  const away = fixture?.awayTeam.trim().toLowerCase();
  if (home && label.includes(home)) return 'H';
  if (away && label.includes(away)) return 'A';
  if (/^home\b|\bhome win\b|^1$/i.test(label)) return 'H';
  if (/^away\b|\baway win\b|^2$/i.test(label)) return 'A';
  return null;
}

function goalLineFromLabel(label: string): { side: 'O' | 'U'; line: string } | null {
  const match = /\b(over|under)\s+(\d+(?:\.\d+)?)/i.exec(label);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line) || line < 0.5 || line > 6.5) return null;
  return {
    side: match[1].toLowerCase() === 'over' ? 'O' : 'U',
    line: String(line),
  };
}

/**
 * Resolve any priced market - new or archived - to its canonical selection.
 *
 * Id suffixes are authoritative because they survive team-name changes; the
 * label is the fallback for older archive rows with an unfamiliar id.
 */
export function resolveMarketSelection(
  market: MarketOption,
  fixture?: Pick<Fixture, 'homeTeam' | 'awayTeam'>
): MarketSelection {
  const type = market.marketType;
  const suffix = market.id.replace(/^\d+-/, '').toLowerCase();
  const label = market.label.trim().replace(/\s+/g, ' ');
  const lower = label.toLowerCase();

  if (type === '1X2') {
    const side =
      suffix.endsWith('-1x2-h')
        ? 'H'
        : suffix.endsWith('-1x2-d')
          ? 'D'
          : suffix.endsWith('-1x2-a')
            ? 'A'
            : sideFromLabel(lower, fixture);
    if (side) {
      const key = `1X2-${side}`;
      return withShortLabel(
        key,
        side === 'D' ? 'Draw' : side === 'H' ? 'Home Win' : 'Away Win',
        type
      );
    }
  }

  if (type === 'Goals') {
    let side: 'O' | 'U' | null = null;
    let line: string | null = null;
    const idMatch = /^ou-(u?)(\d+)$/.exec(suffix);
    if (idMatch) {
      side = idMatch[1] ? 'U' : 'O';
      line = formatLine(idMatch[2]);
    } else {
      const fromLabel = goalLineFromLabel(lower);
      if (fromLabel) {
        side = fromLabel.side;
        line = fromLabel.line;
      }
    }
    if (side && line) {
      const key = `GOALS-${side}${line}`;
      return withShortLabel(
        key,
        `${side === 'O' ? 'Over' : 'Under'} ${line} Goals`,
        type
      );
    }
  }

  if (type === 'BTTS') {
    const isNo = suffix.endsWith('-btts-no') || /\bno\b/.test(lower);
    return withShortLabel(
      isNo ? 'BTTS-NO' : 'BTTS-YES',
      isNo ? 'BTTS No' : 'BTTS Yes',
      type
    );
  }

  if (type === 'Double Chance') {
    const key = suffix.endsWith('-dc-12') || /^12\b/.test(lower)
      ? 'DC-12'
      : suffix.endsWith('-dc-x2') || /^x2\b/.test(lower)
        ? 'DC-X2'
        : suffix.endsWith('-dc-1x') || /^1x\b/.test(lower)
          ? 'DC-1X'
          : null;
    if (key) {
      const labels: Record<string, string> = {
        'DC-1X': '1X (Home or Draw)',
        'DC-12': '12 (Home or Away)',
        'DC-X2': 'X2 (Draw or Away)',
      };
      return withShortLabel(key, labels[key], type);
    }
  }

  if (type === 'Draw No Bet') {
    // A DNB label often contains the words "draw no bet", so the generic
    // draw check would misclassify it. Resolve the backed side directly.
    const home = fixture?.homeTeam.trim().toLowerCase();
    const away = fixture?.awayTeam.trim().toLowerCase();
    const side =
      suffix.endsWith('-dnb-h')
        ? 'H'
        : suffix.endsWith('-dnb-a')
          ? 'A'
          : home && lower.includes(home)
            ? 'H'
            : away && lower.includes(away)
              ? 'A'
              : /\bhome\b|\b1\b/.test(lower)
                ? 'H'
                : /\baway\b|\b2\b/.test(lower)
                  ? 'A'
                  : null;
    if (side) {
      const key = side === 'H' ? 'DNB-1' : 'DNB-2';
      return withShortLabel(key, side === 'H' ? '1 (DNB)' : '2 (DNB)', type);
    }
  }

  // Never drop an unfamiliar bet: it still gets a stable, distinct row.
  const key = `${type}|${label}`;
  return withShortLabel(key, label, type);
}

/** Canonical order: market first, then the known selection, then the label. */
export function compareSelections(
  a: Pick<MarketSelection, 'marketType' | 'key' | 'label'>,
  b: Pick<MarketSelection, 'marketType' | 'key' | 'label'>
): number {
  const marketDiff =
    SELECTION_MARKET_ORDER.indexOf(a.marketType) -
    SELECTION_MARKET_ORDER.indexOf(b.marketType);
  if (marketDiff !== 0) return marketDiff;
  const aIndex = ORDER_INDEX.get(a.key) ?? Number.MAX_SAFE_INTEGER;
  const bIndex = ORDER_INDEX.get(b.key) ?? Number.MAX_SAFE_INTEGER;
  if (aIndex !== bIndex) return aIndex - bIndex;
  return a.label.localeCompare(b.label);
}

export function compareMarketTypes(a: MarketType, b: MarketType): number {
  return SELECTION_MARKET_ORDER.indexOf(a) - SELECTION_MARKET_ORDER.indexOf(b);
}
