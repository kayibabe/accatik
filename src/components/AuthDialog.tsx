import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import {
  completePasswordReset,
  passwordProblem,
} from '../lib/appwrite.ts';

type Mode = 'signin' | 'signup' | 'reset' | 'newpassword';

/** Email/password sign-in, registration and recovery. */
export function AuthDialog() {
  const { authOpen, closeAuth, signIn, signUp, requestReset } = useAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<{ userId: string; secret: string } | null>(null);

  useEffect(() => {
    if (window.location.pathname !== '/reset') return;
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const secret = params.get('secret');
    if (userId && secret) {
      setResetToken({ userId, secret });
      setMode('newpassword');
      window.history.replaceState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    if (!authOpen) {
      setError(null);
      setDone(null);
    }
  }, [authOpen]);

  if (!authOpen && !resetToken) return null;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setDone(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);

    if (mode === 'signup') {
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn({ email, password });
      } else if (mode === 'signup') {
        await signUp({ email, password, name });
      } else if (mode === 'reset') {
        await requestReset(email);
        setDone('Password reset instructions have been emailed to you.');
      } else if (resetToken) {
        await completePasswordReset(resetToken.userId, resetToken.secret, password);
        setResetToken(null);
        switchMode('signin');
        setDone('Password updated. Please sign in.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'signin'
      ? 'Sign in'
      : mode === 'signup'
        ? 'Create your account'
        : mode === 'reset'
          ? 'Reset password'
          : 'Choose a new password';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-xs text-slate-500">
              Your saved slips and preferences follow your account, not the browser.
            </p>
          </div>
          {authOpen && (
            <button
              type="button"
              onClick={closeAuth}
              aria-label="Close sign-in"
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {done}
          </p>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
              />
            </label>
          )}

          {(mode === 'signin' || mode === 'signup' || mode === 'reset') && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
              />
            </label>
          )}

          {mode !== 'reset' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold text-slate-700">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-700 focus:outline-none"
              />
              {mode === 'signup' && (
                <span className="block text-[11px] text-slate-500">
                  At least 8 characters, including a letter and a number.
                </span>
              )}
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
          >
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : mode === 'reset'
                    ? 'Send reset link'
                    : 'Update password'}
          </button>
        </form>

        {mode === 'signin' && (
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="font-semibold text-emerald-700 hover:underline cursor-pointer"
            >
              Create an account
            </button>
            <button
              type="button"
              onClick={() => switchMode('reset')}
              className="text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
            >
              Forgot password?
            </button>
          </div>
        )}
        {mode !== 'signin' && mode !== 'newpassword' && (
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
          >
            Back to sign in
          </button>
        )}

        <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
          18+ only. Analytics are informational, not betting advice. Past
          performance is not indicative of future results.
        </p>
      </div>
    </div>
  );
}
