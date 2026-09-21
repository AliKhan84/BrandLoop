/**
 * Email-verification tokens.
 *
 * RESPONSIBILITY
 *   Generate the token that proves someone controls the address they signed up
 *   with, store only its hash, and compare hashes without leaking timing.
 *
 * WHY A RANDOM TOKEN AND NOT A CODE
 *   The Discord link code is six digits because it is typed by hand on a phone.
 *   This one is never typed — it arrives as a link — so it can afford to be
 *   unguessable: 32 random bytes, which is far past the point where brute force
 *   is a consideration inside a 24-hour window.
 *
 * WHY ONLY THE HASH IS STORED
 *   A database dump that contains raw tokens is a set of working account
 *   takeovers. Storing the hash means a leaked dump yields nothing usable, the
 *   same reasoning as password hashing. The token therefore exists in exactly
 *   two places: the email, and the moment it is compared.
 *
 * PURE MODULE: no I/O, no database access. That is what makes the suite in
 * `tests/emailToken.test.js` meaningful.
 *
 * DOES NOT OWN: sending mail (`services/email/mailer.js`) or the User fields the
 * hash is written to.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { env } from '../config/env.js';

/**
 * Generates a new verification token.
 *
 * base64url rather than hex: the token travels inside a URL query string, so it
 * must survive being copied out of an email client, and `+` and `/` would be
 * decoded as spaces and path separators respectively.
 *
 * @returns {string} A 43-character URL-safe token.
 * @sideeffect none (uses the CSPRNG)
 */
export function generateEmailToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Hashes a token for storage or comparison.
 *
 * SHA-256 without a salt, deliberately: the input is already 256 bits of
 * randomness, so there is no dictionary to attack and nothing for a salt to
 * defend against. A slow hash would only make every click on a verification
 * link slower.
 *
 * @param {string} token - The raw token.
 * @returns {string} A 64-character hex digest, or an empty string when there is
 *   no token.
 * @sideeffect none (pure)
 */
export function hashEmailToken(token) {
  if (typeof token !== 'string' || token.length === 0) return '';
  return createHash('sha256').update(token).digest('hex');
}

/**
 * When a token issued now should stop working.
 *
 * @returns {Date} The expiry.
 * @sideeffect none (pure)
 */
export function verificationExpiry() {
  return new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_MIN * 60_000);
}

/**
 * Reports whether a stored token has expired.
 *
 * @param {object} user - A user document, loaded with the token fields selected.
 * @param {Date} [now] - Injectable clock, so the test does not have to wait.
 * @returns {boolean} True when there is no expiry, or it has passed.
 * @sideeffect none (pure)
 */
export function isVerificationExpired(user, now = new Date()) {
  if (!user?.emailVerificationExpiresAt) return true;
  return user.emailVerificationExpiresAt <= now;
}

/**
 * Compares two token hashes in constant time.
 *
 * WHY NOT `===`: string comparison short-circuits at the first differing
 * character, so how long it takes leaks how much of the value was right. That
 * is enough to recover a value byte by byte. Both sides are hashes of the same
 * length by construction, but the length is checked anyway rather than assumed,
 * because `timingSafeEqual` throws on a mismatch.
 *
 * @param {string} a - First hash.
 * @param {string} b - Second hash.
 * @returns {boolean} True when both are present and identical.
 * @sideeffect none (pure)
 */
export function tokenHashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * When this user may ask for another verification email.
 *
 * The cooldown exists because the resend button is reachable by anyone with a
 * session: without it, one account can burn a provider's daily sending quota —
 * and get the sending domain flagged as a spammer — from a single loop.
 *
 * @param {object} user - A user document with `emailVerificationSentAt` selected.
 * @param {Date} [now] - Injectable clock.
 * @returns {Date|null} The earliest allowed time, or null when a resend is fine now.
 * @sideeffect none (pure)
 */
export function resendAllowedAt(user, now = new Date()) {
  if (!user?.emailVerificationSentAt) return null;

  const cooldownMs = env.EMAIL_RESEND_COOLDOWN_SEC * 1000;
  if (cooldownMs === 0) return null;

  const allowedAt = new Date(user.emailVerificationSentAt.getTime() + cooldownMs);
  return allowedAt > now ? allowedAt : null;
}

export default {
  generateEmailToken,
  hashEmailToken,
  verificationExpiry,
  isVerificationExpired,
  tokenHashesMatch,
  resendAllowedAt,
};
