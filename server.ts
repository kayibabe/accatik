import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveApiFootballBaseUrl, resolveApiFootballKey } from './server/lib/apiFootball.ts';
import { createRateLimiter } from './server/lib/cache.ts';
import { getTodayIsoDate } from './server/lib/time.ts';
import { fixturesRouter } from './server/routes/fixtures.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const RATE_LIMIT_PER_MIN = Number(process.env.API_RATE_LIMIT_PER_MIN) || 60;

/**
 * Which API-Football host requests will hit, so a custom gateway can be
 * confirmed from /api/health without leaking the full URL.
 */
function apiFootballHostLabel(): string {
  try {
    const custom = resolveApiFootballBaseUrl();
    if (!custom) return 'default';
    return new URL(custom).host;
  } catch {
    return 'invalid';
  }
}

async function createServer() {
  const app = express();
  app.disable('x-powered-by');
  // One proxy hop (AI Studio / Cloud Run) so req.ip is the real client.
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      date: getTodayIsoDate(),
      hasApiFootballKey: Boolean(resolveApiFootballKey()),
      apiFootballHost: apiFootballHostLabel(),
      rateLimitPerMinute: RATE_LIMIT_PER_MIN,
    });
  });

  app.use(
    '/api/fixtures',
    createRateLimiter({
      windowMs: 60_000,
      max: RATE_LIMIT_PER_MIN,
      message:
        'Too many slate requests from this device. Please wait a moment before refreshing again.',
    }),
    fixturesRouter
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Keep API failures JSON-shaped and avoid leaking stack traces.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const isBodyError = err instanceof SyntaxError && 'body' in (err as object);
    console.error('Unhandled request error:', err);
    res.status(isBodyError ? 400 : 500).json({
      error: isBodyError ? 'Malformed JSON request body.' : 'Internal server error.',
    });
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MatchSlip server listening on http://localhost:${PORT}`);
  });
}

createServer();
