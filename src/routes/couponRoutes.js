/**
 * Coupon routes — the user-facing half of the coupon feature.
 *
 * RESPONSIBILITY
 *   Let a signed-in user redeem a code they were given.
 *
 * WHY REDEMPTION IS NOT UNDER /api/admin
 *   Creating a code is administrative; using one is not. They share a service
 *   and nothing else, so they are separate routers with separate guards — the
 *   alternative would be an admin router with one unguarded route in it, which
 *   is exactly the shape that produced the missing `requireAuth` bug recorded
 *   in `authRoutes.js`.
 *
 * DOES NOT OWN: what the code grants (`services/couponService.js`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { redeemCoupon } from '../services/couponService.js';

const router = Router();

router.use(requireAuth);

/** Redemption payload. */
const redeemSchema = z.object({
  code: z.string().trim().min(3, 'Enter a coupon code.').max(32),
});

/**
 * POST /api/coupons/redeem — applies a code to the caller's account.
 *
 * @param {import('express').Request} req - Validated body carrying the code.
 * @param {import('express').Response} res - Responds 200 with what was granted.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 with a specific reason when the code cannot be used.
 * @sideeffect Writes the grant onto the user and claims the redemption.
 */
router.post('/redeem', validateBody(redeemSchema), async (req, res) => {
  const { coupon, grant, user } = await redeemCoupon({
    code: req.body.code,
    userId: req.user._id,
  });

  res.json({
    redeemed: {
      code: coupon.code,
      kind: coupon.kind,
      durationDays: coupon.durationDays,
    },
    account: {
      plan: user.plan,
      planExpiresAt: grant.planExpiresAt ?? null,
      unlimited: Boolean(grant.unlimited),
      unlimitedUntil: grant.unlimitedUntil ?? null,
    },
  });
});

export default router;
