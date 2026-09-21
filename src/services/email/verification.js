/**
 * Email-verification flow.
 *
 * RESPONSIBILITY
 *   Issue a verification token, send it, and redeem it.
 *
 * WHY ISSUING NEVER THROWS
 *   Signup must not fail because a mail server is down, misconfigured or rate
 *   limited. The account is already created and usable by the time this runs, so
 *   a failure here is logged and reported back as `sent: false` — the user can
 *   ask for another email from the banner. The alternative turns an optional
 *   integration into a way to lose accounts. This is the same rule the image
 *   pipeline follows: a failure in an optional step must not discard the work
 *   the user already has.
 *
 * WHY THE FLOW IS SOFT
 *   An unverified account can still sign in and use the product; the dashboard
 *   shows a banner until the address is confirmed. Blocking sign-in would make a
 *   broken mail credential lock every new account out of the app entirely, which
 *   is a far worse failure than an unconfirmed address.
 *
 * DOES NOT OWN: the token format (`utils/emailToken.js`), the transport
 * (`mailer.js`) or the HTTP surface (`routes/authRoutes.js`).
 */

import { env } from '../../config/env.js';
import { User } from '../../models/User.js';
import { logger } from '../../utils/logger.js';
import {
  generateEmailToken,
  hashEmailToken,
  isVerificationExpired,
  tokenHashesMatch,
  verificationExpiry,
} from '../../utils/emailToken.js';
import { sendMail } from './mailer.js';
import { verificationEmail } from './templates.js';

/** Fields that must be explicitly selected to be read. */
const TOKEN_FIELDS = '+emailVerificationTokenHash +emailVerificationExpiresAt +emailVerificationSentAt';

/**
 * Builds the link a user clicks to confirm their address.
 *
 * Points at the dashboard, not the API: the click has to land somewhere that can
 * explain what happened, and the dashboard is the only place that can call the
 * API server-side and render a result. `encodeURIComponent` because the token is
 * base64url and must survive the query string unchanged.
 *
 * @param {string} token - The raw token.
 * @returns {string} The absolute URL to put in the email.
 * @sideeffect none (pure)
 */
export function buildVerificationLink(token) {
  return `${env.DASHBOARD_BASE_URL}/verify-email?token=${encodeURIComponent(token)}`;
}

/**
 * Issues a token for a user, stores its hash, and sends the email.
 *
 * The document must already be saved — this writes to it.
 *
 * @param {object} user - The user document.
 * @returns {Promise<{sent: boolean, reason?: string, link?: string}>} Whether the
 *   message went out, plus the link when it did not (so a log-only run is usable).
 * @sideeffect Writes to the user document and sends mail.
 */
export async function issueVerification(user) {
  const token = generateEmailToken();

  user.emailVerificationTokenHash = hashEmailToken(token);
  user.emailVerificationExpiresAt = verificationExpiry();
  user.emailVerificationSentAt = new Date();
  await user.save();

  const link = buildVerificationLink(token);
  const { subject, text, html } = verificationEmail({
    name: user.name,
    link,
    expiresInMinutes: env.EMAIL_VERIFICATION_TTL_MIN,
  });

  try {
    const result = await sendMail({ to: user.email, subject, text, html, logUrl: link });
    return { sent: result.sent, reason: result.reason, link: result.sent ? undefined : link };
  } catch (error) {
    // The token is already stored, so the link would work if it arrived. It did
    // not, so this is a real problem to report — but not one that fails signup.
    logger.error(`email: sending the verification message to ${user.email} failed: ${error.message}`);
    return { sent: false, reason: 'send-failed', link };
  }
}

/**
 * Redeems a verification token.
 *
 * The lookup is by hash, so the raw token never has to be stored or scanned for.
 * Comparison is still constant-time even though a hash lookup already matched —
 * one comparison is not slower, and it keeps the rule "never compare tokens with
 * `===`" true everywhere.
 *
 * @param {string} token - The raw token from the URL.
 * @returns {Promise<{ok: boolean, reason?: string, user?: object}>} The outcome.
 *   `reason` is one of `invalid` or `expired`.
 * @sideeffect Marks the user verified and clears the token fields.
 */
export async function consumeVerification(token) {
  const hash = hashEmailToken(token);
  if (!hash) return { ok: false, reason: 'invalid' };

  const user = await User.findOne({ emailVerificationTokenHash: hash }).select(TOKEN_FIELDS);
  if (!user) return { ok: false, reason: 'invalid' };

  if (!tokenHashesMatch(user.emailVerificationTokenHash, hash)) {
    return { ok: false, reason: 'invalid' };
  }

  if (isVerificationExpired(user)) {
    return { ok: false, reason: 'expired' };
  }

  user.emailVerified = true;
  user.emailVerifiedAt = new Date();

  // Single use: cleared immediately, so a link forwarded to someone else — or
  // recovered from a mailbox later — cannot be replayed.
  user.emailVerificationTokenHash = null;
  user.emailVerificationExpiresAt = null;
  await user.save();

  logger.info(`email: ${user.email} confirmed their address`);

  return { ok: true, user };
}

/**
 * Loads the fields needed to decide whether a resend is allowed.
 *
 * @param {string} userId - The user id.
 * @returns {Promise<object|null>} The user, or null when not found.
 * @sideeffect none beyond the database read.
 */
export async function loadForResend(userId) {
  return User.findById(userId).select(TOKEN_FIELDS);
}

export default { buildVerificationLink, issueVerification, consumeVerification, loadForResend };
