import type { AppUser, UserProfile } from '../types/user.ts';

/**
 * TEMPORARY development auth bypass.
 *
 * Set VITE_AUTH_DISABLED=true to skip Appwrite login entirely. Every visitor is
 * then treated as the developer identity below, so the full workbench (slates,
 * analytics, ROI, saved slips, admin) is reachable without credentials.
 *
 * This is a development escape hatch, not a feature. It must stay disabled in
 * production. Remove this module and its usages once login is re-enabled.
 */
const clientEnv =
  (import.meta as { env?: Record<string, string | undefined> }).env ?? {};

export const AUTH_DISABLED =
  String(clientEnv.VITE_AUTH_DISABLED ?? '').trim().toLowerCase() === 'true';

export const DEV_USER: AppUser = {
  id: 'dev-user',
  email: 'dev@localhost',
  name: 'Development User',
  emailVerified: true,
};

export const DEV_PROFILE: UserProfile = {
  userId: 'dev-user',
  role: 'admin',
  displayName: 'Development User',
  localMigrated: false,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};
