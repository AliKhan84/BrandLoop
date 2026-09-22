import { randomBytes } from 'node:crypto';

import { NextResponse } from 'next/server';

/**
 * Google sign-in — step one, the redirect to Google.
 *
 * ## Why the dashboard builds this URL and the API does not
 *
 * The client secret stays in the API, and it is the only part of this that must.
 * A client ID is public by design — it travels in a URL the browser visits — so
 * holding a copy here costs nothing, and deriving the redirect URI from this
 * app's own address means it is right by construction instead of needing to be
 * kept in step with a second setting.
 *
 * ## Why there is a state cookie
 *
 * `state` is the CSRF defence for the callback. Without it, anyone can hand a
 * victim a callback URL carrying *their* authorization code, and the victim's
 * browser would quietly sign in as the attacker. The value is random, stored
 * httpOnly, and compared on the way back; a mismatch is a rejected sign-in
 * rather than a session.
 *
 * DOES NOT OWN: the code exchange, the session, or the account.
 *
 * @param request - Used only to build the callback URL.
 * @returns A redirect to Google, carrying the state cookie.
 * @sideeffect Sets the state cookie and sends the browser to Google.
 */
export function GET(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  // Unconfigured is a missing feature, not a crash: the button that leads here
  // is hidden when the API is unconfigured, and this covers a direct visit.
  if (!clientId) {
    return NextResponse.redirect(new URL('/login?error=google-not-configured', request.url));
  }

  const base = (process.env.DASHBOARD_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, '');
  const state = randomBytes(16).toString('hex');

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${base}/api/auth/google/callback`);
  authorizeUrl.searchParams.set('response_type', 'code');
  // `openid email profile` is the minimum that yields a verified address and a
  // display name. Asking for more would show a scarier consent screen for data
  // this product has no use for.
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('state', state);
  // Without this, a browser already signed into one Google account signs straight
  // back in with it, and a demo on a shared machine cannot switch accounts.
  authorizeUrl.searchParams.set('prompt', 'select_account');

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Ten minutes: long enough to read a consent screen, short enough that a
    // half-finished attempt does not linger.
    maxAge: 600,
  });

  return response;
}
