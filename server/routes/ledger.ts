import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getLedgerSummaryResult,
  listLedgerTicketsResult,
  settleLedger,
} from '../api.ts';

/** Express adapter for the shared ledger API handlers. */
export const ledgerRouter = Router();

ledgerRouter.get('/summary', async (req: Request, res: Response) => {
  const result = await getLedgerSummaryResult(req.query);
  res.status(result.status).json(result.body);
});

ledgerRouter.get('/tickets', async (req: Request, res: Response) => {
  const result = await listLedgerTicketsResult(req.query);
  res.status(result.status).json(result.body);
});

ledgerRouter.post('/settle', async (req: Request, res: Response) => {
  const result = await settleLedger(req.body);
  res.status(result.status).json(result.body);
});
