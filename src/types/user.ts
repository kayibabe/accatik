export type UserRole = 'free' | 'pro' | 'admin';

/** Local development identity used by every visitor while testing offline. */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** Local profile carrying the same shape the UI expects from an account. */
export interface UserProfile {
  userId: string;
  role: UserRole;
  displayName: string;
  localMigrated: boolean;
  createdAt: string;
  updatedAt: string;
}
