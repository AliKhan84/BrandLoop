/**
 * Shared constants usable from both the Edge runtime (middleware) and Node.
 *
 * WHY THIS FILE IS SEPARATE FROM `session.ts`: middleware runs on the Edge
 * runtime and cannot import Node-only modules, but `session.ts` imports
 * `next/headers` and is marked `server-only`. Splitting the cookie name out
 * means middleware and the session helpers cannot drift to different names,
 * which would present as a guard that redirects users who are already signed in.
 */

/** Name of the session cookie holding the API's JWT. */
export const SESSION_COOKIE = 'brandloop_session';

/**
 * Routes that require a session. Matched by exact path or path prefix.
 *
 * `/compose` is here because the post it renders is fetched with the session
 * token — an unauthenticated visitor cannot load one, and letting the route
 * through would only produce a redirect after a failed API call.
 */
export const PROTECTED_PREFIXES = ['/workspace', '/plans', '/drafts', '/settings', '/compose'] as const;

/** Routes a signed-in user should be redirected away from. */
export const AUTH_ROUTES = ['/login', '/signup'] as const;
