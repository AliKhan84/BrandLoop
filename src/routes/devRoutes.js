/**
 * Development routes — manual triggers for demonstrating the pipeline.
 *
 * RESPONSIBILITY
 *   Let the loop be driven on demand instead of waiting a real day per post.
 *
 * WHY THIS EXISTS
 *   The product generates one slot per day. Without a way to force a run,
 *   demonstrating the full approve/reject/edit cycle would take a week — so
 *   these endpoints are not a convenience, they are what makes the Phase 1
 *   acceptance test possible at all.
 *
 * WHY IT IS DISABLED IN PRODUCTION
 *   `env.DEV_TOOLS_ENABLED` is forced false when `NODE_ENV=production`,
 *   regardless of what the .env file says. These routes let any authenticated
 *   user spend their own quota on demand, which is fine locally and not
 *   something to expose by accident on a deployed instance.
 *
 * DOES NOT OWN: the pipeline itself (`planService`) or scheduling (`jobs/`).
 */

import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { loadOwnedPlan } from '../services/planService.js';
import { runDailyJob } from '../jobs/dailyPostJob.js';
import { ContentPlan } from '../models/ContentPlan.js';
import { Post } from '../models/Post.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { PLAN_STATUS, SLOT_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Hard gate on every route in this file.
 *
 * Placed before `requireAuth` so a disabled deployment reveals nothing about
 * what these routes would do — an unauthenticated caller gets the same 404
 * whether the route exists or not.
 */
router.use((req, res, next) => {
  if (!env.DEV_TOOLS_ENABLED) {
    return next(ApiError.notFound(`No route matches ${req.method} ${req.path}.`));
  }
  return next();
});

router.use(requireAuth);

/**
 * POST /api/dev/scheduler/run — runs the daily job immediately.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the run summary.
 * @returns {Promise<void>}
 * @throws {ApiError} 429 when a run is already in progress.
 * @sideeffect Generates posts for every eligible user.
 */
router.post('/scheduler/run', async (req, res) => {
  logger.info(`Manual scheduler run triggered by user ${req.user._id}`);

  const summary = await runDailyJob({ triggeredBy: `dev:${req.user._id}` });

  res.json({ summary });
});

/**
 * POST /api/dev/plans/:id/slot/:dayIndex — generates one named slot immediately.
 *
 * @param {import('express').Request} req - Requires `req.user` and a numeric `dayIndex`.
 * @param {import('express').Response} res - Responds 202 with what was produced.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 for a non-numeric index; 404 when no slot matches.
 * @sideeffect Generates posts, consumes quota, sends DMs.
 */
router.post('/plans/:id/slot/:dayIndex', async (req, res) => {
  const dayIndex = Number(req.params.dayIndex);

  if (!Number.isInteger(dayIndex) || dayIndex < 1) {
    throw ApiError.badRequest('dayIndex must be a positive integer.');
  }

  const plan = await loadOwnedPlan({ planId: req.params.id, userId: req.user._id });

  const slot = plan.days.find((s) => s.dayIndex === dayIndex);
  if (!slot) {
    throw ApiError.notFound(`This plan has no slot ${dayIndex}.`);
  }

  const { generateSlot } = await import('../services/planService.js');
  // `force` bypasses the already-generated check, so a demo can replay a slot
  // that has already produced a post.
  const { generated, skipped } = await generateSlot({
    user: req.user,
    plan,
    slot,
    force: true,
  });

  res.status(202).json({
    dayIndex,
    generated: generated.map((post) => post.toPublicJSON()),
    skipped,
  });
});

/**
 * POST /api/dev/plans/:id/reset — returns a plan to its ungenerated state.
 *
 * WHY IT DELETES POSTS: leaving them would mean the reset plan has slots marked
 * `pending` alongside the posts they already produced, so the next run would
 * generate duplicates. A clean reset is what makes a repeatable demo possible.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the reset plan.
 * @returns {Promise<void>}
 * @sideeffect Deletes the plan's posts and clears every slot.
 */
router.post('/plans/:id/reset', async (req, res) => {
  const plan = await loadOwnedPlan({ planId: req.params.id, userId: req.user._id });

  const deleted = await Post.deleteMany({ planId: plan._id });

  for (const slot of plan.days) {
    slot.status = SLOT_STATUS.PENDING;
    slot.generatedAt = null;
    slot.newsHeadline = null;
    slot.newsUrl = null;
    slot.newsSourceName = null;
  }

  // Back to draft so the plan must be re-approved — a reset is a fresh start,
  // not a way to keep generating from something already signed off.
  plan.status = PLAN_STATUS.DRAFT;
  plan.approvedAt = null;
  await plan.save();

  res.json({
    plan: plan.toPublicJSON(),
    deletedPosts: deleted.deletedCount ?? 0,
  });
});

/**
 * GET /api/dev/plans — every plan this user owns, for test setup.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with plan summaries.
 * @returns {Promise<void>}
 * @sideeffect none
 */
router.get('/plans', async (req, res) => {
  const plans = await ContentPlan.find({ userId: req.user._id }).sort({ createdAt: -1 });

  res.json({
    plans: plans.map((plan) => ({
      id: plan._id.toString(),
      status: plan.status,
      durationDays: plan.durationDays,
      progress: plan.progress(),
      createdAt: plan.createdAt,
    })),
  });
});

export default router;
