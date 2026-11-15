export type MarketType =
  | '1X2'
  | 'Double Chance'
  | 'Goals'
  | 'BTTS'
  | 'Draw No Bet';

export type AccaStrategy = 'balanced' | 'favorites' | 'goals' | 'high-yield';

export type SettlementStatus = 'Win' | 'Lost' | 'Void' | 'Live' | 'Pending';

export interface MarketOption {
  id: string;
  marketType: MarketType;
  label: string;
  odds: number;
  impliedProbability: number;
  rationale: string;
}

export interface Fixture {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  country: string;
  matchDate: string;
  matchDateIso: string;
  kickoffTime: string;
  kickoffTimestamp?: number;
  awaitingResult?: boolean;
  status: 'Scheduled' | 'Live' | 'Finished' | 'Void';
  statusShort?: string;
  statusLong?: string;
  score?: {
    home: number | null;
    away: number | null;
    halftimeHome?: number | null;
    halftimeAway?: number | null;
  };
  venue: string;
  formHome: string;
  formAway: string;
  tacticalSummary: string;
  recommendedPickId: string;
  bookmakerName?: string;
  hasLiveOdds: boolean;
  markets: MarketOption[];
}

export interface AccaLeg {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  matchDate?: string;
  kickoffTime: string;
  marketId: string;
  marketLabel: string;
  marketType: MarketType;
  odds: number;
  impliedProbability: number;
  rationale: string;
  locked?: boolean;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface RecommendedPickRef {
  fixtureId: string;
  marketId: string;
}

export interface DailySlateResponse {
  date: string;
  displayDate: string;
  timezoneLabel: string;
  dataProvider: string;
  strategy: AccaStrategy;
  minOdds: number;
  strategyName: string;
  strategySummary: string;
  fixtures: Fixture[];
  recommendedLegIds: RecommendedPickRef[];
  sources: GroundingSource[];
  cachedAt: string;
}

export interface SavedTicket {
  id: string;
  name: string;
  createdAt: string;
  date: string;
  stake: number;
  totalOdds: number;
  legs: AccaLeg[];
}

export interface DeepAnalysisResponse {
  fixtureId: string;
  summary: string;
  keyFactors: string[];
  teamNews: string;
  bestAngle: string;
  formHome?: string;
  formAway?: string;
  sources: GroundingSource[];
}
