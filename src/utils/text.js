/**
 * Text utilities — the last word on platform character limits.
 *
 * RESPONSIBILITY
 *   Normalise model output and guarantee it fits a platform's character
 *   ceiling, cutting on a sentence boundary rather than mid-word.
 *
 * WHY THIS EXISTS AT ALL
 *   The prompt *asks* the model to stay under the limit, but models overshoot
 *   on long themes, and a LinkedIn draft posted to X is silently truncated by
 *   the platform with no ellipsis — which reads as a broken post. Enforcing it
 *   here means the text shown in the approval embed is exactly what will be
 *   posted.
 *
 * PURE MODULE: every function here is deterministic and does no I/O. That is
 * what makes the suite in `tests/text.test.js` meaningful.
 *
 * DOES NOT OWN: hashtag strategy, tone, or any judgement about content
 * quality. It only guarantees fit.
 */

import { PLATFORM_LIMITS, PLATFORM_LABELS } from '../config/constants.js';

/**
 * The character appended when text has to be cut.
 * Counted as part of the limit, so the truncated result never overshoots.
 */
const ELLIPSIS = '…';

/**
 * Collapses runs of whitespace and trims the ends.
 *
 * WHY: models frequently emit trailing spaces, doubled spaces after sentence
 * endings, and stray newlines at the end of a response. All three inflate the
 * character count and make the post look sloppy. Normalising once here means
 * every downstream length check operates on the real text.
 *
 * Paragraph breaks are preserved — only runs of two or more newlines collapse
 * to a single blank line, because LinkedIn posts rely on that spacing.
 *
 * @param {string} text - Raw model output.
 * @returns {string} Whitespace-normalised text.
 */
export function normalizeWhitespace(text) {
  if (typeof text !== 'string') return '';

  return text
    .replace(/\r\n?/g, '\n')      // CRLF and lone CR become LF
    .replace(/[ \t]+/g, ' ')      // collapse horizontal runs
    .replace(/ *\n */g, '\n')     // strip spaces hugging newlines
    .replace(/\n{3,}/g, '\n\n')   // any 3+ newlines become one blank line
    .trim();
}

/**
 * Counts the characters a platform will actually charge for.
 *
 * WHY NOT `text.length`: JavaScript counts UTF-16 code units, so a single
 * emoji reports as 2 and a zero-width-joiner sequence like 👨‍👩‍👧 as 8. Counting
 * code points brings those down to 1 and 5 — much closer both to what a reader
 * perceives and to how platforms count.
 *
 * IT IS NOT A GRAPHEME COUNT. That family emoji still counts as 5, because
 * segmenting grapheme clusters needs a full ICU pass on every length check.
 * That is a deliberate trade: the generators target 85% of the limit, which
 * absorbs the difference, and this is exact for ordinary Latin text — the
 * overwhelming majority of what actually gets posted.
 *
 * @param {string} text - The text to measure.
 * @returns {number} The number of Unicode code points.
 */
export function countCharacters(text) {
  if (typeof text !== 'string') return 0;
  return [...text].length;
}

/**
 * Shortens text to fit a limit, preferring a sentence boundary.
 *
 * Strategy, in order:
 *   1. Already fits → return unchanged.
 *   2. A sentence terminator exists far enough into the window → cut there,
 *      keeping the terminator. A post that ends on a full stop reads as
 *      deliberate.
 *   3. Otherwise cut at the last word boundary → never split a word.
 *   4. No word boundary at all (one enormous token) → hard cut.
 *
 * @param {string} text - The text to shorten.
 * @param {number} limit - Maximum allowed characters, ellipsis included.
 * @returns {{text: string, truncated: boolean}} The result and whether it changed.
 */
export function truncateOnSentence(text, limit) {
  if (typeof text !== 'string') return { text: '', truncated: false };
  if (limit <= 0) return { text: '', truncated: true };

  const chars = [...text];
  if (chars.length <= limit) return { text, truncated: false };

  // Reserve room for the ellipsis so the final result still fits.
  const window = chars.slice(0, limit - 1).join('');

  // Only accept a sentence cut in the back half of the window. A full stop at
  // character 12 of a 280-character post would throw away almost everything.
  const lastTerminator = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('.\n'),
  );
  const sentenceCut = lastTerminator >= Math.floor(window.length * 0.5)
    // +1 keeps the punctuation itself; the space that followed is dropped.
    ? window.slice(0, lastTerminator + 1).trimEnd()
    : null;

  if (sentenceCut) return { text: sentenceCut, truncated: true };

  // Fall back to the last word boundary so no word is split in half.
  const lastSpace = window.lastIndexOf(' ');
  const wordCut = lastSpace > 0 ? window.slice(0, lastSpace).trimEnd() : window;

  return { text: `${wordCut}${ELLIPSIS}`, truncated: true };
}

/**
 * Guarantees a post fits its platform's character ceiling.
 *
 * ## Why `reserve` exists
 *
 * A platform counts the *whole* post, hashtags included. Enforcing the limit on
 * the body alone therefore produces a post that fits right up until the tags
 * are appended — which is exactly what happened: generated X posts came out at
 * 305 characters against a 280 ceiling, because the body was measured before
 * the hashtags were added.
 *
 * `reserve` is the number of characters that will be appended afterwards, so
 * the body is trimmed to `limit - reserve` and the assembled result fits.
 *
 * @param {string} text - The generated post body, without hashtags.
 * @param {string} platform - One of the `PLATFORM` values.
 * @param {object} [options]
 * @param {number} [options.reserve=0] - Characters to leave free for a suffix.
 * @returns {{text: string, truncated: boolean, limit: number, bodyLimit: number,
 *   reserved: number, originalLength: number}} The fitted text plus enough
 *   detail for the caller to log a truncation.
 * @throws {never} An unknown platform falls back to the strictest limit rather
 *   than throwing, because failing to post is worse than posting short.
 */
export function enforcePlatformLimit(text, platform, { reserve = 0 } = {}) {
  const normalized = normalizeWhitespace(text);
  // Unknown platform → use the smallest limit, so a typo produces a short
  // post rather than one the target platform silently cuts.
  const limit = PLATFORM_LIMITS[platform] ?? Math.min(...Object.values(PLATFORM_LIMITS));

  // Never let a large reserve collapse the budget to zero — a body of one
  // character still beats an empty post.
  const bodyLimit = Math.max(1, limit - reserve);

  const { text: fitted, truncated } = truncateOnSentence(normalized, bodyLimit);

  return {
    text: fitted,
    truncated,
    limit,
    bodyLimit,
    reserved: reserve,
    originalLength: countCharacters(normalized),
  };
}

/**
 * Splits hashtags out of a post body.
 *
 * WHY: the model is asked to return hashtags as a separate array, but it
 * sometimes appends them to the body as well. Posting both duplicates them.
 * Extracting them here means the caller can append the array exactly once.
 *
 * @param {string} text - Post body that may end with a run of hashtags.
 * @returns {{body: string, hashtags: string[]}} Body without trailing tags,
 *   plus every tag found anywhere in the text.
 */
export function splitHashtags(text) {
  if (typeof text !== 'string') return { body: '', hashtags: [] };

  const tags = text.match(/#[\p{L}\p{N}_]+/gu) ?? [];

  // Only strip tags from the END of the body. A hashtag mid-sentence is
  // usually deliberate and removing it would break the sentence.
  const body = text.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trimEnd();

  return { body, hashtags: tags };
}

/**
 * Ensures exactly one hashtag block sits at the end of the body.
 *
 * Idempotent: running it twice produces the same result, which matters because
 * a regenerated post passes through the same path as a fresh one.
 *
 * @param {string} body - Post body, with or without trailing hashtags.
 * @param {string[]} [hashtags=[]] - Tags to append.
 * @returns {string} Body with a single, correctly-spaced hashtag block.
 */
export function appendHashtags(body, hashtags = []) {
  const { body: cleanBody, hashtags: existing } = splitHashtags(body);

  // De-duplicate case-insensitively while preserving the first spelling seen.
  const seen = new Set();
  const merged = [];
  for (const tag of [...existing, ...hashtags]) {
    const normalizedTag = String(tag).trim();
    if (!normalizedTag) continue;
    const withHash = normalizedTag.startsWith('#') ? normalizedTag : `#${normalizedTag}`;
    const key = withHash.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(withHash);
  }

  if (merged.length === 0) return cleanBody;
  return `${cleanBody}\n\n${merged.join(' ')}`;
}

/**
 * Produces a short, human-readable label for a post, for logs and embeds.
 *
 * @param {string} text - The post body.
 * @param {number} [maxLength=60] - Maximum label length.
 * @returns {string} A single-line excerpt ending in an ellipsis when cut.
 */
export function excerpt(text, maxLength = 60) {
  const singleLine = normalizeWhitespace(text).replace(/\n+/g, ' ');
  const chars = [...singleLine];
  if (chars.length <= maxLength) return singleLine;
  return `${chars.slice(0, maxLength - 1).join('')}${ELLIPSIS}`;
}

/**
 * Describes a length violation in the form used by logs and Discord embeds.
 *
 * @param {string} text - The text that was checked.
 * @param {string} platform - One of the `PLATFORM` values.
 * @returns {string} e.g. `"312 / 280 characters (X (Twitter))"`.
 */
export function describeLength(text, platform) {
  const label = PLATFORM_LABELS[platform] ?? platform;
  const limit = PLATFORM_LIMITS[platform] ?? '?';
  return `${countCharacters(text)} / ${limit} characters (${label})`;
}

export default {
  normalizeWhitespace,
  countCharacters,
  truncateOnSentence,
  enforcePlatformLimit,
  splitHashtags,
  appendHashtags,
  excerpt,
  describeLength,
};
