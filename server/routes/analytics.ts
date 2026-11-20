import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  buildRoiAccaTicket,
  getPickAnalytics,
  getQualifiedPicks,
  getRoiRegistry,
  runRoiPromotion,
} from '../api.ts';

/** Express adapter for the shared pick-analytics API handler. */
export const analyticsRouter = Router();

analyticsRouter.post('/picks', async (req: Request, res: Response) => {
  const result = await getPickAnalytics(req.body);
  res.status(result.status).json(result.body);
});

analyticsRouter.post('/roi-registry', async (req: Request, res: Response) => {
  const result = await getRoiRegistry(req.body);
  res.status(result.status).json(result.body);
});

analyticsRouter.post('/roi-promotion/run', async (req: Request, res: Response) => {
  const result = await runRoiPromotion(req.body);
  res.status(result.status).json(result.body);
});

analyticsRouter.post('/qualified-picks', async (req: Request, res: Response) => {
  const result = await getQualifiedPicks(req.body);
  res.status(result.status).json(result.body);
});

analyticsRouter.post('/roi-acca', async (req: Request, res: Response) => {
  const result = await buildRoiAccaTicket(req.body);
  res.status(result.status).json(result.body);
});
