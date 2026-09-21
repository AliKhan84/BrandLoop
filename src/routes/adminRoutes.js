/**
 * Admin routes — everything behind the admin role.
 *
 * RESPONSIBILITY
 *   Let an administrator create coupons, switch them off, and (Phase 4) read
 *   the feedback users send.
 *
 * WHY THIS IS A SEPARATE ROUTER WITH `requireAdmin` ON THE ROUTER
 *   Every route here is administrative, so unlike `authRoutes` there is no
 *   public endpoint mixed in — the guard goes on once, at the top, where it
 *   cannot be forgotten for a route added later. `requireAdmin` must follow
 *   `requireAuth`, which is what puts the freshly-read user on the request.
 *
 * DOES NOT OWN: what a coupon grants (`services/couponService.js`) or who is an
 * admin (the `User` document, set by hand with `npm run make-admin`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { COUPON_KIND } from '../config/constants.js';
import { createCoupon, listCoupons, setCouponActive } from '../services/couponService.js';

const router = Router();

// Order matters: the role is read from the user `requireAuth` loads.
router.use(requireAuth, requireAdmin);

/**
 * Coupon creation payload.
 *
 * A null `durationDays` or `maxRedemptions` is meaningful — it means "forever"
 * and "no cap" respectively — so both must be explicitly nullable rather than
 * merely optional. An omitted field defaults to the safe reading.
 */
const createCouponSchema = z.object({
  code: z.string().trim().max(32).optional(),
  kind: z.enum(Object.values(COUPON_KIND)).optional().default(COUPON_KIND.PRO),
  durationDays: z.number().int().positive().nullable().optional().default(null),
  maxRedemptions: z.number().int().positive().nullable().optional().default(null),
  expiresAt: z.coerce.date().nullable().optional().default(null),
  note: z.string().trim().max(200).optional().default(''),
});

/** Coupon update payload. */
const updateCouponSchema = z.object({
  isActive: z.boolean(),
});

/** GET /api/admin/coupons — every coupon, newest first. */
router.get('/coupons', async (req, res) => {
  const coupons = await listCoupons({});
  res.json({ coupons: coupons.map((coupon) => coupon.toPublicJSON()) });
});

/**
 * POST /api/admin/coupons — creates a coupon.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 201 with the coupon.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 when the chosen code already exists.
 * @sideeffect Writes a coupon document.
 */
router.post('/coupons', validateBody(createCouponSchema), async (req, res) => {
  const coupon = await createCoupon({ ...req.body, createdBy: req.user._id });
  res.status(201).json({ coupon: coupon.toPublicJSON() });
});

/**
 * PATCH /api/admin/coupons/:id — enables or disables a coupon.
 *
 * Deactivation rather than deletion, so the record of who redeemed what stays
 * intact.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 200 with the coupon.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when there is no such coupon.
 * @sideeffect Updates a coupon document.
 */
router.patch('/coupons/:id', validateBody(updateCouponSchema), async (req, res) => {
  const coupon = await setCouponActive({
    couponId: req.params.id,
    isActive: req.body.isActive,
  });
  res.json({ coupon: coupon.toPublicJSON() });
});

export default router;
