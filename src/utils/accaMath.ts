import type {
  AccaLeg,
  Fixture,
  MarketOption,
  MarketType,
  RecommendedPickRef,
  SettlementStatus,
} from '../types/fixtures.ts';

export function calculateTotalOdds(legs: AccaLeg[]): number {
  if (legs.length === 0) return 0;
  const product = legs.reduce((acc, leg) => acc * leg.odds, 1);
  return Math.round(product * 100) / 100;
}

export function calculateImpliedProbability(odds: number): number {
  if (!odds || odds <= 1) return 0;
  return Math.round((1 / odds) * 1000) / 10;
}

export function calculateCombinedImpliedProbability(legs: AccaLeg[]): number {
  if (legs.length === 0) return 0;
  const totalOdds = legs.reduce((acc, leg) => acc * leg.odds, 1);
  if (totalOdds <= 0) return 0;
  return Math.round((1 / totalOdds) * 1000) / 10;
}

export function calculatePotentialReturn(stake: number, totalOdds: number): number {
  if (stake <= 0 || totalOdds <= 0) return 0;
  return Math.round(stake * totalOdds * 100) / 100;
}

export function formatMwk(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `MK ${safe.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function evaluateMarketSettlement(
  fixture: Fixture,
  market: Pick<MarketOption, 'id' | 'label' | 'marketType'>
): SettlementStatus {
  if (fixture.status === 'Void') {
    return 'Void';
  }
  if (fixture.status === 'Scheduled') {
    return 'Pending';
  }
  if (fixture.status === 'Live') {
    return 'Live';
  }

  const home = fixture.score?.home;
  const away = fixture.score?.away;
  if (home === null || home === undefined || away === null || away === undefined) {
    return 'Pending';
  }

  const totalGoals = home + away;
  const id = market.id.toLowerCase();
  const label = market.label.toLowerCase();
  const type: MarketType = market.marketType;

  if (type === '1X2') {
    if (id.endsWith('1x2-h')) return home > away ? 'Win' : 'Lost';
    if (id.endsWith('1x2-d') || label === 'draw') return home === away ? 'Win' : 'Lost';
    if (id.endsWith('1x2-a')) return away > home ? 'Win' : 'Lost';
    if (label.includes(fixture.homeTeam.toLowerCase())) {
      return home > away ? 'Win' : 'Lost';
    }
    if (label.includes(fixture.awayTeam.toLowerCase())) {
      return away > home ? 'Win' : 'Lost';
    }
  }

  if (type === 'Double Chance') {
    if (id.endsWith('dc-1x') || label.startsWith('1x')) {
      return home >= away ? 'Win' : 'Lost';
    }
    if (id.endsWith('dc-x2') || label.startsWith('x2')) {
      return away >= home ? 'Win' : 'Lost';
    }
    if (id.endsWith('dc-12') || label.startsWith('12')) {
      return home !== away ? 'Win' : 'Lost';
    }
  }

  if (type === 'Goals') {
    const overMatch = label.match(/over\s+(\d+(?:\.\d+)?)/i);
    if (overMatch) {
      return totalGoals > Number(overMatch[1]) ? 'Win' : 'Lost';
    }
    const underMatch = label.match(/under\s+(\d+(?:\.\d+)?)/i);
    if (underMatch) {
      return totalGoals < Number(underMatch[1]) ? 'Win' : 'Lost';
    }
  }

  if (type === 'BTTS') {
    if (label.includes('no')) {
      return home === 0 || away === 0 ? 'Win' : 'Lost';
    }
    return home >= 1 && away >= 1 ? 'Win' : 'Lost';
  }

  if (type === 'Draw No Bet') {
    if (home === away) return 'Void';
    if (id.endsWith('dnb-h') || label.includes(fixture.homeTeam.toLowerCase())) {
      return home > away ? 'Win' : 'Lost';
    }
    if (id.endsWith('dnb-a') || label.includes(fixture.awayTeam.toLowerCase())) {
      return away > home ? 'Win' : 'Lost';
    }
  }

  return 'Pending';
}

export function getFixtureMatchResultSummary(fixture: Fixture): string {
  if (fixture.status === 'Void') {
    return fixture.statusLong ? `${fixture.statusLong} (Void)` : 'Void';
  }
  const h = fixture.score?.home;
  const a = fixture.score?.away;
  if (h === null || h === undefined || a === null || a === undefined) {
    if (fixture.status === 'Scheduled') {
      return fixture.awaitingResult
        ? 'Kickoff passed · Score unconfirmed by feed'
        : 'Scheduled';
    }
    return fixture.statusShort || fixture.status;
  }
  if (fixture.status === 'Live') {
    return `${h} - ${a} (${fixture.statusShort || 'Live'})`;
  }
  if (h > a) return `${h} - ${a} (${fixture.homeTeam} Win)`;
  if (a > h) return `${h} - ${a} (${fixture.awayTeam} Win)`;
  return `${h} - ${a} (Draw)`;
}

export interface TicketSettlementSummary {
  status: SettlementStatus;
  effectiveOdds: number;
  settledReturn: number;
  winCount: number;
  lostCount: number;
  voidCount: number;
  pendingCount: number;
  liveCount: number;
}

export function evaluateTicketSettlement(
  legs: AccaLeg[],
  fixtures: Fixture[],
  stake: number
): TicketSettlementSummary {
  if (legs.length === 0) {
    return {
      status: 'Pending',
      effectiveOdds: 0,
      settledReturn: 0,
      winCount: 0,
      lostCount: 0,
      voidCount: 0,
      pendingCount: 0,
      liveCount: 0,
    };
  }

  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));
  let winCount = 0;
  let lostCount = 0;
  let voidCount = 0;
  let pendingCount = 0;
  let liveCount = 0;
  let effectiveOdds = 1;

  for (const leg of legs) {
    const fixture = fixtureMap.get(leg.fixtureId);
    if (!fixture) {
      pendingCount++;
      effectiveOdds *= leg.odds;
      continue;
    }

    const legStatus = evaluateMarketSettlement(fixture, {
      id: leg.marketId,
      label: leg.marketLabel,
      marketType: leg.marketType,
    });

    if (legStatus === 'Win') {
      winCount++;
      effectiveOdds *= leg.odds;
    } else if (legStatus === 'Lost') {
      lostCount++;
      effectiveOdds *= leg.odds;
    } else if (legStatus === 'Void') {
      voidCount++;
      // Void leg settles at 1.00 odds
    } else if (legStatus === 'Live') {
      liveCount++;
      effectiveOdds *= leg.odds;
    } else {
      pendingCount++;
      effectiveOdds *= leg.odds;
    }
  }

  const roundedEffectiveOdds = Math.round(effectiveOdds * 100) / 100;

  let status: SettlementStatus = 'Pending';
  let settledReturn = calculatePotentialReturn(stake, roundedEffectiveOdds);

  if (lostCount > 0) {
    status = 'Lost';
    settledReturn = 0;
  } else if (liveCount > 0) {
    status = 'Live';
  } else if (pendingCount > 0) {
    status = 'Pending';
  } else if (voidCount === legs.length) {
    status = 'Void';
    settledReturn = stake;
  } else if (winCount > 0) {
    status = 'Win';
  }

  return {
    status,
    effectiveOdds: roundedEffectiveOdds,
    settledReturn,
    winCount,
    lostCount,
    voidCount,
    pendingCount,
    liveCount,
  };
}

export function buildLegsFromRefs(
  fixtures: Fixture[],
  refs: RecommendedPickRef[]
): AccaLeg[] {
  const legs: AccaLeg[] = [];
  const seenFixtures = new Set<string>();

  for (const ref of refs) {
    if (seenFixtures.has(ref.fixtureId)) continue;
    const fixture = fixtures.find((f) => f.id === ref.fixtureId);
    if (!fixture) continue;
    const market =
      fixture.markets.find((m) => m.id === ref.marketId) ??
      fixture.markets.find((m) => m.id === fixture.recommendedPickId) ??
      fixture.markets[0];
    if (!market) continue;

    seenFixtures.add(fixture.id);
    legs.push({
      fixtureId: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      competition: fixture.competition,
      matchDate: fixture.matchDate,
      kickoffTime: fixture.kickoffTime,
      marketId: market.id,
      marketLabel: market.label,
      marketType: market.marketType,
      odds: market.odds,
      impliedProbability:
        market.impliedProbability || calculateImpliedProbability(market.odds),
      fairProbability: market.fairProbability,
      rationale: market.rationale,
      bookmaker: market.bookmaker,
      locked: false,
    });
  }

  return legs;
}

export function formatTicketForCopy(
  legs: AccaLeg[],
  stake: number,
  displayDate: string,
  fixtures: Fixture[] = []
): string {
  const totalOdds = calculateTotalOdds(legs);
  const potentialReturn = calculatePotentialReturn(stake, totalOdds);
  const fixtureMap = new Map(fixtures.map((f) => [f.id, f]));

  const lines = [
    `MATCHSLIP ACCUMULATOR — ${displayDate}`,
    `Selections: ${legs.length} Legs | Total Odds: ${totalOdds.toFixed(2)}`,
    `Stake: ${formatMwk(stake)} | Est. Return: ${formatMwk(potentialReturn)}`,
    `----------------------------------------`,
    ...legs.map((leg, idx) => {
      const fixture = fixtureMap.get(leg.fixtureId);
      const dateStr = leg.matchDate ? `${leg.matchDate} · ` : '';
      const statusSuffix = fixture
        ? (() => {
            const st = evaluateMarketSettlement(fixture, {
              id: leg.marketId,
              label: leg.marketLabel,
              marketType: leg.marketType,
            });
            if (st === 'Win' || st === 'Lost' || st === 'Void') {
              const sc =
                fixture.score?.home !== null &&
                fixture.score?.home !== undefined &&
                fixture.score?.away !== null &&
                fixture.score?.away !== undefined
                  ? ` [${fixture.score.home}-${fixture.score.away}]`
                  : '';
              return `${sc} — ${st.toUpperCase()}`;
            }
            return '';
          })()
        : '';
      return `${idx + 1}. ${leg.homeTeam} vs ${leg.awayTeam} (${dateStr}${leg.kickoffTime}) — ${leg.marketLabel} @ ${leg.odds.toFixed(2)}${statusSuffix}`;
    }),
  ];

  return lines.join('\n');
}
