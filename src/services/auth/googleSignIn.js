/**
 * Google sign-in — the authorization-code exchange.
 *
 * RESPONSIBILITY
 *   Turn a one-time `code` from Google into a verified profile, or explain why
 *   it could not be trusted. Nothing here touches the session: the caller
 *   (`authRoutes`) decides what account the profile maps to and mints the token.
 *
 * WHY THE API DOES THE EXCHANGE AND NOT THE DASHBOARD
 *   The dashboard is a backend-for-frontend and *could* hold the secret, but this
 *   API already owns every credential in the project — the AI key, the Discord
 *   token, the mail password — and identity is its job. Keeping the secret here
 *   means the browser-facing app never holds anything worth stealing, and the
 *   redirect URI has exactly one definition instead of one per process.
 *
 * WHY THE ID TOKEN IS NOT SIGNATURE-CHECKED
 *   The usual rule is "never trust an ID token without verifying its signature",
 *   and it exists because an ID token is normally handed to you *by a client*,
 *   where an attacker could swap in a forged one. This is the other case: the
 *   token arrives in the response to our own request to Google's token endpoint,
 *   over TLS, authenticated with our client secret. There is no untrusted hop to
 *   forge, so the signature adds nothing — Google's own guidance says the same
 *   for this flow.
 *
 *   What still must be checked is that the token was minted for *us*: a token
 *   issued to a different application is a perfectly valid token that has no
 *   business signing anyone in here. Hence the audience and issuer checks below.
 *
 * DOES NOT OWN: account creation, plan grants, or the session token.
 */

import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/** Google's token endpoint. Exported for the probe so it is not duplicated. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Both spellings Google uses for the issuer, across old and new tokens. */
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

/**
 * Whether Google sign-in is usable.
 *
 * Derived, never a toggle: setting the three values is what turns it on, and a
 * half-filled set is treated as off rather than as a crash at the first click.
 * Same reasoning as `EMAIL_ENABLED`.
 */
export function isGoogleConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

/**
 * Decodes a JWT payload without verifying it.
 *
 * @param {string} token - A JWT.
 * @returns {Record<string, unknown> | null} The payload, or null if malformed.
 * @sideeffect none (pure)
 */
function decodePayload(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Exchanges an authorization code for the profile behind it.
 *
 * @param {string} code - The `code` query parameter Google redirected back with.
 * @returns {Promise<{ email: string, name: string, emailVerified: boolean, subject: string }>}
 *   The verified profile. `subject` is Google's stable user id.
 * @throws {ApiError} 503 when the credentials are not configured, 400 when the
 *   code is rejected, expired, already used, or the token is not addressed to us.
 * @sideeffect One outbound HTTPS request to Google.
 */
export async function exchangeCodeForProfile(code) {
  if (!isGoogleConfigured()) {
    throw new ApiError(503, 'Google sign-in is not configured on this deployment.');
  }

  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  let response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    // Network-level failure: worth a 503 rather than a 400, because the code may
    // still be good and the caller's next attempt could succeed.
    logger.error(`Google token exchange failed to reach Google: ${err.message}`);
    throw new ApiError(503, 'Could not reach Google to complete sign-in. Please try again.');
  }

  if (!response.ok) {
    // Google's error bodies name the reason (`invalid_grant`, `redirect_uri_mismatch`).
    // It goes to the log rather than the client: it explains an integration
    // problem to whoever runs the deployment, and tells a user nothing useful.
    const detail = await response.text().catch(() => '');
    logger.warn(`Google token exchange rejected (${response.status}): ${detail.slice(0, 300)}`);

    throw ApiError.badRequest(
      response.status === 400
        ? 'That Google sign-in attempt has expired or was already used. Please try again.'
        : 'Google refused the sign-in request. Check the server log for the reason.',
    );
  }

  const tokens = await response.json();
  const claims = decodePayload(tokens.id_token ?? '');

  if (!claims) {
    throw ApiError.badRequest('Google returned an unreadable sign-in token.');
  }

  // The token must be minted for this application. Without this check, an ID
  // token obtained for any other Google app would be accepted here.
  if (claims.aud !== env.GOOGLE_CLIENT_ID) {
    logger.warn('Google sign-in rejected: token audience does not match GOOGLE_CLIENT_ID.');
    throw ApiError.badRequest('That Google sign-in token was issued for a different application.');
  }

  if (!VALID_ISSUERS.has(String(claims.iss))) {
    logger.warn(`Google sign-in rejected: unexpected issuer ${claims.iss}`);
    throw ApiError.badRequest('That Google sign-in token did not come from Google.');
  }

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) {
    throw ApiError.badRequest('That Google sign-in token has expired. Please try again.');
  }

  if (!claims.email) {
    throw ApiError.badRequest('Google did not share an email address for that account.');
  }

  return {
    email: String(claims.email).trim().toLowerCase(),
    name: typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) : '',
    // Google's own verification of the address. `email_verified` is a boolean on
    // current tokens; older ones send the string "true".
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    subject: String(claims.sub ?? ''),
  };
}
