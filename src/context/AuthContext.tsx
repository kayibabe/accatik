import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearJwt,
  completeVerification,
  currentUser,
  requestPasswordReset,
  sendVerification as appwriteSendVerification,
  signIn as appwriteSignIn,
  signOut as appwriteSignOut,
  signUp as appwriteSignUp,
  type Credentials,
} from '../lib/appwrite.ts';
import type { AccountResponse, AppUser, UserProfile } from '../types/user.ts';
import { resolveProfileFailure } from './authRefresh.ts';
import { apiFetch, SessionExpiredError } from '../utils/api.ts';

interface AuthValue {
  user: AppUser | null;
  profile: UserProfile | null;
  loading: boolean;
  authOpen: boolean;
  notice: string | null;
  noticeTone: 'info' | 'error';
  openAuth: () => void;
  closeAuth: () => void;
  dismissNotice: () => void;
  refresh: () => Promise<void>;
  signIn: (credentials: Credentials) => Promise<void>;
  signUp: (credentials: Credentials) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerification: () => Promise<void>;
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
  const [noticeTone, setNoticeTone] = useState<'info' | 'error'>('info');
  // Sign-in can trigger a refresh while the initial mount refresh is still in
  // flight. Only the latest refresh may write auth state.
  const refreshGeneration = useRef(0);

  const showNotice = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setNotice(text);
    setNoticeTone(tone);
  }, []);

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const isCurrent = () => refreshGeneration.current === generation;

    const current = await currentUser();
    if (!isCurrent()) return;

    if (!current) {
      // A stale "signed in but..." notice must not linger on the guest view.
      setUser(null);
      setProfile(null);
      setNotice(null);
      setNoticeTone('info');
      setLoading(false);
      return;
    }
    setUser(current);
    setProfile(null);
    try {
      const account = await apiFetch<AccountResponse>('/api/account/me');
      if (!isCurrent()) return;
      setProfile(account.profile);
      // A previous load failure should not outlive a successful retry.
      setNotice(null);
      setNoticeTone('info');
    } catch (err) {
      if (!isCurrent()) return;
      if (err instanceof SessionExpiredError) clearJwt();

      // A 401 from the profile API is not proof that the Appwrite session is
      // gone. Check before sending a genuinely signed-in user back to the
      // landing page — that check-and-bounce caused the sign-in loop.
      const stillSignedIn = err instanceof SessionExpiredError
        ? Boolean(await currentUser())
        : true;
      if (!isCurrent()) return;

      const action = resolveProfileFailure(err, stillSignedIn);
      if (action.kind === 'clear-user') {
        setUser(null);
        setProfile(null);
        setNotice(null);
        setNoticeTone('info');
      } else {
        setUser(current);
      }
      showNotice(action.notice, 'error');
    }
    if (isCurrent()) setLoading(false);
  }, [showNotice]);

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
        window.history.replaceState({}, '', '/');
        return refresh().then(() => showNotice('Email verified. Thanks!'));
      })
      .catch(() => {
        showNotice('That verification link is invalid or has expired.', 'error');
        window.history.replaceState({}, '', '/');
      });
  }, [refresh, showNotice]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      loading,
      authOpen,
      notice,
      noticeTone,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      dismissNotice: () => {
        setNotice(null);
        setNoticeTone('info');
      },
      refresh,
      signIn: async (credentials) => {
        await appwriteSignIn(credentials);
        await refresh();
        setAuthOpen(false);
      },
      signUp: async (credentials) => {
        const { verificationSent } = await appwriteSignUp(credentials);
        await refresh();
        setAuthOpen(false);
        showNotice(
          verificationSent
            ? 'Account created. Check your inbox to verify your email address.'
            : 'Account created, but the verification email could not be sent. Use the resend button to try again.',
          verificationSent ? 'info' : 'error'
        );
      },
      resendVerification: async () => {
        await appwriteSendVerification();
        showNotice('Verification email sent. Check your inbox.');
      },
      signOut: async () => {
        refreshGeneration.current += 1;
        await appwriteSignOut();
        clearJwt();
        setUser(null);
        setProfile(null);
        setNotice(null);
        setNoticeTone('info');
      },
      requestReset: requestPasswordReset,
    }),
    [user, profile, loading, authOpen, notice, noticeTone, refresh, showNotice]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
