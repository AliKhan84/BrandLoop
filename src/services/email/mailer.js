/**
 * Outbound email transport.
 *
 * RESPONSIBILITY
 *   Hand a finished message to SMTP, and behave predictably when there is no
 *   SMTP to hand it to.
 *
 * WHY IT DEGRADES INSTEAD OF FAILING
 *   Mail credentials are optional, and that is a deliberate design choice: a
 *   missing app password must never stop the API from booting, and the flow has
 *   to stay demonstrable on a laptop with no mail account. With no credentials
 *   configured the message is logged — including the link — so a developer can
 *   complete the verification by hand. The alternative, refusing to start, would
 *   turn an optional integration into a hard dependency.
 *
 * WHY ONE TRANSPORTER IS CACHED
 *   `createTransport` opens no connection (nodemailer pools on demand), but
 *   re-creating it per message would rebuild the connection pool every time.
 *
 * DOES NOT OWN: what the message says (`templates.js`) or when it is sent
 * (`verification.js`).
 */

import nodemailer from 'nodemailer';

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/** The lazily-created transport. Null until the first send. */
let transport = null;

/**
 * Builds (or returns) the SMTP transport.
 *
 * @returns {import('nodemailer').Transporter} The transport.
 * @sideeffect Creates and caches a transport on first use.
 */
function getTransport() {
  if (transport) return transport;

  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // true for port 465 (implicit TLS), false for 587 (STARTTLS). Exposed as a
    // setting rather than inferred from the port, because providers disagree and
    // a wrong guess fails with an unhelpful timeout.
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });

  return transport;
}

/**
 * Sends one message, or logs it when SMTP is not configured.
 *
 * @param {object} params - Message parameters.
 * @param {string} params.to - Recipient address.
 * @param {string} params.subject - Subject line.
 * @param {string} params.text - Plain-text body. Always sent, so the message is
 *   readable in a text-only client and less likely to be scored as spam.
 * @param {string} params.html - HTML body.
 * @param {string} [params.logUrl] - A link worth printing when the message is
 *   logged rather than sent, so the flow can be completed by hand.
 * @returns {Promise<{sent: boolean, reason?: string, messageId?: string}>} The
 *   outcome. `sent: false` is not an error — it is the documented no-credentials
 *   path.
 * @throws {Error} Only when a configured SMTP server rejects the message; the
 *   caller decides whether that is fatal (for signup it is not).
 * @sideeffect Sends mail, or writes to the log.
 */
export async function sendMail({ to, subject, text, html, logUrl }) {
  if (!env.EMAIL_ENABLED) {
    logger.warn(
      `email: SMTP is not configured, so "${subject}" was not sent to ${to}. ` +
        'Set SMTP_HOST, SMTP_USER and SMTP_PASS in .env to deliver it.',
    );

    if (logUrl) {
      // Deliberately info-level and not warn: this is how the flow is meant to
      // be exercised locally, not a problem to fix.
      logger.info(`email: ${to} can be verified with this link: ${logUrl}`);
    }

    return { sent: false, reason: 'smtp-not-configured' };
  }

  const info = await getTransport().sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    text,
    html,
  });

  logger.info(`email: sent "${subject}" to ${to} (${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

/**
 * Checks that the configured SMTP credentials actually work.
 *
 * WHY THIS EXISTS SEPARATELY: `npm run probe` validates every credential before
 * a demo, and mail is now one of them. Without this, a wrong app password would
 * only surface when the first real signup happened — in front of an audience.
 *
 * @returns {Promise<{ok: boolean, error?: string}>} The result.
 * @sideeffect Opens an SMTP connection.
 */
export async function verifyMailer() {
  if (!env.EMAIL_ENABLED) {
    return { ok: false, error: 'SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)' };
  }

  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export default { sendMail, verifyMailer };
