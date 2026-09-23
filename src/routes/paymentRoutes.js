/**
 * Payment routes — buying a plan locally, and this account's own history.
 *
 * RESPONSIBILITY
 *   Let a signed-in customer see what can be bought and where to send the money,
 *   submit a claim, and read back what happened to their earlier claims.
 *
 * WHY THIS IS NOT UNDER /api/admin
 *   Submitting a claim is the customer's side of the flow; settling one is the
 *   operator's. They share a service and nothing else, so they are separate
 *   routers with separate guards — the same split as coupon redemption, and for
 *   the same reason: an admin router with one public route in it is the shape
 *   that produced the missing `requireAuth` bug recorded in `authRoutes.js`.
 *
 * DOES NOT OWN: whether a purchase is allowed, or what it grants
 * (`services/paymentService.js`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { PAYMENT_METHOD, PURCHASABLE_TIERS } from '../config/constants.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createPayment, getPaymentOptions, listUserPayments } from '../services/paymentService.js';
import { activeTier } from '../services/quotaService.js';

const router = Router();

router.use(requireAuth);

/**
 * Claim submission payload.
 *
 * The reference is required and has a floor of four characters because it is the
 * one field an operator matches against their bank statement: "1" or "paid" is
 * not something anyone can reconcile, and a claim nobody can verify is worse
 * than no claim.
 */
const createPaymentSchema = z.object({
  tier: z.enum([...PURCHASABLE_TIERS]),
  method: z.enum(Object.values(PAYMENT_METHOD)),
  reference: z.string().trim().min(4, 'Enter the transaction ID from your transfer.').max(64),
  note: z.string().trim().max(500).optional().default(''),
});

/**
 * GET /api/payments — where to pay, what it costs, and this account's claims.
 *
 * One request for the whole pay page: the options, the account's position and the
 * history are always wanted together, and separate calls would let the page draw
 * instructions for a deployment whose payments were switched off in between.
 *
 * @param {import('express').Request} req - Authenticated by `requireAuth`.
 * @param {import('express').Response} res - Responds 200 with all three parts.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
router.get('/', async (req, res) => {
  const payments = await listUserPayments({ userId: req.user._id });

  res.json({
    options: getPaymentOptions(),
    account: {
      /**
       * The effective tier, not the stored one — a lapsed plan is free again, and
       * the page decides what may be bought from this.
       */
      plan: activeTier(req.user),
      planExpiresAt: req.user.planExpiresAt,
    },
    payments: payments.map((payment) => payment.toPublicJSON()),
  });
});

/**
 * POST /api/payments — records a claim, and activates the plan when allowed.
 *
 * The account half of the response is what the success message renders: by
 * default the plan is already live by the time this returns, and the customer
 * should be told that rather than told to wait.
 *
 * @param {import('express').Request} req - Authenticated, with a validated body.
 * @param {import('express').Response} res - Responds 201 with the claim and account.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 when payments are off or the method is not offered, 409
 *   for a downgrade or a claim that is still unsettled.
 * @sideeffect Writes a claim, possibly the account, and notifies admins.
 */
router.post('/', validateBody(createPaymentSchema), async (req, res) => {
  const { payment, user } = await createPayment({
    userId: req.user._id,
    ...req.body,
  });

  res.status(201).json({
    payment: payment.toPublicJSON(),
    account: {
      /** What the quotas now resolve against, after any instant grant. */
      plan: activeTier(user),
      planExpiresAt: user.planExpiresAt,
      /** True when this claim is what activated the plan. */
      active: Boolean(payment.grantedAt),
    },
  });
});

export default router;
