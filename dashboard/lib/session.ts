import 'server-only';

import { cookies } from 'next/headers';

import { SESSION_COOKIE } from './constants';

/**
 * Session cookie handling.
 *
 * ## The decision this file implements
 *
 * The JWT from the Express API is stored in an **httpOnly** cookie, never in
 * `localStorage`. That distinction is the whole reason the dashboard routes
 * through Next.js instead of calling the API straight from the browser:
 *
 *   • `httpOnly` means JavaScript cannot read the token, so an XSS bug — in our
 *     code or in any dependency — cannot exfiltrate a session.
 *   • `sameSite: 'lax'` means another origin cannot drive authenticated requests
 *     on the user's behalf, which is what makes CSRF a non-issue here without
 *     needing a separate token.
 *   • Because the cookie is set by a same-origin route handler, the API needs
 *     no CORS configuration at all.
 *
 * The cost is one extra network hop per request. Given the heaviest operation
 * is "generate a post" (30-60s), that hop is unmeasurable.
 *
 * `server-only` at the top is load-bearing: it makes importing this from a
 * Client Component a build error rather than a runtime one, so the token can
 * never accidentally end up in a browser bundle.
 */

/** Cookie name. Re-exported from `constants` so middleware cannot drift from it. */
export { SESSION_COOKIE };

/**
 * How long the cookie lives in the browser.
 *
 * Matched to the API's `JWT_EXPIRES_IN` default. The API is still the authority
 * — an expired token is rejected server-side regardless of what the cookie
 * says — but keeping them aligned avoids presenting a signed-in shell that
 * immediately 401s on every request.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Reads the session token from the request cookies.
 *
 * @returns {Promise<string | null>} The JWT, or null when signed out.
 * @sideeffect none (reads the incoming request's cookie header)
 */
export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Stores the session token as an httpOnly cookie.
 *
 * Only callable from a Route Handler or Server Action — `cookies()` is
 * read-only during a Server Component render, and Next.js throws if you try.
 *
 * @param {string} token - The JWT returned by the API's login or register route.
 * @returns {Promise<void>}
 * @sideeffect Sets a cookie on the outgoing response.
 */
export async function setSessionToken(token: string): Promise<void> {
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Not `secure`, because this runs on plain http://localhost. Setting it
    // would make the browser silently drop the cookie and every login would
    // appear to succeed and then immediately sign the user out.
    secure: false,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Removes the session cookie.
 *
 * Clearing on logout is what actually ends the session from the browser's side.
 * The JWT itself remains technically valid until it expires — that is inherent
 * to stateless tokens, and acceptable here because the token is httpOnly and
 * the cookie is gone.
 *
 * @returns {Promise<void>}
 * @sideeffect Clears the cookie on the outgoing response.
 */
export async function clearSessionToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
