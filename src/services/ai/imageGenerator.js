/**
 * Image generation — one illustration per post, written to `media/`.
 *
 * RESPONSIBILITY
 *   Build the final image prompt for a post, call the active provider's
 *   `generateImage`, store the bytes as `media/{postId}.jpg`, and record the
 *   public URL and timestamp on the post.
 *
 * ## Why the prompt is assembled here
 *
 * `post.imagePrompt` is authored by the text model at post-generation time,
 * which is the only moment anything knows what the post is about. But it is an
 * art direction, not a prompt: it carries no brand consistency and no
 * constraint on lettering. Those are added here, once, so successive posts from
 * one account look like they came from the same brand and no image contains
 * text — which every image model still renders unreliably.
 *
 * ## Why a failure never blocks the post
 *
 * The post is the product; the image is an enhancement. Every failure is
 * classified, logged with its provider detail, and reported to the caller as an
 * ApiError carrying a `reason` — the caller degrades the post to text-only and
 * stores a note. There is deliberately **no retry**: measured on this key, one
 * 1024x1024 image costs ~$0.04 and ~16 seconds, so a retry loop is exactly the
 * cost risk `QUOTAS.images` exists to prevent.
 *
 * DOES NOT OWN: quota (the caller consumes before calling this), delivery to
 * Discord (`approvalQueue`), or the decision that a post wants an image at all
 * (`postGenerator`, via `needsImage`).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

import { getProvider } from './index.js';
import { IMAGE_SIZES, IMAGE_STYLE_SUFFIX, MEDIA_DIR } from '../../config/constants.js';
import { buildMediaUrl } from '../../utils/urlBuilder.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';

/** Extension every generated image is stored with. */
const IMAGE_EXTENSION = 'jpg';

/**
 * Absolute path to `media/`, resolved from this file rather than the working
 * directory so a script, a test and the server all write to the same place.
 */
const MEDIA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
  MEDIA_DIR,
);

/**
 * User-facing notes for each way an image can fail to arrive.
 *
 * WHY STORED RATHER THAN SHOWN ONCE: the approval message is rebuilt from the
 * post every time it is refreshed, so a note held only in the return value of
 * the run that produced it would vanish on the next edit. The note is written
 * onto the post by the caller and read back by the renderer.
 *
 * The messages are deliberately generic: the actionable detail (moderation
 * categories, provider status) is logged for the developer, and the user only
 * needs to know the draft is text-only and why in one line.
 */
export const IMAGE_SKIP_NOTES = Object.freeze({
  quota: 'Not generated — the weekly image limit is reached.',
  moderation_blocked: 'Not generated — the image model declined this art direction.',
  timeout: 'Not generated — the image request timed out.',
  failed: 'Not generated — the image request failed.',
});

/**
 * The stored filename for a post's image.
 *
 * The post id is the name because it is the only identifier that is unique,
 * stable across regenerations of the message, and already what the download
 * URL is keyed on.
 *
 * @param {string|import('mongoose').Types.ObjectId} postId - The post's id.
 * @returns {string} Filename only, e.g. `"6aabfaae2d92e7db48f43e00.jpg"`.
 * @sideeffect none (pure)
 */
export function imageFilenameFor(postId) {
  return `${postId}.${IMAGE_EXTENSION}`;
}

/**
 * The absolute path a post's image is stored at.
 *
 * Exported so the Discord layer can find the file to attach without knowing the
 * directory layout — the module that writes the file owns where it lives.
 *
 * @param {string|import('mongoose').Types.ObjectId} postId - The post's id.
 * @returns {string} Absolute path inside `media/`.
 * @sideeffect none (pure)
 */
export function imageFilePathFor(postId) {
  return path.join(MEDIA_ROOT, imageFilenameFor(postId));
}

/**
 * Builds the full image prompt for a post.
 *
 * Returns null when the post carries no art direction, which is how the caller
 * distinguishes "nothing to illustrate" from "illustration failed" — the two
 * need different handling and only the second one is an error.
 *
 * The style suffix goes last so the brand and no-text constraints are the final
 * instructions the model reads, after the idea itself. That ordering is the
 * guard against text-in-image requests: the model is asked at post-generation
 * time never to describe text (see `PostDraftSchema`), and if it does anyway,
 * the suffix's "do not include any text" is what the image model sees last.
 *
 * @param {object} post - A `Post` document or plain object with `imagePrompt`.
 * @param {object|null} [user] - The owning user, for the niche line.
 * @returns {string|null} The prompt, or null when there is nothing to draw.
 * @sideeffect none (pure)
 */
export function buildImagePrompt(post, user = null) {
  const idea = String(post?.imagePrompt ?? '').trim();
  if (!idea) return null;

  const lines = [idea];

  // The niche is what stops an image from being generically attractive: a
  // healthcare post and a fintech post should not produce the same visual.
  if (user?.niche) {
    lines.push(`The image should read as relevant to a professional working in ${user.niche}.`);
  }

  lines.push(IMAGE_STYLE_SUFFIX);

  return lines.join('\n\n');
}

/**
 * Interprets a provider failure as one of the outcomes the caller can act on.
 *
 * Kept pure so every branch is testable — the classification decides what the
 * user is told and whether an operator goes looking for a bug, and both of
 * those are wrong if a refusal is reported as a generic failure.
 *
 * WHY `code === 'moderation_blocked'` IS THE TEST: it is OpenAI's own code for
 * a refused generation, and the Gemini implementation mirrors it for its
 * IMAGE_SAFETY finish reasons so there is one vocabulary rather than a branch
 * per provider. The provider detail (categories, stage) is carried through for
 * logging, never shown to the user.
 *
 * @param {unknown} error - The thrown provider error.
 * @returns {{reason: string, statusCode: number, message: string, detail: object|null}}
 *   The reason (matching a key of `IMAGE_SKIP_NOTES`), an API status, a
 *   client-safe message, and provider detail for the developer log.
 * @sideeffect none (pure)
 */
export function classifyImageError(error) {
  const body = error?.error ?? null;
  const code = error?.code ?? body?.code ?? null;

  if (code === 'moderation_blocked') {
    const moderation = body?.moderation_details ?? error?.moderation_details ?? {};

    return {
      reason: 'moderation_blocked',
      statusCode: 422,
      message: 'The image model declined this art direction.',
      detail: {
        categories: moderation.categories ?? null,
        stage: moderation.moderation_stage ?? null,
      },
    };
  }

  // A timeout is a 408 by the same convention `gemini.js#statusOf` uses: the
  // SDK reports it as a DOMException with a numeric `code` that is not a
  // status, so the error *name* is the reliable signal.
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.status === 408) {
    return {
      reason: 'timeout',
      statusCode: 504,
      message: 'The image request timed out.',
      detail: null,
    };
  }

  return {
    reason: 'failed',
    statusCode: 502,
    message: 'The image request failed.',
    detail: { status: error?.status ?? null },
  };
}

/**
 * Generates the image for one post and writes it to disk.
 *
 * On success the post is mutated (`imageUrl`, `imageGeneratedAt`) but **not
 * saved** — the caller owns persistence so the image fields and any quota note
 * are written in the same save as the rest of the pipeline's changes.
 *
 * @param {object} params
 * @param {object} params.post - The saved post to illustrate.
 * @param {object|null} [params.user] - The owning user, for the niche line.
 * @returns {Promise<{model: string, usage: object, durationMs: number,
 *   bytes: number, imageUrl: string}>} What was produced, for the log row.
 * @throws {import('../../utils/ApiError.js').ApiError} When the post has no art
 *   direction, or when the provider call fails. `details.reason` is one of the
 *   `IMAGE_SKIP_NOTES` keys so the caller can store the matching note.
 * @sideeffect Makes a network request and writes a file under `media/`.
 */
export async function generateImageForPost({ post, user = null }) {
  const prompt = buildImagePrompt(post, user);

  if (!prompt) {
    throw ApiError.badRequest('This post has no image direction to generate from.');
  }

  const size = IMAGE_SIZES[post.platform]?.label ?? null;
  const provider = await getProvider();

  let result;
  try {
    result = await provider.generateImage({
      prompt,
      size,
      label: `generateImage:${post.platform}:post${post._id}`,
    });
  } catch (err) {
    const failure = classifyImageError(err);

    logger.error(
      `imageGenerator: ${failure.reason} for post ${post._id}`,
      failure.detail ?? '',
      err,
    );

    throw new ApiError(failure.statusCode, failure.message, {
      details: { reason: failure.reason },
      cause: err,
    });
  }

  // Written before the post records the URL: a post pointing at a file that
  // failed to write would deliver a broken image, which is worse than a
  // text-only draft that says why.
  await mkdir(MEDIA_ROOT, { recursive: true });
  await writeFile(imageFilePathFor(post._id), result.buffer);

  post.imageUrl = buildMediaUrl(imageFilenameFor(post._id));
  post.imageGeneratedAt = new Date();
  // Clears the note from a previous failure, so a post that later succeeds does
  // not still claim its image was skipped.
  post.imageSkipReason = null;

  return {
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
    bytes: result.buffer.length,
    imageUrl: post.imageUrl,
  };
}

export default {
  generateImageForPost,
  buildImagePrompt,
  classifyImageError,
  imageFilenameFor,
  imageFilePathFor,
  IMAGE_SKIP_NOTES,
};
