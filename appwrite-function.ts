import type { ApiResult } from './server/api.ts';
import {
  analyzeFixture,
  getLedgerSummaryResult,
  getMatchDetail,
  getPublicTodayFixtures,
  getTodayFixtures,
  getHealth,
  listLedgerTicketsResult,
  refreshResults,
  settleLedger,
} from './server/api.ts';
import { resolveAuth, type AuthContext } from './server/lib/auth.ts';
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
} from './server/userApi.ts';

/**
 * Appwrite Function entrypoint.
 *
 * The generated function domain forwards method, path, query, headers and body
 * to this handler. Paths mirror the Express API (`/api/...`) so the static site
 * can use one `VITE_API_BASE_URL` value in production and relative `/api`
 * locally.
 */

interface AppwriteRequest {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  bodyJson?: unknown;
  bodyText?: string;
}

interface AppwriteResponse {
  json(
    body: unknown,
    statusCode?: number,
    headers?: Record<string, string>
  ): unknown;
  text(
    body: string,
    statusCode?: number,
    headers?: Record<string, string>
  ): unknown;
}

interface AppwriteContext {
  req: AppwriteRequest;
  res: AppwriteResponse;
  log: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
}

interface HandlerInput {
  body: unknown;
  query: Record<string, unknown>;
  params: Record<string, string>;
  auth: AuthContext | null;
}

type Handler = (input: HandlerInput) => Promise<ApiResult<unknown>> | ApiResult<unknown>;

interface Route {
  method: string;
  pattern: string;
  handler: Handler;
  protected?: boolean;
}

const ALLOWED_ORIGINS = [
  'https://accatik.appwrite.network',
  'http://localhost:5173',
  'http://localhost:3000',
  ...String(process.env.APP_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];

function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-appwrite-user-jwt',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}

function errorResult(status: number, message: string): ApiResult<{ error: string }> {
  return { status, body: { error: message } };
}

function normalizePath(rawPath: string | undefined): string {
  let path = (rawPath || '/').split('?')[0].replace(/\/+$/, '');
  if (path === '/api' || path.startsWith('/api/')) {
    path = path.slice(4);
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function readBody(req: AppwriteRequest): unknown {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase())) {
    return undefined;
  }
  if (req.bodyJson !== undefined) return req.bodyJson;
  if (typeof req.bodyText === 'string' && req.bodyText.trim()) {
    try {
      return JSON.parse(req.bodyText);
    } catch {
      return null;
    }
  }
  return null;
}

const routes: Route[] = [
  { method: 'GET', pattern: '/health', handler: () => getHealth() },
  {
    method: 'GET',
    pattern: '/fixtures/public/today',
    handler: () => getPublicTodayFixtures(),
  },
  { method: 'POST', pattern: '/fixtures/today', handler: ({ body }) => getTodayFixtures(body) },
  { method: 'POST', pattern: '/fixtures/detail', handler: ({ body }) => getMatchDetail(body) },
  { method: 'POST', pattern: '/fixtures/results', handler: ({ body }) => refreshResults(body) },
  { method: 'POST', pattern: '/fixtures/analyze', handler: ({ body }) => analyzeFixture(body) },
  { method: 'GET', pattern: '/ledger/summary', handler: () => getLedgerSummaryResult() },
  { method: 'GET', pattern: '/ledger/tickets', handler: ({ query }) => listLedgerTicketsResult(query) },
  { method: 'POST', pattern: '/ledger/settle', handler: ({ body }) => settleLedger(body) },

  { method: 'GET', pattern: '/account/me', protected: true, handler: ({ auth }) => getMe(auth) },
  {
    method: 'POST',
    pattern: '/account/migrate-local',
    protected: true,
    handler: ({ auth, body }) => migrateLocalTickets(auth, body),
  },
  { method: 'GET', pattern: '/tickets', protected: true, handler: ({ auth }) => listTickets(auth) },
  {
    method: 'POST',
    pattern: '/tickets',
    protected: true,
    handler: ({ auth, body }) => saveTickets(auth, body),
  },
  {
    method: 'DELETE',
    pattern: '/tickets/:key',
    protected: true,
    handler: ({ auth, params }) => deleteTicket(auth, params.key),
  },
  {
    method: 'GET',
    pattern: '/preferences',
    protected: true,
    handler: ({ auth }) => getPreferences(auth),
  },
  {
    method: 'PUT',
    pattern: '/preferences',
    protected: true,
    handler: ({ auth, body }) => putPreferences(auth, body),
  },
  {
    method: 'GET',
    pattern: '/admin/users',
    protected: true,
    handler: ({ auth }) => adminListUsers(auth),
  },
  {
    method: 'POST',
    pattern: '/admin/roles',
    protected: true,
    handler: ({ auth, body }) => adminSetRole(auth, body),
  },
];

function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const patternParts = route.pattern.split('/').filter(Boolean);
    const pathParts = path.split('/').filter(Boolean);
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    const matched = patternParts.every((part, index) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(pathParts[index]);
        return true;
      }
      return part === pathParts[index];
    });
    if (matched) return { route, params };
  }
  return null;
}

export default async function main({
  req,
  res,
  log,
  error,
}: AppwriteContext): Promise<unknown> {
  const method = req.method.toUpperCase();
  const path = normalizePath(req.path);
  const headers = corsHeaders(
    typeof req.headers?.origin === 'string' ? req.headers.origin : undefined
  );

  if (method === 'OPTIONS') {
    return res.text('', 204, headers);
  }

  try {
    log(`[api] ${method} ${path}`);

    const matched = matchRoute(method, path);
    if (!matched) {
      const knownPaths = new Set(routes.map((route) => route.pattern));
      const result = knownPaths.has(path)
        ? errorResult(405, 'Method not allowed.')
        : errorResult(404, 'Unknown API endpoint.');
      return res.json(result.body, result.status, headers);
    }

    let auth: AuthContext | null = null;
    if (matched.route.protected) {
      auth = await resolveAuth(req.headers).catch((authError) => {
        error('[api] authentication failed', authError);
        return null;
      });
    }

    const result = await matched.route.handler({
      body: readBody(req),
      query: req.query ?? {},
      params: matched.params,
      auth,
    });
    return res.json(result.body, result.status, headers);
  } catch (err) {
    error(`[api] ${method} ${path} failed`, err);
    const result = errorResult(500, 'Internal server error.');
    return res.json(result.body, result.status, headers);
  }
}
