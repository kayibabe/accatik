import { Router } from 'express';
import type { Request, Response } from 'express';
import { resolveAuth } from '../lib/auth.ts';
import {
  adminListUsers,
  adminSetRole,
  deleteTicket,
  getMe,
  getPreferences,
  listTickets,
  migrateLocalTickets,
  putPreferences,
  saveTickets,
} from '../userApi.ts';

/** Express adapter for the shared per-user API handlers. */
export const userRouter = Router();

async function withAuth(
  req: Request,
  res: Response,
  handler: (
    auth: Awaited<ReturnType<typeof resolveAuth>>,
    req: Request
  ) => Promise<{ status: number; body: unknown }> | { status: number; body: unknown }
): Promise<void> {
  const auth = await resolveAuth(req.headers as Record<string, unknown>).catch(
    () => null
  );
  const result = await handler(auth, req);
  res.status(result.status).json(result.body);
}

userRouter.get('/account/me', (req, res) =>
  withAuth(req, res, (auth) => getMe(auth))
);

userRouter.post('/account/migrate-local', (req, res) =>
  withAuth(req, res, (auth) => migrateLocalTickets(auth, req.body))
);

userRouter.get('/tickets', (req, res) =>
  withAuth(req, res, (auth) => listTickets(auth))
);

userRouter.post('/tickets', (req, res) =>
  withAuth(req, res, (auth) => saveTickets(auth, req.body))
);

userRouter.delete('/tickets/:key', (req, res) =>
  withAuth(req, res, (auth) => deleteTicket(auth, req.params.key))
);

userRouter.get('/preferences', (req, res) =>
  withAuth(req, res, (auth) => getPreferences(auth))
);

userRouter.put('/preferences', (req, res) =>
  withAuth(req, res, (auth) => putPreferences(auth, req.body))
);

userRouter.get('/admin/users', (req, res) =>
  withAuth(req, res, (auth) => adminListUsers(auth))
);

userRouter.post('/admin/roles', (req, res) =>
  withAuth(req, res, (auth) => adminSetRole(auth, req.body))
);
