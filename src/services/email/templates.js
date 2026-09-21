/**
 * Email bodies.
 *
 * RESPONSIBILITY
 *   Render the messages the product sends, as both HTML and plain text.
 *
 * WHY BOTH ARE ALWAYS PRODUCED
 *   A message with only an HTML part is more likely to be filtered, and it is
 *   unreadable in a text-only client — which is exactly where someone may open
 *   it to check whether a link is safe. The two bodies are built together so a
 *   new template cannot ship with one of them missing.
 *
 * WHY THE HTML IS TABLES AND INLINE STYLES
 *   Mail clients strip <style> blocks and ignore modern layout, and Outlook
 *   renders through Word's engine. A stylesheet-based template that looks right
 *   in a browser arrives as unstyled text for a large share of recipients. This
 *   is the one place in the codebase where inline styling is the correct
 *   answer rather than a shortcut.
 *
 * DOES NOT OWN: sending (`mailer.js`) or the token (`utils/emailToken.js`).
 */

/** The product's warm accent, repeated here because a mail client cannot read our tokens. */
const ACCENT = '#b45309';
const INK = '#1c1917';
const MUTED = '#78716c';
const BORDER = '#e7e5e4';

/**
 * Escapes text for interpolation into HTML.
 *
 * @param {string} value - Raw text.
 * @returns {string} Escaped text.
 * @sideeffect none (pure)
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the address-verification message.
 *
 * @param {object} params - Template parameters.
 * @param {string} [params.name] - The recipient's name, when they gave one.
 * @param {string} params.link - The full verification URL.
 * @param {number} params.expiresInMinutes - How long the link stays valid.
 * @returns {{subject: string, text: string, html: string}} The message.
 * @sideeffect none (pure)
 */
export function verificationEmail({ name, link, expiresInMinutes }) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const hours = Math.round(expiresInMinutes / 60);
  const expiryText = hours >= 24 ? '24 hours' : `${expiresInMinutes} minutes`;

  const subject = 'Confirm your BrandLoop email address';

  const text = [
    greeting,
    '',
    'Confirm this address to finish setting up BrandLoop:',
    '',
    link,
    '',
    `The link works for ${expiryText} and can be used once.`,
    'If you did not create a BrandLoop account, you can ignore this email —',
    'nothing was set up without confirming it.',
    '',
    '— BrandLoop',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#faf8f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 8px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(greeting)}</p>
                <p style="margin:12px 0 0 0;font-size:15px;line-height:1.6;color:${INK};">
                  Confirm this address to finish setting up BrandLoop.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px 4px 28px;">
                <a href="${escapeHtml(link)}"
                   style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:12px 20px;border-radius:8px;">
                  Confirm email address
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">
                  Button not working? Copy this address into your browser:
                </p>
                <p style="margin:6px 0 0 0;font-size:13px;line-height:1.6;word-break:break-all;">
                  <a href="${escapeHtml(link)}" style="color:${ACCENT};">${escapeHtml(link)}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;border-top:1px solid ${BORDER};">
                <p style="margin:16px 0 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
                  The link works for ${escapeHtml(expiryText)} and can be used once.
                </p>
                <p style="margin:8px 0 0 0;font-size:13px;line-height:1.6;color:${MUTED};">
                  If you did not create a BrandLoop account, you can ignore this email —
                  nothing was set up without confirming it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}

export default { verificationEmail };
