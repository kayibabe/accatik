import { SessionExpiredError } from '../utils/api.ts';

export type ProfileFailureAction =
  | { kind: 'keep-user'; notice: string }
  | { kind: 'clear-user'; notice: string };

/**
 * A protected profile request can fail for reasons unrelated to the Appwrite
 * session (expired JWT, cold function, transient network error). Only clear the
 * signed-in UI when the Appwrite session itself is gone; otherwise the user
 * would be bounced back to the guest landing page while still authenticated.
 */
export function resolveProfileFailure(
  error: unknown,
  sessionStillValid: boolean
): ProfileFailureAction {
  if (error instanceof SessionExpiredError) {
    return sessionStillValid
      ? {
          kind: 'keep-user',
          notice:
            'We could not confirm your account with the API just now. Your session is still active — use Retry to load your profile.',
        }
      : { kind: 'clear-user', notice: error.message };
  }

  return {
    kind: 'keep-user',
    notice:
      'Signed in, but account details could not be loaded right now. Your role will appear once the account service responds.',
  };
}
