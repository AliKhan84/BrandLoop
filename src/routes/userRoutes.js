/**
 * User routes — read and update the current user's brand profile.
 *
 * RESPONSIBILITY
 *   Expose `GET /api/users/me` and `PATCH /api/users/me`.
 *
 * WHY THERE IS NO `GET /api/users/:id`
 *   Every route here operates on `req.userId` from the token. There is no way
 *   to address another user's record, which removes the entire class of
 *   broken-object-level-authorisation bug rather than guarding against it.
 *
 * DOES NOT OWN: quota reporting (`/status` on Discord reads that directly).
 */

import { Router } from 'express';
import { z } from 'zod';

import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { getUsageSummary } from '../services/quotaService.js';
import { PLATFORMS } from '../config/constants.js';

const router = Router();

// Every route below requires a valid token.
router.use(requireAuth);

/**
 * Profile update payload.
 *
 * Every field is `.optional()`, which is what makes this a PATCH rather than a
 * PUT: an omitted field is left alone instead of being rejected or reset.
 *
 * WHY THE `.optional()`s ARE LOAD-BEARING
 *   Zod requires every key on an object schema unless it is marked optional, so
 *   without them a PATCH carrying any subset of the fields fails validation for
 *   every field it left out. The dashboard sends four of these nine, so every
 *   profile save returned 400 with five "expected ..., received undefined"
 *   errors — and because the failure named fields the user had not touched, it
 *   surfaced as "Please fix the highlighted fields" next to a form that was
 *   already correct. The handler below already did the right thing; only this
 *   schema disagreed with it.
 */
const updateSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    niche: z.string().trim().max(200).optional(),
    inputPoints: z.array(z.string().trim().min(1)).max(20).optional(),
    postFrequency: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    defaultPlanDuration: z.union([z.literal(7), z.literal(30)]).optional(),
    platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
    autoRenewPlan: z.boolean().optional(),
    isActive: z.boolean().optional(),
    timezone: z.string().trim().max(60).optional(),
  })
  // Reject an empty body outright. Silently accepting it would look like a
  // successful save while changing nothing. This is still reachable now that
  // every field is optional — that is exactly the case it exists to catch.
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Provide at least one field to update.',
  });

/**
 * GET /api/users/me — the current user's profile.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the public user.
 * @returns {void}
 * @sideeffect none
 */
router.get('/me', (req, res) => {
  res.json({ user: req.user.toPublicJSON() });
});

/**
 * GET /api/users/me/usage — quota state for the signed-in user.
 *
 * WHY THIS EXISTS: until now the quota counters were only reachable through the
 * Discord `/status` command. The dashboard needs them because the free tier
 * allows 20 requests per day per model — low enough that a user hits the ceiling
 * in ordinary use. Without this, an exhausted quota can only be reported as a
 * failure after the fact; with it, the header shows what is left before the user
 * commits to spending it.
 *
 * Read-only and derived entirely from counters that are already being written,
 * so it adds no cost and no new state.
 *
 * @param {import('express').Request} req - Requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the usage summary.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
router.get('/me/usage', async (req, res) => {
  // The user is passed through so the summary reflects their tier and any
  // unlimited grant, rather than the deployment-wide defaults.
  const usage = await getUsageSummary({ userId: req.user._id, user: req.user });
  res.json({ usage });
});

/**
 * PATCH /api/users/me — updates profile fields.
 *
 * @param {import('express').Request} req - Validated body, requires `req.user`.
 * @param {import('express').Response} res - Responds 200 with the updated user.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 when the body is empty or a field is invalid.
 * @sideeffect Writes the user document.
 */
router.patch('/me', validateBody(updateSchema), async (req, res) => {
  // Assign only the keys the client actually sent, so a PATCH cannot blank a
  // field it did not mention.
  for (const [key, value] of Object.entries(req.body)) {
    req.user[key] = value;
  }

  await req.user.save();

  res.json({ user: req.user.toPublicJSON() });
});

export default router;
