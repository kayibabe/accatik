import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SettlementStatus } from '../../src/types/fixtures.ts';
import {
  getLedgerSummary,
  listLedgerTickets,
  settleLedgerFromArchives,
} from '../lib/ticketLedger.ts';

const STATUSES: SettlementStatus[] = [
  'Win',
  'Lost',
  'Void',
  'Live',
  'Pending',
];

/**
 * Read-only shadow ledger API.
 *
 * The ledger belongs to the server, not to a browser profile, so it survives
 * cache clears and reports the engine's real record rather than the subset of
 * slips a user happened to save.
 */
export const ledgerRouter = Router();

ledgerRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    res.json(await getLedgerSummary());
  } catch (error) {
    console.error('Error reading ledger summary:', error);
    res.status(500).json({ error: 'Could not read the shadow ticket ledger.' });
  }
});

ledgerRouter.get('/tickets', async (req: Request, res: Response) => {
  try {
    const dateIso =
      typeof req.query.dateIso === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.dateIso)
        ? req.query.dateIso
        : undefined;
    const status =
      typeof req.query.status === 'string' &&
      STATUSES.includes(req.query.status as SettlementStatus)
        ? (req.query.status as SettlementStatus)
        : undefined;
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    res.json({
      tickets: await listLedgerTickets({ dateIso, status, limit }),
    });
  } catch (error) {
    console.error('Error reading ledger tickets:', error);
    res.status(500).json({ error: 'Could not read ledger tickets.' });
  }
});

ledgerRouter.post('/settle', async (req: Request, res: Response) => {
  try {
    const dateIso =
      typeof req.body?.dateIso === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.body.dateIso)
        ? req.body.dateIso
        : undefined;

    const changed = await settleLedgerFromArchives(dateIso);
    res.json({ changed, summary: await getLedgerSummary() });
  } catch (error) {
    console.error('Error settling ledger:', error);
    res.status(500).json({ error: 'Could not settle the shadow ledger.' });
  }
});
