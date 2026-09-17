import type { Platform, PostStatus } from './types';

/**
 * Platform presentation and composer-link helpers.
 *
 * ## Why these mirror the backend
 *
 * The API already has this logic in `src/utils/urlBuilder.js` and
 * `src/config/constants.js`, but it only returns *stored post fields* — it does
 * not return a composer URL. Building the link needs to happen where the click
 * happens, so the rules are restated here.
 *
 * The duplication is deliberate and narrow: character limits, one URL pattern
 * per platform, and one URL-length guard. If the backend's limits change, these
 * must change with them — which is exactly why they live in one file with the
 * source named, rather than being inlined at each call site.
 */

/** Character ceilings. Mirrors `PLATFORM_LIMITS` in `src/config/constants.js`. */
export const PLATFORM_LIMITS: Record<Platform, number> = {
  x: 280,
  linkedin: 3000,
};

/** Display names. Mirrors `PLATFORM_LABELS`. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  x: 'X',
  linkedin: 'LinkedIn',
};

/**
 * Beyond this, the encoded URL stops surviving the trip intact — some clients
 * truncate it and the composer opens half-empty, which is worse than clearly
 * offering no link at all. Mirrors `MAX_COMPOSER_URL_LENGTH` in the backend.
 */
const MAX_COMPOSER_URL_LENGTH = 2000;

/**
 * Human labels for post statuses.
 *
 * Kept beside the status type so a new status cannot be added without the UI
 * having something to call it. "Needs review" rather than "pending_approval" —
 * the interface says what the user has to do, not what the database calls it.
 */
export const STATUS_LABELS: Record<PostStatus, string> = {
  pending_approval: 'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: 'Failed',
};

/**
 * Tailwind classes for the status dot, per status.
 *
 * Pair with `STATUS_LABELS` — never render one without the other.
 */
export const STATUS_DOT_CLASS: Record<PostStatus, string> = {
  pending_approval: 'bg-status-pending',
  approved: 'bg-status-approved',
  rejected: 'bg-status-rejected',
  failed: 'bg-destructive',
};

/**
 * Builds an X compose-intent URL with the post text prefilled.
 *
 * X is the one platform where prefilling works without API access, so this
 * produces a genuinely one-click publish rather than a hint.
 *
 * @param text - The full post text, hashtags included.
 * @returns A prefilled composer URL, or null when the text is too long for the
 *   link to survive.
 * @sideeffect none (pure)
 */
export function buildXComposerUrl(text: string): string | null {
  if (!text) return null;

  // `URLSearchParams` encodes spaces as `+`, which X's composer renders
  // literally. Percent-encoding them keeps the prefill clean.
  const query = new URLSearchParams({ text }).toString().replace(/\+/g, '%20');
  const url = `https://x.com/intent/post?${query}`;

  return url.length > MAX_COMPOSER_URL_LENGTH ? null : url;
}

/**
 * Builds the LinkedIn composer URL.
 *
 * Honest about its limit: LinkedIn has no supported way to prefill post text
 * without the Community Management API, so this opens an empty composer and the
 * text is delivered by the copy button. No attempt is made to fake the prefill,
 * and no browser automation is used — that would risk the user's own account.
 *
 * @returns The LinkedIn share composer URL.
 * @sideeffect none (pure)
 */
export function buildLinkedInComposerUrl(): string {
  return 'https://www.linkedin.com/feed/?shareActive=true';
}

/**
 * Resolves the composer link for a platform.
 *
 * @param platform - The target platform.
 * @param text - The full post text.
 * @returns The URL and whether the composer will already contain the text. A
 *   null URL means "copy block only".
 * @sideeffect none (pure)
 */
export function buildComposerLink(
  platform: Platform,
  text: string,
): { url: string | null; prefilled: boolean } {
  if (platform === 'x') {
    const url = buildXComposerUrl(text);
    return { url, prefilled: url !== null };
  }

  if (platform === 'linkedin') {
    return { url: buildLinkedInComposerUrl(), prefilled: false };
  }

  return { url: null, prefilled: false };
}

/**
 * Counts user-perceived characters the way the backend does.
 *
 * Uses code points rather than UTF-16 length so an emoji counts as the one
 * character a reader sees. Mirrors `countCharacters` in `src/utils/text.js`, so
 * the number shown here matches the number the API enforced.
 *
 * @param text - The text to measure.
 * @returns The number of Unicode code points.
 * @sideeffect none (pure)
 */
export function countCharacters(text: string): number {
  return [...text].length;
}
