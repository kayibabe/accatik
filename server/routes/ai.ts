import { Router } from 'express';
import type { Request, Response } from 'express';
import { getAiAccumulator, getAiBriefing } from '../api.ts';

/** Express adapter for the free AI analytics desk. */
export const aiRouter = Router();

aiRouter.post('/briefing', async (req: Request, res: Response) => {
  const result = await getAiBriefing(req.body);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.status(result.status).json(result.body);
});

aiRouter.post('/accumulator', async (req: Request, res: Response) => {
  const result = await getAiAccumulator(req.body);
  res.status(result.status).json(result.body);
});
