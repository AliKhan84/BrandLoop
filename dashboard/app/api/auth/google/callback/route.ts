import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ApiError, googleSignIn } from '@/lib/api';
import { setSessionToken } from '@/lib/session';

/** The state cookie written by the redirect route. */
const STATE_COOKIE = 'google_oauth_state';

/**
 * Google sign-in — step two, the callback.
 *
 * RESPONSIBILITY
 *   Check the state, hand the code to the API, and turn the returned JWT into
 *   the same httpOnly session cookie a password login sets. Nothing about the
 *   session differs by method of sign-in, which is why every page downstream is
 *   unaware this route exists.
 *
 * ## Why every failure lands on /login with a code rather than a screen
 *
 * A user who arrives here has just been through a consent screen they may have
 * cancelled or been blocked at. Rendering an error page would lose the context
 * that they were trying to sign in, so the failure returns them to the form they
 * started from, with a reason in the query string for it to show.
 *
 * DOES NOT OWN: the exchange with Google (the API), the state value (the
 * redirect route), or the cookie's parameters (`lib/session`).
 *
 * @param request - Carries `code` and `state` from Google.
 * @returns A redirect to the workspace, or back to the sign-in form.
 * @sideeffect Establishes a session, and clears the state cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;

  /** Sends the browser back to the form, clearing the spent state cookie. */
  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
    response.cookies.delete(STATE_COOKIE);
    return response;
  };

  // Google reports a refusal as `error=access_denied` and no code — someone who
  // clicked Cancel, or an account blocked from a testing-mode app. Not a defect
  // and not worth a stack trace.
  if (!code) {
    return fail('google-cancelled');
  }

  // Compared before the code is spent, so a forged callback cannot burn a real
  // one and cannot establish a session.
  if (!state || !expectedState || state !== expectedState) {
    return fail('google-state');
  }

  let token: string;
  try {
    ({ token } = await googleSignIn(code));
  } catch (err) {
    // The API logs the reason Google gave; the user gets the fact of it. A 503
    // means unconfigured, which is worth distinguishing from a rejected sign-in
    // because only one of them is worth retrying.
    const reason = err instanceof ApiError && err.isUnavailable ? 'google-not-configured' : 'google-failed';
    return fail(reason);
  }

  await setSessionToken(token);

  const response = NextResponse.redirect(new URL('/workspace', request.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}
