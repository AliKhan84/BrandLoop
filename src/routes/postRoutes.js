/**
 * Post routes — read the drafts a user has been sent, and edit one.
 *
 * RESPONSIBILITY
 *   Expose a view of generated posts.
 *
 * WHY ALMOST READ-ONLY
 *   Approval and rejection happen through the Discord buttons, which is where
 *   the user actually is when they see a draft. Duplicating those transitions
 *   over HTTP would mean two code paths that can disagree about what a post's
 *   status should be — and the guard that makes Approve idempotent lives in one
 *   of them. That reasoning still holds, so neither is exposed here.
 *
 * WHY EDIT IS THE EXCEPTION
 *   Editing is not read-only in the sense the others are, but it is not a
 *   lifecycle transition either: it changes text, never status. It is reachable
 *   from the dashboard as well as Discord, so rather than reimplement the guards
 *   it delegates to `updatePostContent` — the same function the Discord modal
 *   calls. One implementation, two entry points, no chance of drift.
 *
 * DOES NOT OWN: post creation (`planService`) or approval (`interactions.js`).
 */

import { z } from 'zod';

import { Router } from 'express';

import { Post } from '../models/Post.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { ApiError } from '../utils/ApiError.js';
import { POST_STATUS } from '../config/constants.js';

const router = Router();

router.use(requireAuth);

/** Edit payload. Only the body is editable — status is not a client concern. */
const updatePostSchema = z.object({
  content: z.string().min(1, 'A post cannot be empty.').max(6000),
});

/**
 * GET /api/posts — lists the user's posts, newest first.
 *
 * @param {import('express').Request} req - Requires `req.user`. Optional
 *   `?status=` and `?platform=` filters.
 * @param {import('express').Response} res - Responds 200 with the post list.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 when `status` is not a known post status.
 * @sideeffect none
 */
router.get('/', async (req, res) => {
  const filter = { userId: req.user._id };

  if (req.query.status) {
    const status = String(req.query.status);

    // Validated against the enum rather than passed through, so a typo returns
    // a clear 400 instead of an empty list that looks like "no posts".
    if (!Object.values(POST_STATUS).includes(status)) {
      throw ApiError.badRequest(
        `Unknown status "${status}". Expected one of: ${Object.values(POST_STATUS).join(', ')}.`,
      );
    }

    filter.status = status;
  }

  if (req.query.platform) {
    filter.platform = String(req.query.platform);
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const posts = await Post.find(filter).sort({ createdAt: -1 }).limit(limit);

  res.json({ posts: posts.map((post) => post.toPublicJSON()) });
});

/**
 * GET /api/posts/:id — one post in full.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the post.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when missing or owned by someone else.
 * @sideeffect none
 */
router.get('/:id', async (req, res) => {
  const post = await Post.findById(req.params.id);

  // A post belonging to another user reports 404, not 403 — confirming an id
  // exists but is someone else's would leak that the record exists.
  if (!post || post.userId.toString() !== req.user._id.toString()) {
    throw ApiError.notFound('Post not found.');
  }

  res.json({ post: post.toPublicJSON() });
});

/**
 * PATCH /api/posts/:id — replaces a draft's body.
 *
 * Delegates to `updatePostContent` so the dashboard and the Discord modal
 * enforce identical rules. The Discord message is re-rendered as part of that
 * call, so both surfaces always show the same text.
 *
 * @param {import('express').Request} req - Requires `req.user`; body `{ content }`.
 * @param {import('express').Response} res - Responds 200 with the updated post.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when missing or not the caller's; 409 when the post has
 *   already been approved or rejected; 400 when empty or over the limit.
 * @sideeffect Writes the post and edits its Discord message.
 */
router.patch('/:id', validateBody(updatePostSchema), async (req, res) => {
  const post = await Post.findById(req.params.id);

  // Same reasoning as the read above: another user's post is a 404, not a 403.
  if (!post || post.userId.toString() !== req.user._id.toString()) {
    throw ApiError.notFound('Post not found.');
  }

  // Imported lazily for the same reason the plan route does it — `planService`
  // pulls in the Discord layer, and a plain read has no need of it.
  const { updatePostContent } = await import('../services/planService.js');
  await updatePostContent({ post, content: req.body.content });

  res.json({ post: post.toPublicJSON() });
});

export default router;
