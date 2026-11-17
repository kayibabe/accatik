import type { AccaStrategy } from '../types/fixtures.ts';

export const STRATEGY_LABELS: Record<AccaStrategy, string> = {
  balanced: 'Balanced',
  favorites: 'Favorites',
  goals: 'Goals',
  'high-yield': 'High-Yield',
  probability: 'Most Likely',
};

export function isAccaStrategy(value: unknown): value is AccaStrategy {
  return (
    value === 'balanced' ||
    value === 'favorites' ||
    value === 'goals' ||
    value === 'high-yield' ||
    value === 'probability'
  );
}

export function describeStrategy(
  strategy: AccaStrategy,
  minOdds: number
): { title: string; summary: string } {
  const target = minOdds.toFixed(2);

  switch (strategy) {
    case 'favorites':
      return {
        title: `Today's ${target}+ High-Probability Favorites Acca`,
        summary: `Built from live API-Football bookmaker odds favoring low-variance winners, Double Chance 1X/X2, and Over 1.5 Goal lines to reach ${target}+ combined odds.`,
      };
    case 'goals':
      return {
        title: `Today's ${target}+ Goals & BTTS Acca`,
        summary: `Targets Over 1.5, Over 2.5, and Both Teams to Score lines across today's scheduled matches to surpass ${target}+ combined odds.`,
      };
    case 'high-yield':
      return {
        title: `Today's ${target}+ High-Yield Value Acca`,
        summary: `Selects higher-priced 1X2 and Over 2.5 angles across today's top competitions to exceed ${target}+ odds in fewer legs.`,
      };
    case 'probability':
      return {
        title: `Today's ${target}+ Most Likely Acca`,
        summary: `Ranks every priced outcome by margin-adjusted win probability and takes the highest first, adding legs until ${target}+ combined odds is reached.`,
      };
    case 'balanced':
    default:
      return {
        title: `Today's ${target}+ Balanced Acca`,
        summary: `Combines top-tier match winners, Double Chance coverage, and goal markets from today's live bookmaker slate to build ${target}+ combined odds.`,
      };
  }
}
