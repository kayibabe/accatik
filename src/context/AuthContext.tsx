import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  completeVerification,
  currentUser,
  requestPasswordReset,
  signIn as appwriteSignIn,
  signOut as appwriteSignOut,
  signUp as appwriteSignUp,
  type Credentials,
} from '../lib/appwrite.ts';
import type { AccountResponse, AppUser, UserProfile } from '../types/user.ts';
import { apiFetch } from '../utils/api.ts';

interface AuthValue {
  user: AppUser | null;
  profile: UserProfile | null;
  loading: boolean;
  authOpen: boolean;
  notice: string | null;
  openAuth: () => void;
  closeAuth: () => void;
  dismissNotice: () => void;
  refresh: () => Promise<void>;
  signIn: (credentials: Credentials) => Promise<void>;
  signUp: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
  requestReset: (email: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/** Session state and the server-owned profile for the current user. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const current = await currentUser();
    setUser(current);
    if (!current) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const account = await apiFetch<AccountResponse>('/api/account/me');
      setProfile(account.profile);
    } catch {
      setUser(null);
      setProfile(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Appwrite redirects email verification links back to /verify with a
  // userId/secret pair. The static fallback still loads this SPA.
  useEffect(() => {
    if (window.location.pathname !== '/verify') return;
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const secret = params.get('secret');
    if (!userId || !secret) return;

    void completeVerification(userId, secret)
      .then(() => {
        setNotice('Email verified. Thanks!');
        window.history.replaceState({}, '', '/');
        return refresh();
      })
      .catch(() => {
        setNotice('That verification link is invalid or has expired.');
        window.history.replaceState({}, '', '/');
      });
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      loading,
      authOpen,
      notice,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      dismissNotice: () => setNotice(null),
      refresh,
      signIn: async (credentials) => {
        await appwriteSignIn(credentials);
        await refresh();
        setAuthOpen(false);
      },
      signUp: async (credentials) => {
        await appwriteSignUp(credentials);
        await refresh();
        setAuthOpen(false);
        setNotice(
          'Account created. Check your inbox to verify your email address.'
        );
      },
      signOut: async () => {
        await appwriteSignOut();
        setUser(null);
        setProfile(null);
      },
      requestReset: requestPasswordReset,
    }),
    [user, profile, loading, authOpen, notice, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
