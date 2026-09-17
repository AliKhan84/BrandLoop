/**
 * Assisted publishing — X.
 *
 * RESPONSIBILITY
 *   Produce everything the user needs to publish an approved post to X in one
 *   action: a prefilled composer link, and a copyable block for the cases where
 *   the link cannot carry the text.
 *
 * ## Why this is "assisted" and not automated
 *
 * The build does not publish via the X API. Two reasons, both from PRD §2:
 *   • The API now requires a paid tier, and billing is not set up.
 *   • Publishing on a user's behalf needs write scopes and a review that a
 *     university project does not have.
 *
 * So the product's payoff is the link. X is the one platform where a link can
 * genuinely prefill the post text, which makes this a real one-click publish
 * rather than a hint. When X API access lands, only this module changes — the
 * Discord layer calls `publishPost` and does not care what is behind it.
 *
 * DOES NOT OWN: the copy block (that is platform-agnostic, in `urlBuilder`), or
 * the decision to publish at all (that is the interaction router).
 */

import { PLATFORM, PLATFORM_LIMITS } from '../../config/constants.js';
import { buildXComposerUrl, buildCopyBlock, buildThreadCopyBlocks } from '../../utils/urlBuilder.js';
import { countCharacters } from '../../utils/text.js';

/**
 * Builds the assisted-publish payload for an X post.
 *
 * ## Threads
 *
 * X's intent URL can prefill exactly one post, so only part 1 goes in the link.
 * Saying otherwise — or silently putting the whole thread in and letting X
 * truncate it — would be a promise the user only discovers is broken after
 * clicking. The remaining parts are delivered as their own copy blocks, each to
 * be posted as a reply.
 *
 * @param {object} params
 * @param {string} params.text - The root post, hashtags included.
 * @param {string[]} [params.segments] - Every part in order, root first. Omit
 *   or pass a single entry for a non-thread post.
 * @returns {{platform: string, instructions: string, composerUrl: string|null,
 *   prefilled: boolean, linkLabel: string, copyBlock: string, copyBlocks: string,
 *   isThread: boolean, warning: string|null}}
 *   A uniform payload — every publisher returns this shape so the Discord
 *   renderer needs no per-platform branching.
 * @sideeffect none (pure)
 */
export function buildXAssist({ text, segments = null }) {
  const parts = (segments ?? [text]).filter((part) => String(part ?? '').trim().length > 0);
  const isThread = parts.length > 1;

  // The link carries the ROOT only. `text` is already root + hashtags, exactly
  // what a first post should contain.
  const composerUrl = buildXComposerUrl(text);

  // A null URL means the encoded text would make the link unreliable, so the
  // user gets the copy block on its own rather than a link that opens a
  // half-empty composer — which is worse than clearly offering no link.
  const warning = composerUrl === null
    ? 'This post is too long to prefill reliably — copy it and paste into the X composer.'
    : null;

  const length = countCharacters(text);
  const limit = PLATFORM_LIMITS[PLATFORM.X];
  const lengthNote = length > limit
    // Should be impossible: `enforcePlatformLimit` runs before this. Reported
    // rather than silently accepted, because it would mean that guarantee broke.
    ? ` (${length}/${limit} — over the X limit, please trim)`
    : '';

  return {
    platform: PLATFORM.X,
    instructions: isThread
      ? `Open the composer — part 1 is already in it. Post it, then reply with each remaining part in order (${parts.length} parts total).`
      : composerUrl
        ? 'Open the composer — your text is already in it. Review, then post.'
        : 'Copy the text, open X, and paste it into a new post.',
    composerUrl,
    prefilled: composerUrl !== null,
    linkLabel: isThread ? 'Open X composer (part 1)' : 'Open X composer',
    // For a thread these differ: `copyBlock` stays the root, which is what a
    // single-post caller expects, while `copyBlocks` carries every part.
    copyBlock: buildCopyBlock(text),
    copyBlocks: isThread ? buildThreadCopyBlocks(parts) : buildCopyBlock(text),
    isThread,
    warning: warning ? `${warning}${lengthNote}` : (lengthNote || null),
  };
}

export default { buildXAssist };
