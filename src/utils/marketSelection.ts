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
  label: string;
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
      return {
        key,
        label: side === 'H' ? 'Home Win' : side === 'A' ? 'Away Win' : 'Draw',
        marketType: '1X2',
      };
    }
    if (group === 'GOALS') {
      return {
        key,
        label: `${side[0] === 'O' ? 'Over' : 'Under'} ${side.slice(1)} Goals`,
        marketType: 'Goals',
      };
    }
    if (group === 'BTTS') {
      return {
        key,
        label: side === 'NO' ? 'BTTS No' : 'BTTS Yes',
        marketType: 'BTTS',
      };
    }
    if (group === 'DC') {
      return { key, label: DC_LABELS[key], marketType: 'Double Chance' };
    }
    return {
      key,
      label: side === '1' ? '1 (DNB)' : '2 (DNB)',
      marketType: 'Draw No Bet',
    };
  }
);

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
      return {
        key: `1X2-${side}`,
        label: side === 'D' ? 'Draw' : side === 'H' ? 'Home Win' : 'Away Win',
        marketType: type,
      };
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
      return {
        key: `GOALS-${side}${line}`,
        label: `${side === 'O' ? 'Over' : 'Under'} ${line} Goals`,
        marketType: type,
      };
    }
  }

  if (type === 'BTTS') {
    const isNo = suffix.endsWith('-btts-no') || /\bno\b/.test(lower);
    return {
      key: isNo ? 'BTTS-NO' : 'BTTS-YES',
      label: isNo ? 'BTTS No' : 'BTTS Yes',
      marketType: type,
    };
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
      return { key, label: labels[key], marketType: type };
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
      return {
        key: side === 'H' ? 'DNB-1' : 'DNB-2',
        label: side === 'H' ? '1 (DNB)' : '2 (DNB)',
        marketType: type,
      };
    }
  }

  // Never drop an unfamiliar bet: it still gets a stable, distinct row.
  return { key: `${type}|${label}`, label, marketType: type };
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
