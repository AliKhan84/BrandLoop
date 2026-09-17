/**
 * URL builders for media links and platform composer links.
 *
 * RESPONSIBILITY
 *   Construct every outbound URL the app produces: public links to generated
 *   images, and the prefilled composer links that make assisted publishing a
 *   single click.
 *
 * WHY THE COMPOSER LINKS MATTER (PRD §2)
 *   Because this build does not publish via API, the composer link *is* the
 *   product's payoff. A link that drops the user on an empty composer makes
 *   them paste manually and the "one action" promise is broken. X genuinely
 *   supports prefilling text; LinkedIn genuinely does not — so the two are
 *   built differently and the difference is documented rather than papered
 *   over.
 *
 * SECURITY: every user-supplied string is passed through `URLSearchParams`,
 * which percent-encodes it. Hand-built query strings here would allow a post
 * containing `&` or `#` to corrupt the URL or inject extra parameters.
 *
 * DOES NOT OWN: deciding which platform a post targets, or shortening links.
 */

import { env } from '../config/env.js';
import { MEDIA_DIR, PLATFORM } from '../config/constants.js';

/**
 * Upper bound on a composer URL we are willing to hand to the user.
 *
 * WHY A CEILING: X's intent endpoint tolerates a long `text` parameter, but
 * past roughly this length the URL becomes unreliable — some clients truncate
 * it, and the prefilled composer arrives half-empty, which is worse than
 * clearly not offering the link. Beyond the ceiling we fall back to the copy
 * block alone.
 */
const MAX_COMPOSER_URL_LENGTH = 2000;

/**
 * Builds the public URL for a file in the media directory.
 *
 * @param {string} filename - Filename only, e.g. `"abc123.jpg"`. Not a path.
 * @returns {string} Absolute URL, e.g. `"https://host/media/abc123.jpg"`.
 * @sideeffect none (pure)
 */
export function buildMediaUrl(filename) {
  // encodeURIComponent guards against a filename containing `/` or `..`,
  // which would otherwise let a crafted id escape the media directory.
  return `${env.PUBLIC_BASE_URL}/${MEDIA_DIR}/${encodeURIComponent(filename)}`;
}

/**
 * Builds an X compose-intent URL that arrives with the post text prefilled.
 *
 * X is the one platform where true prefilling is possible without the API,
 * so this returns a genuinely useful link rather than a bare composer.
 *
 * @param {string} text - The approved post body, hashtags included.
 * @returns {string|null} A prefilled composer URL, or `null` when the text is
 *   too long for the URL to survive the trip.
 * @sideeffect none (pure)
 */
export function buildXComposerUrl(text) {
  if (!text) return null;

  // URLSearchParams encodes spaces as `+`, which X's composer renders
  // literally. Percent-encoding spaces instead keeps the prefill clean.
  const query = new URLSearchParams({ text }).toString().replace(/\+/g, '%20');
  const url = `https://x.com/intent/post?${query}`;

  // Too long to be reliable — the caller falls back to the copy block.
  if (url.length > MAX_COMPOSER_URL_LENGTH) return null;

  return url;
}

/**
 * Builds a LinkedIn composer URL.
 *
 * HONEST ABOUT ITS LIMITS: per PRD §2 there is no supported way to prefill a
 * LinkedIn post without the Community Management API. This opens an empty
 * composer with the share dialog active, and the Discord message supplies the
 * text via a copyable code block. No attempt is made to fake the prefill —
 * and browser automation is explicitly not used, because it breaches both
 * platforms' terms and risks the *user's* account, not ours.
 *
 * @returns {string} The LinkedIn share composer URL.
 * @sideeffect none (pure)
 */
export function buildLinkedInComposerUrl() {
  return 'https://www.linkedin.com/feed/?shareActive=true';
}

/**
 * Returns the assisted-publish links for a platform.
 *
 * Both platforms return the same shape so the Discord renderer has a single
 * code path. Callers must treat `composerUrl === null` as "copy block only"
 * rather than an error.
 *
 * @param {string} platform - One of the `PLATFORM` values.
 * @param {string} text - The approved post body.
 * @returns {{composerUrl: string|null, prefilled: boolean}} Link plus whether
 *   the composer will already contain the text.
 * @sideeffect none (pure)
 */
export function buildComposerLink(platform, text) {
  switch (platform) {
    case PLATFORM.X: {
      const url = buildXComposerUrl(text);
      // `prefilled` is false when the URL was dropped for length, which the
      // renderer uses to word the instruction differently.
      return { composerUrl: url, prefilled: url !== null };
    }

    case PLATFORM.LINKEDIN:
      return { composerUrl: buildLinkedInComposerUrl(), prefilled: false };

    default:
      // Unknown platform: no link is better than a wrong one.
      return { composerUrl: null, prefilled: false };
  }
}

/**
 * Wraps text in a Discord code block.
 *
 * WHY THIS IS THE CORE OF ASSISTED PUBLISHING: a Discord bot cannot write to
 * the user's OS clipboard. Discord renders a native **Copy** button on a
 * fenced code block, so delivering the post this way is the only mechanism
 * that gives the user real one-click copying.
 *
 * @param {string} text - The post body.
 * @param {string} [language=''] - Optional syntax hint. Left empty so Discord
 *   does not attempt highlighting and the content stays plain.
 * @returns {string} The text fenced for Discord.
 * @sideeffect none (pure)
 */
export function buildCopyBlock(text, language = '') {
  // A body containing ``` would close the fence early and leak the rest of the
  // message as prose. Swapping in a lookalike keeps the paste content correct
  // and the message intact; the character is rare enough to be safe.
  const safe = String(text).replace(/```/g, '\u02cb\u02cb\u02cb');
  return `\`\`\`${language}\n${safe}\n\`\`\``;
}

/**
 * Builds one labelled copy block per thread part.
 *
 * WHY A BLOCK PER PART: each part is posted as its own reply, so the user needs
 * to copy them one at a time, in order. A single fenced block containing the
 * whole thread would give them one Copy button for text that has to be split
 * across messages by hand.
 *
 * WHY THE LABEL IS OUTSIDE THE FENCE: Discord's Copy button copies the block's
 * contents. Putting "Part 2 of 3" inside would paste it into the tweet.
 *
 * @param {string[]} segments - The parts, in posting order.
 * @returns {string} The labelled blocks, separated by blank lines.
 * @sideeffect none (pure)
 */
export function buildThreadCopyBlocks(segments) {
  const parts = (segments ?? []).filter((part) => String(part).trim().length > 0);
  if (parts.length === 0) return '';
  if (parts.length === 1) return buildCopyBlock(parts[0]);

  return parts
    .map((part, index) => `**Part ${index + 1} of ${parts.length}**\n${buildCopyBlock(part)}`)
    .join('\n\n');
}

export default {
  buildMediaUrl,
  buildXComposerUrl,
  buildLinkedInComposerUrl,
  buildComposerLink,
  buildCopyBlock,
  buildThreadCopyBlocks,
};
