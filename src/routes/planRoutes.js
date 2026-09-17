/**
 * Plan routes — create, read, approve and manually advance a content plan.
 *
 * RESPONSIBILITY
 *   Expose the plan lifecycle over HTTP.
 *
 * WHY APPROVE IS A SEPARATE ENDPOINT FROM CREATE
 *   `POST /api/plans` generates and stores a plan in `draft`. Only an explicit
 *   approval makes the scheduler willing to generate from it. That split means
 *   a plan can be reviewed and edited before it starts spending quota, and it
 *   is why `generateNextSlot` refuses to touch a draft.
 *
 * DOES NOT OWN: generation logic (`planService`) or scheduling (`jobs/`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { ContentPlan } from '../models/ContentPlan.js';
import { Post } from '../models/Post.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createPlan, loadOwnedPlan } from '../services/planService.js';
import { PLAN_STATUS, PLATFORMS, POST_TYPE, VALID_PLAN_DURATIONS } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.use(requireAuth);

/** Body for plan creation. */
const createSchema = z.object({
  durationDays: z.union([z.literal(7), z.literal(30)]).optional(),
});

/**
 * Body for slot editing.
 *
 * Both fields optional so a partial edit is valid — a body of just `{ theme }`
 * must not be rejected for omitting `type`. This is the same PATCH rule that
 * `userRoutes` got wrong, and getting it wrong here would fail the same way:
 * a 400 naming a field the client never intended to send.
 */
const updateSlotSchema = z
  .object({
    theme: z.string().trim().min(1, 'An angle cannot be empty.').max(500).optional(),
    type: z.enum(Object.values(POST_TYPE)).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * POST /api/plans — generates a draft plan.
 *
 * @param {import('express').Request} req - Validated body, requires `req.user`.
 * @param {import('express').Response} res - Responds 201 with the new plan.
 * @returns {Promise<void>}
 * @throws {ApiError} 429 when the daily plan-generation quota is spent.
 * @sideeffect Calls the model and writes a plan.
 */
router.post('/', validateBody(createSchema), async (req, res) => {
  const plan = await createPlan({
    userId: req.user._id,
    durationDays: req.body.durationDays ?? req.user.defaultPlanDuration,
  });

  res.status(201).json({ plan: plan.toPublicJSON() });
});

/**
 * GET /api/plans — lists the user's plans, newest first.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the plan list.
 * @returns {Promise<void>}
 * @sideeffect none
 */
router.get('/', async (req, res) => {
  const plans = await ContentPlan.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50);

  res.json({
    plans: plans.map((plan) => ({
      id: plan._id.toString(),
      status: plan.status,
      durationDays: plan.durationDays,
      postFrequency: plan.postFrequency,
      summary: plan.summary,
      progress: plan.progress(),
      createdAt: plan.createdAt,
    })),
  });
});

/**
 * GET /api/plans/:id — full plan detail, including slots and their posts.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the plan.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when the plan is missing or owned by someone else.
 * @sideeffect none
 */
router.get('/:id', async (req, res) => {
  const plan = await loadOwnedPlan({ planId: req.params.id, userId: req.user._id });

  // Posts are included so the UI can show which slots produced what without a
  // second round trip.
  const posts = await Post.find({ planId: plan._id }).sort({ dayIndex: 1, platform: 1 });

  res.json({
    plan: plan.toPublicJSON(),
    posts: posts.map((post) => post.toPublicJSON()),
  });
});

/**
 * PATCH /api/plans/:id/approve — approves a draft plan, enabling generation.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the plan.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 when the plan is already approved.
 * @sideeffect Writes the plan's status.
 */
router.patch('/:id/approve', async (req, res) => {
  const plan = await loadOwnedPlan({ planId: req.params.id, userId: req.user._id });

  if (plan.status === PLAN_STATUS.APPROVED) {
    throw ApiError.conflict('This plan is already approved.');
  }

  // Archived plans are finished; approving one would silently resume a plan the
  // user deliberately retired.
  if (plan.status === PLAN_STATUS.ARCHIVED) {
    throw ApiError.conflict('This plan has been archived and cannot be approved.');
  }

  plan.status = PLAN_STATUS.APPROVED;
  plan.approvedAt = new Date();
  await plan.save();

  logger.info(`Plan ${plan._id} approved by user ${req.user._id}`);

  res.json({ plan: plan.toPublicJSON() });
});

/**
 * PATCH /api/plans/:id/slots/:dayIndex — edits a slot's angle or its type.
 *
 * Only meaningful before the slot is generated: once posts exist the theme has
 * already been written against, so changing it would appear to work and change
 * nothing. `updateSlot` returns 409 in that case rather than silently accepting.
 *
 * Reachable on a `draft` as well as an `approved` plan — refining an angle
 * before its slot runs is the point, and approving a plan enables generation
 * rather than freezing the copy.
 *
 * Every field is `.optional()`: this is a PATCH, and a body carrying only
 * `theme` must not fail validation for omitting `type`.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the updated plan.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when the plan or slot is missing; 409 when the slot is
 *   already generated.
 * @sideeffect Writes the plan.
 */
router.patch('/:id/slots/:dayIndex', validateBody(updateSlotSchema), async (req, res) => {
  const dayIndex = Number(req.params.dayIndex);
  if (!Number.isInteger(dayIndex)) {
    throw ApiError.badRequest('Slot index must be an integer.');
  }

  const { updateSlot } = await import('../services/planService.js');
  const plan = await updateSlot({
    planId: req.params.id,
    userId: req.user._id,
    dayIndex,
    patch: req.body,
  });

  res.json({ plan: plan.toPublicJSON() });
});

/**
 * POST /api/plans/:id/generate — generates one specific slot on demand.
 *
 * The scheduled job advances a plan one slot at a time; this exists so a slot
 * can be produced immediately without waiting for the next run.
 *
 * @param {import('express').Request} req - Requires `req.user`; optional
 *   `dayIndex` in the body, defaulting to the next pending slot.
 * @param {import('express').Response} res - Responds 202 with what was produced.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 when the plan is not approved; 404 when no slot matches.
 * @sideeffect Generates posts, consumes quota, sends DMs.
 */
router.post('/:id/generate', async (req, res) => {
  const plan = await loadOwnedPlan({
    planId: req.params.id,
    userId: req.user._id,
    requireApproved: true,
  });

  const requestedIndex = Number(req.body?.dayIndex);

  const slot = Number.isFinite(requestedIndex)
    ? plan.days.find((s) => s.dayIndex === requestedIndex)
    : plan.nextPendingSlot();

  if (!slot) {
    throw ApiError.notFound(
      Number.isFinite(requestedIndex)
        ? `No slot ${requestedIndex} in this plan.`
        : 'This plan has no pending slots left.',
    );
  }

  // Imported here rather than at the top: `generateSlot` pulls in the Discord
  // layer, and a plan-generation request has no need of it.
  const { generateSlot } = await import('../services/planService.js');
  const { generated, skipped } = await generateSlot({ user: req.user, plan, slot });

  res.status(202).json({
    dayIndex: slot.dayIndex,
    generated: generated.map((post) => post.toPublicJSON()),
    skipped,
  });
});

/**
 * DELETE /api/plans/:id — archives a plan. The record is retained.
 *
 * WHY ARCHIVE RATHER THAN DELETE: the posts it produced and the
 * `GenerationLog` rows they generated are the evidence for the cost report.
 * Deleting the plan would orphan both.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the archived plan.
 * @returns {Promise<void>}
 * @sideeffect Writes the plan's status.
 */
router.delete('/:id', async (req, res) => {
  const plan = await loadOwnedPlan({ planId: req.params.id, userId: req.user._id });

  plan.status = PLAN_STATUS.ARCHIVED;
  await plan.save();

  res.json({ plan: plan.toPublicJSON() });
});

export { VALID_PLAN_DURATIONS, PLATFORMS };
export default router;
