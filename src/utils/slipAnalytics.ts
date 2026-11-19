import type {
  MarketType,
  SettlementStatus,
} from '../types/fixtures.ts';

/**
 * Saved-slip performance analytics.
 *
 * Everything here is derived from the ticket archive plus the settlement each
 * slip already gets from `evaluateTicketSettlement`. P&L and ROI count only
 * slips that reached a result (Win/Lost). Void slips have their stake returned,
 * so they are reported separately and never dilute ROI. Open slips are counted
 * but excluded from every money metric, so the numbers cannot drift while a
 * match is still in play.
 */

export interface SlipSettlementInput {
  id: string;
  /** CAT matchday the slip belongs to. */
  dateIso: string;
  /** When the slip was saved, used for streaks and the equity curve. */
  createdAt: string;
  stake: number;
  /** Void-adjusted total odds from the settlement. */
  effectiveOdds: number;
  legCount: number;
  status: SettlementStatus;
  settledReturn: number;
}

export interface StreakSummary {
  kind: 'Win' | 'Lost' | null;
  length: number;
}

export interface EquityPoint {
  dateIso: string;
  /** Cumulative net P&L after this slip. */
  value: number;
}

export interface SlipAnalytics {
  total: number;
  won: number;
  lost: number;
  voided: number;
  live: number;
  pending: number;
  open: number;
  decided: number;
  /** Stake on Win/Lost slips. The ROI denominator. */
  settledStake: number;
  /** Stake on void slips, returned in full. */
  voidedStake: number;
  /** Stake on every saved slip, including open ones. */
  totalStaked: number;
  /** Gross settled returns (winning payouts plus returned void stakes). */
  returns: number;
  netPnl: number;
  /** Sum of profitable settled slips. */
  grossProfit: number;
  /** Sum of losing stake, as a positive number. */
  grossLoss: number;
  /** Gross profit ÷ gross loss, or null when nothing has lost. */
  profitFactor: number | null;
  /** Percent, or null until a slip has won or lost. */
  roi: number | null;
  /** Win share of decided slips, percent, or null when none are decided. */
  hitRate: number | null;
  voidRate: number;
  avgStake: number;
  avgOdds: number;
  avgLegs: number;
  avgWinningOdds: number | null;
  avgLosingOdds: number | null;
  biggestWin: number;
  biggestLoss: number;
  longestWinStreak: number;
  longestLossStreak: number;
  currentStreak: StreakSummary;
  /** Starts at zero, one point per settled slip, oldest first. */
  equity: EquityPoint[];
}

export interface DayPerformance {
  dateIso: string;
  slips: number;
  won: number;
  lost: number;
  voided: number;
  open: number;
  settledStake: number;
  /** Void stake, returned in full; kept out of the ROI denominator. */
  voidedStake: number;
  returns: number;
  netPnl: number;
  roi: number | null;
}

export interface OddsBandPerformance {
  id: string;
  label: string;
  slips: number;
  won: number;
  lost: number;
  voided: number;
  settledStake: number;
  /** Void stake, returned in full; kept out of the ROI denominator. */
  voidedStake: number;
  returns: number;
  netPnl: number;
  roi: number | null;
  hitRate: number | null;
}

export interface LegSettlementInput {
  marketType: MarketType;
  status: SettlementStatus;
}

export interface MarketTypePerformance {
  marketType: MarketType;
  legs: number;
  won: number;
  lost: number;
  voided: number;
  open: number;
  hitRate: number | null;
}

export const ODDS_BANDS: ReadonlyArray<{
  id: string;
  label: string;
  min: number;
  max: number;
}> = [
  { id: 'under-5', label: 'Under 5.00', min: 0, max: 5 },
  { id: '5-10', label: '5.00 – 9.99', min: 5, max: 10 },
  { id: '10-20', label: '10.00 – 19.99', min: 10, max: 20 },
  { id: 'over-20', label: '20.00+', min: 20, max: Number.POSITIVE_INFINITY },
];

const round2 = (value: number): number => Math.round(value * 100) / 100;
const round1 = (value: number): number => Math.round(value * 10) / 10;

const isOpenStatus = (status: SettlementStatus): boolean =>
  status === 'Pending' || status === 'Live';

const isDecidedStatus = (status: SettlementStatus): boolean =>
  status === 'Win' || status === 'Lost';

/** Net P&L on one slip. Open slips contribute nothing. */
export function slipNetPnl(row: SlipSettlementInput): number {
  if (row.status === 'Win') return round2(row.settledReturn - row.stake);
  if (row.status === 'Lost') return -row.stake;
  return 0;
}

const byCreatedAt = (a: SlipSettlementInput, b: SlipSettlementInput): number =>
  a.createdAt.localeCompare(b.createdAt);

export function buildSlipAnalytics(rows: SlipSettlementInput[]): SlipAnalytics {
  let won = 0;
  let lost = 0;
  let voided = 0;
  let live = 0;
  let pending = 0;
  let settledStake = 0;
  let voidedStake = 0;
  let totalStaked = 0;
  let returns = 0;
  let totalLegs = 0;
  let winningOdds = 0;
  let losingOdds = 0;
  let biggestWin = 0;
  let biggestLoss = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  for (const row of rows) {
    totalStaked += row.stake;
    totalLegs += row.legCount;

    switch (row.status) {
      case 'Win':
        won += 1;
        settledStake += row.stake;
        returns += row.settledReturn;
        winningOdds += row.effectiveOdds;
        biggestWin = Math.max(biggestWin, row.settledReturn - row.stake);
        if (row.settledReturn - row.stake > 0) {
          grossProfit += row.settledReturn - row.stake;
        } else {
          grossLoss += row.stake - row.settledReturn;
        }
        break;
      case 'Lost':
        lost += 1;
        settledStake += row.stake;
        losingOdds += row.effectiveOdds;
        biggestLoss = Math.max(biggestLoss, row.stake);
        grossLoss += row.stake;
        break;
      case 'Void':
        voided += 1;
        voidedStake += row.stake;
        returns += row.settledReturn;
        break;
      case 'Live':
        live += 1;
        break;
      default:
        pending += 1;
    }
  }

  const decided = won + lost;
  const settled = decided + voided;
  const netPnl = round2(returns - (settledStake + voidedStake));

  const decidedRows = rows
    .filter((row) => isDecidedStatus(row.status))
    .sort(byCreatedAt);

  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let current: StreakSummary = { kind: null, length: 0 };
  for (const row of decidedRows) {
    const kind = row.status === 'Win' ? 'Win' : 'Lost';
    if (current.kind === kind) {
      current = { kind, length: current.length + 1 };
    } else {
      current = { kind, length: 1 };
    }
    if (kind === 'Win') {
      longestWinStreak = Math.max(longestWinStreak, current.length);
    } else {
      longestLossStreak = Math.max(longestLossStreak, current.length);
    }
  }

  const equity: EquityPoint[] = [{ dateIso: '', value: 0 }];
  let running = 0;
  for (const row of [...rows]
    .filter((entry) => !isOpenStatus(entry.status))
    .sort(byCreatedAt)) {
    running = round2(running + slipNetPnl(row));
    equity.push({ dateIso: row.dateIso, value: running });
  }

  return {
    total: rows.length,
    won,
    lost,
    voided,
    live,
    pending,
    open: live + pending,
    decided,
    settledStake: round2(settledStake),
    voidedStake: round2(voidedStake),
    totalStaked: round2(totalStaked),
    returns: round2(returns),
    netPnl,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor:
      grossLoss > 0 ? round2(grossProfit / grossLoss) : null,
    roi: settledStake > 0 ? round1((netPnl / settledStake) * 100) : null,
    hitRate: decided > 0 ? round1((won / decided) * 100) : null,
    voidRate: settled > 0 ? round1((voided / settled) * 100) : 0,
    avgStake: decided > 0 ? round2(settledStake / decided) : 0,
    avgOdds:
      decided > 0 ? round2((winningOdds + losingOdds) / decided) : 0,
    avgLegs: rows.length > 0 ? round2(totalLegs / rows.length) : 0,
    avgWinningOdds: won > 0 ? round2(winningOdds / won) : null,
    avgLosingOdds: lost > 0 ? round2(losingOdds / lost) : null,
    biggestWin: round2(biggestWin),
    biggestLoss: round2(biggestLoss),
    longestWinStreak,
    longestLossStreak,
    currentStreak: current,
    equity,
  };
}

export function buildDailyPerformance(
  rows: SlipSettlementInput[]
): DayPerformance[] {
  const days = new Map<string, DayPerformance>();

  for (const row of rows) {
    const day = days.get(row.dateIso) ?? {
      dateIso: row.dateIso,
      slips: 0,
      won: 0,
      lost: 0,
      voided: 0,
      open: 0,
      settledStake: 0,
      voidedStake: 0,
      returns: 0,
      netPnl: 0,
      roi: null,
    };

    day.slips += 1;
    if (row.status === 'Win') {
      day.won += 1;
      day.settledStake += row.stake;
      day.returns += row.settledReturn;
    } else if (row.status === 'Lost') {
      day.lost += 1;
      day.settledStake += row.stake;
    } else if (row.status === 'Void') {
      day.voided += 1;
      day.voidedStake += row.stake;
      day.returns += row.settledReturn;
    } else {
      day.open += 1;
    }

    days.set(row.dateIso, day);
  }

  return [...days.values()]
    .map((day) => {
      day.settledStake = round2(day.settledStake);
      day.voidedStake = round2(day.voidedStake);
      day.returns = round2(day.returns);
      day.netPnl = round2(
        day.returns - (day.settledStake + day.voidedStake)
      );
      day.roi =
        day.settledStake > 0
          ? round1((day.netPnl / day.settledStake) * 100)
          : null;
      return day;
    })
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso));
}

export function buildOddsBandPerformance(
  rows: SlipSettlementInput[]
): OddsBandPerformance[] {
  return ODDS_BANDS.map((band) => {
    let slips = 0;
    let won = 0;
    let lost = 0;
    let voided = 0;
    let settledStake = 0;
    let voidedStake = 0;
    let returns = 0;

    for (const row of rows) {
      if (isOpenStatus(row.status)) continue;
      const odds = row.effectiveOdds;
      if (odds < band.min || odds >= band.max) continue;

      slips += 1;
      if (row.status === 'Win') {
        won += 1;
        settledStake += row.stake;
        returns += row.settledReturn;
      } else if (row.status === 'Lost') {
        lost += 1;
        settledStake += row.stake;
      } else {
        voided += 1;
        voidedStake += row.stake;
        returns += row.settledReturn;
      }
    }

    const decided = won + lost;
    const netPnl = round2(
      returns - (settledStake + voidedStake)
    );

    return {
      id: band.id,
      label: band.label,
      slips,
      won,
      lost,
      voided,
      settledStake: round2(settledStake),
      voidedStake: round2(voidedStake),
      returns: round2(returns),
      netPnl,
      roi:
        settledStake > 0 ? round1((netPnl / settledStake) * 100) : null,
      hitRate: decided > 0 ? round1((won / decided) * 100) : null,
    };
  });
}

export function buildMarketTypePerformance(
  rows: LegSettlementInput[]
): MarketTypePerformance[] {
  const types = new Map<MarketType, MarketTypePerformance>();

  for (const row of rows) {
    const entry = types.get(row.marketType) ?? {
      marketType: row.marketType,
      legs: 0,
      won: 0,
      lost: 0,
      voided: 0,
      open: 0,
      hitRate: null,
    };

    entry.legs += 1;
    if (row.status === 'Win') entry.won += 1;
    else if (row.status === 'Lost') entry.lost += 1;
    else if (row.status === 'Void') entry.voided += 1;
    else entry.open += 1;

    types.set(row.marketType, entry);
  }

  return [...types.values()]
    .map((entry) => {
      const decided = entry.won + entry.lost;
      entry.hitRate =
        decided > 0 ? round1((entry.won / decided) * 100) : null;
      return entry;
    })
    .sort((a, b) => b.legs - a.legs);
}
