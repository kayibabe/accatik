import type { AppUser, UserProfile } from '../types/user.ts';

/**
 * Local-only identity.
 *
 * Until the app is ready for deployment every visitor uses this single local
 * profile with full access. There is no sign-in screen and no account service:
 * saved slips and preferences live in the browser, while slates, the ledger and
 * research data live in the JSON files under `data/`.
 */
export const LOCAL_USER: AppUser = {
  id: 'local-user',
  email: 'local@localhost',
  name: 'Local User',
  emailVerified: true,
};

export const LOCAL_PROFILE: UserProfile = {
  userId: LOCAL_USER.id,
  role: 'admin',
  displayName: LOCAL_USER.name,
  localMigrated: false,
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
};
