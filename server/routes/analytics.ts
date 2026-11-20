import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPickAnalytics } from '../api.ts';

/** Express adapter for the shared pick-analytics API handler. */
export const analyticsRouter = Router();

analyticsRouter.post('/picks', async (req: Request, res: Response) => {
  const result = await getPickAnalytics(req.body);
  res.status(result.status).json(result.body);
});
