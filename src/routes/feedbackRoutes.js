/**
 * Feedback routes — the user-facing half.
 *
 * RESPONSIBILITY
 *   Accept a message from a signed-in user, at a rate that cannot be used to
 *   bury the inbox.
 *
 * WHY THE RATE LIMIT IS A QUOTA BUCKET RATHER THAN A LIMITER
 *   The repository already has one mechanism that bounds how often a user may
 *   do something, and it is atomic, tested and reported in `/status`. Inventing
 *   a second one here would mean two things to reason about and a second place
 *   for a bug. A burst of feedback is exactly what a quota is for.
 *
 * WHY IT IS NOT ANONYMOUS
 *   A reply has to be possible, and an unauthenticated write endpoint is a spam
 *   magnet. The cost is that someone must have an account — acceptable for a
 *   product where everyone already has one.
 *
 * DOES NOT OWN: reading the messages (`routes/adminRoutes.js`) or storing them
 * (`models/Feedback.js`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { Feedback, FEEDBACK_CATEGORY } from '../models/Feedback.js';
import { consume, resolveLimit } from '../services/quotaService.js';
import { QUOTA_KEY } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

/**
 * Submission payload.
 *
 * `rating` is nullable rather than optional-with-a-default: a default of 3 would
 * silently record a rating nobody gave and skew every average computed from it.
 */
const submitSchema = z.object({
  category: z.enum(Object.values(FEEDBACK_CATEGORY)).optional().default(FEEDBACK_CATEGORY.IDEA),
  rating: z.number().int().min(1).max(5).nullable().optional().default(null),
  message: z.string().trim().min(5, 'Please write a little more.').max(4000),
  page: z.string().trim().max(200).optional().default(''),
});

/**
 * POST /api/feedback — stores a message from the signed-in user.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 201 with the stored message.
 * @returns {Promise<void>}
 * @throws {ApiError} 429 when the daily feedback quota is spent.
 * @sideeffect Consumes a quota unit and writes a feedback document.
 */
router.post('/', validateBody(submitSchema), async (req, res) => {
  const user = req.user;

  // Consumed before the write, matching every other metered operation: a
  // refusal must not leave a row behind.
  await consume({
    userId: user._id,
    key: QUOTA_KEY.FEEDBACK,
    limit: resolveLimit(user, QUOTA_KEY.FEEDBACK),
  });

  const feedback = await Feedback.create({
    userId: user._id,
    email: user.email,
    category: req.body.category,
    rating: req.body.rating,
    message: req.body.message,
    page: req.body.page,
  });

  logger.info(`feedback: ${user.email} sent a ${feedback.category} from ${feedback.page || 'unknown page'}`);

  res.status(201).json({ feedback: feedback.toPublicJSON() });
});

export default router;
