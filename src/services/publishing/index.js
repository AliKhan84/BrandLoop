/**
 * Publishing dispatcher — the swap point named in PRD §2 and §6.
 *
 * RESPONSIBILITY
 *   Route a post to the right platform publisher and normalise the result.
 *
 * WHY THIS FILE HAS NO PLATFORM LOGIC
 *   This is the seam the project is built around. Today both platforms are
 *   "assisted" — the user posts manually. When LinkedIn API access arrives
 *   (PRD Phase 2) or X billing is enabled, only the branch target below
 *   changes: it starts calling an API publisher that returns the same payload
 *   shape. Nothing in the Discord layer, the scheduler, or the models moves.
 *
 *   If platform-specific behaviour leaked up here, that swap would become a
 *   change in five files instead of one line.
 *
 * DOES NOT OWN: how a platform is published to, or whether publishing should
 * happen (the interaction router decides that).
 */

import { PLATFORM, PUBLISH_METHOD } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { buildXAssist } from './xPublisher.js';
import { buildLinkedInAssist } from './linkedinPublisher.js';

/**
 * Produces the assisted-publish payload for a post.
 *
 * @param {object} post - A `Post` document, or any object with `platform` and
 *   a `fullText()` method or `content`/`hashtags` fields.
 * @returns {{platform: string, instructions: string, composerUrl: string|null,
 *   prefilled: boolean, linkLabel: string, copyBlock: string, warning: string|null,
 *   publishMethod: string}} The uniform payload every publisher returns.
 * @throws {ApiError} 400 when the post targets a platform with no publisher —
 *   better a loud failure than a post that silently never goes anywhere.
 * @sideeffect none (pure)
 */
export function publishPost(post) {
  // Accept either a Mongoose document (which has fullText()) or a plain object,
  // so this is callable from tests and scripts without constructing a document.
  const text = typeof post.fullText === 'function'
    ? post.fullText()
    : [post.content, ...(post.hashtags ?? [])].filter(Boolean).join('\n\n');

  // Every part in order, for platforms that can express a thread. Read through
  // `postSegments()` when available so the parts published are the same parts
  // every renderer shows.
  const segments = typeof post.postSegments === 'function'
    ? post.postSegments()
    : [post.content, ...(post.thread ?? [])].filter(Boolean);

  switch (post.platform) {
    case PLATFORM.X:
      return { ...buildXAssist({ text, segments }), publishMethod: PUBLISH_METHOD.ASSISTED };

    case PLATFORM.LINKEDIN: {
      // LinkedIn has no text prefill, so the link routes through BrandLoop's
      // copy-and-open page when the post has an id to build one from. Without an
      // id (a plain object in a test, say) it falls back to the composer.
      const postId = post._id?.toString?.() ?? null;
      const composePageUrl = postId
        ? `${env.DASHBOARD_BASE_URL}/compose/${postId}`
        : null;

      // `segments` is deliberately not passed: LinkedIn has no thread concept in
      // this build, and the generator never sets one for it.
      return {
        ...buildLinkedInAssist({ text, composePageUrl }),
        publishMethod: PUBLISH_METHOD.ASSISTED,
      };
    }

    default:
      logger.error(`publishPost: no publisher for platform "${post.platform}"`);
      throw ApiError.badRequest(`Unsupported platform "${post.platform}".`);
  }
}

export default { publishPost };
