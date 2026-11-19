export type UserRole = 'free' | 'pro' | 'admin';

/** The signed-in user as returned by Appwrite Auth. */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

/** Server-owned profile. Role is the source of truth for authorization. */
export interface UserProfile {
  userId: string;
  role: UserRole;
  displayName: string;
  localMigrated: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Preferences synced across devices for a signed-in user. */
export interface UserPreferences {
  filtersJson: string;
  slateJson: string;
  updatedAt: string;
}

/** Response returned by GET /api/account/me. */
export interface AccountResponse {
  user: AppUser;
  profile: UserProfile;
}
