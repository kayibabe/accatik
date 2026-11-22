import type { ReactNode } from 'react';
import {
  Compass,
  NotebookPen,
  ShieldCheck,
} from 'lucide-react';
import type {
  AccaLeg,
  DeepAnalysisResponse,
  Fixture,
  MarketOption,
  MarketType,
  ModelProbabilities,
  PickRecordsResponse,
  SettlementStatus,
} from '../../types/fixtures.ts';
import type { ModelComparisonRow } from './types.ts';
import type { RecommendedAngle } from '../../utils/recommendedAngle.ts';
import type { AngleFilter } from '../../utils/slateFilters.ts';
import { marketProbability } from '../../utils/probability.ts';

export type StatusFilter = 'all' | 'odds' | 'upcoming' | 'played' | 'void';
export type SortMode = 'board' | 'probability';
export type InsightTone = 'angle' | 'cover' | 'note';

/** Shared by the angle, cover and note confidence chip rows. */
export const CONFIDENCE_FILTER_LABELS: Record<AngleFilter, string> = {
  all: 'All',
  High: 'High',
  Solid: 'Solid',
  Moderate: 'Moderate',
  Speculative: 'Speculative',
};

export function marketTypeShortLabel(type: MarketType): string {
  switch (type) {
    case 'Double Chance':
      return 'DC';
    case 'Draw No Bet':
      return 'DNB';
    default:
      return type;
  }
}

export function formatArchiveTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/** API-Football's model percentage for a 1X2 side, when it published one. */
export function modelPercentFor(
  market: MarketOption,
  probabilities?: ModelProbabilities
): number | null {
  if (!probabilities) return null;
  if (market.id.endsWith('1x2-h')) return probabilities.home;
  if (market.id.endsWith('1x2-d')) return probabilities.draw;
  if (market.id.endsWith('1x2-a')) return probabilities.away;
  return null;
}

/** De-vigged book vs API-Football model, side by side on the 1X2 trio. */
export function modelComparisonRows(fixture: Fixture): ModelComparisonRow[] {
  const probabilities = fixture.modelProbabilities;
  if (!probabilities) return [];

  const sides: Array<{ suffix: string; label: string; model: number | null }> = [
    { suffix: '1x2-h', label: 'Home', model: probabilities.home },
    { suffix: '1x2-d', label: 'Draw', model: probabilities.draw },
    { suffix: '1x2-a', label: 'Away', model: probabilities.away },
  ];

  const rows: ModelComparisonRow[] = [];
  for (const side of sides) {
    if (side.model === null) continue;
    const market = fixture.markets.find((m) => m.id.endsWith(side.suffix));
    if (!market) continue;
    rows.push({
      label: side.label,
      book: marketProbability(market),
      model: side.model,
    });
  }
  return rows;
}

export const INSIGHT_CARD_TONES = {
  angle: {
    surface: 'border-emerald-200 border-l-emerald-500 bg-emerald-50/70 text-emerald-900',
    icon: Compass,
    iconColor: 'text-emerald-600',
    labelColor: 'text-emerald-800',
  },
  cover: {
    surface: 'border-sky-200 border-l-sky-500 bg-sky-50/70 text-sky-900',
    icon: ShieldCheck,
    iconColor: 'text-sky-600',
    labelColor: 'text-sky-800',
  },
  note: {
    surface: 'border-violet-200 border-l-violet-500 bg-violet-50 text-violet-900',
    icon: NotebookPen,
    iconColor: 'text-violet-600',
    labelColor: 'text-violet-700',
  },
} as const;

export interface InsightCardProps {
  tone: InsightTone;
  label: string;
  children: ReactNode;
  action?: ReactNode;
}

/** Everything a fixture card needs, derived once by the board. */
export interface FixtureCardModel {
  fixture: Fixture;
  isExpanded: boolean;
  activeLeg: AccaLeg | null;
  displayMarkets: MarketOption[];
  tableMarkets: MarketOption[];
  deepAnalysis: DeepAnalysisResponse | undefined;
  isAnalyzing: boolean;
  analysisError: string | undefined;
  homeForm: string;
  awayForm: string;
  hasScore: boolean;
  hasHalftime: boolean;
  pickMarket: MarketOption | null;
  pickLabel: string;
  pickOutcome: SettlementStatus | null;
  resultSummary: string;
  angle: RecommendedAngle | null;
  angleOutcome: SettlementStatus | null;
  coverOutcome: SettlementStatus | null;
  analystNote: string | null;
  noteBand: string | null;
  noteOutcome: SettlementStatus | null;
  shortestPrice: MarketOption | null;
  isPreMatch: boolean;
  isSettled: boolean;
  modelEdge: { points: number; side: string } | null;
  showModelEdge: boolean;
  marketChipsActive: boolean;
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  clear: () => void;
}

export type { PickRecordsResponse, ModelComparisonRow };
