/**
 * Admin routes — everything behind the admin role.
 *
 * RESPONSIBILITY
 *   Let an administrator create coupons, switch them off, read the feedback users
 *   send, and settle the payment claims customers submit.
 *
 * WHY THIS IS A SEPARATE ROUTER WITH `requireAdmin` ON THE ROUTER
 *   Every route here is administrative, so unlike `authRoutes` there is no
 *   public endpoint mixed in — the guard goes on once, at the top, where it
 *   cannot be forgotten for a route added later. `requireAdmin` must follow
 *   `requireAuth`, which is what puts the freshly-read user on the request.
 *
 * DOES NOT OWN: what a coupon grants (`services/couponService.js`), what settling
 * a payment writes (`services/paymentService.js`), or who is an admin (the `User`
 * document, set by hand with `npm run make-admin`).
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';

import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { COUPON_KIND, PAYMENT_DECISION } from '../config/constants.js';
import { Feedback, FEEDBACK_STATUS } from '../models/Feedback.js';
import { createCoupon, listCoupons, setCouponActive } from '../services/couponService.js';
import { PAYMENT_QUEUE_FILTER, listPayments, reviewPayment } from '../services/paymentService.js';
import { activeTier } from '../services/quotaService.js';

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

/**
 * The payment queue's filter.
 *
 * Validated against the service's own map rather than a repeated list, so a
 * filter the route accepts is always one the query understands. The default is
 * `awaiting` — the rows that still need an operator — because a queue that opens
 * on settled history is a queue nobody reads.
 */
const listPaymentsQuerySchema = z.object({
  status: z.enum(Object.keys(PAYMENT_QUEUE_FILTER)).optional().default('awaiting'),
});

/**
 * A decision on a claim.
 *
 * Four values because a claim has two shapes: one that granted a plan can be
 * confirmed or revoked, one that granted nothing can be verified or rejected.
 * The service refuses a decision that does not match the claim's state, so this
 * schema checks the vocabulary and not the fit.
 */
const reviewPaymentSchema = z.object({
  decision: z.enum(Object.values(PAYMENT_DECISION)),
  note: z.string().trim().max(300).optional().default(''),
});

/**
 * GET /api/admin/payments — claims to reconcile, or the settled history.
 *
 * @param {import('express').Request} req - Validated query.
 * @param {import('express').Response} res - Responds 200 with the claims.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
router.get('/payments', validateQuery(listPaymentsQuerySchema), async (req, res) => {
  const payments = await listPayments({ status: req.validatedQuery.status });
  res.json({ payments: payments.map((payment) => payment.toAdminJSON()) });
});

/**
 * PATCH /api/admin/payments/:id — settles a claim.
 *
 * The account half of the response is what the operator's toast reports, so
 * confirming a revocation visibly ends access rather than leaving them to check
 * the customer's page.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 200 with the claim and account.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when there is no such claim, 409 when the decision does
 *   not fit its state.
 * @sideeffect Writes the claim, and the account for verify or revoke.
 */
router.patch('/payments/:id', validateBody(reviewPaymentSchema), async (req, res) => {
  const { payment, user } = await reviewPayment({
    paymentId: req.params.id,
    decision: req.body.decision,
    reviewedBy: req.user._id,
    note: req.body.note,
  });

  res.json({
    payment: payment.toAdminJSON(),
    // Null when the decision did not touch the account — a confirm or reject
    // changes nothing about what the customer can do.
    account: user
      ? { plan: activeTier(user), planExpiresAt: user.planExpiresAt }
      : null,
  });
});

/** Feedback update payload. */
const updateFeedbackSchema = z.object({
  status: z.enum(Object.values(FEEDBACK_STATUS)),
  adminNote: z.string().trim().max(500).optional().default(''),
});

/**
 * GET /api/admin/feedback — every message, newest first.
 *
 * Capped rather than paged: this is an academic deployment's inbox, and a cap
 * that is visible in the response is more honest than a "load more" that never
 * gets built.
 */
router.get('/feedback', async (req, res) => {
  const rows = await Feedback.find().sort({ createdAt: -1 }).limit(200);
  res.json({ feedback: rows.map((row) => row.toPublicJSON()) });
});

/**
 * PATCH /api/admin/feedback/:id — moves a message through the reading workflow.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 200 with the message.
 * @returns {Promise<void>}
 * @throws {ApiError} 404 when there is no such message.
 * @sideeffect Updates a feedback document.
 */
router.patch('/feedback/:id', validateBody(updateFeedbackSchema), async (req, res) => {
  // Guarded before the query for the same reason as the coupon toggle: a
  // malformed id makes Mongoose throw, and a 500 is the wrong answer for a bad
  // reference.
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: 'NotFound', message: 'No such message.' });
    return;
  }

  const feedback = await Feedback.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status, adminNote: req.body.adminNote },
    { new: true },
  );

  if (!feedback) {
    res.status(404).json({ error: 'NotFound', message: 'No such message.' });
    return;
  }

  res.json({ feedback: feedback.toPublicJSON() });
});

export default router;