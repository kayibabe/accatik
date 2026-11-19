import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  analyzeFixture,
  getMatchDetail,
  getTodayFixtures,
  refreshResults,
  parseMatchDetailRequest,
  parseMaxLegs,
  parseResultFixtureIds,
  parseTargetOdds,
  DEFAULT_MAX_LEGS,
  DEFAULT_TARGET_ODDS,
  MAX_LEG_LIMIT,
  MAX_TARGET_ODDS,
  MIN_TARGET_ODDS,
} from '../api.ts';

export {
  DEFAULT_MAX_LEGS,
  DEFAULT_TARGET_ODDS,
  MAX_LEG_LIMIT,
  MAX_TARGET_ODDS,
  MIN_TARGET_ODDS,
  parseMatchDetailRequest,
  parseMaxLegs,
  parseResultFixtureIds,
  parseTargetOdds,
} from '../api.ts';
export type { MatchDetailRequest } from '../api.ts';

/** Express adapter for the shared fixture API handlers. */
export const fixturesRouter = Router();

fixturesRouter.post('/today', async (req: Request, res: Response) => {
  const result = await getTodayFixtures(req.body);
  res.status(result.status).json(result.body);
});

fixturesRouter.post('/detail', async (req: Request, res: Response) => {
  const result = await getMatchDetail(req.body);
  res.status(result.status).json(result.body);
});

fixturesRouter.post('/results', async (req: Request, res: Response) => {
  const result = await refreshResults(req.body);
  res.status(result.status).json(result.body);
});

fixturesRouter.post('/analyze', async (req: Request, res: Response) => {
  const result = await analyzeFixture(req.body);
  res.status(result.status).json(result.body);
});
