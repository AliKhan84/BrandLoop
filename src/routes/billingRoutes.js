/**
 * Billing routes — the plan catalog, and what the caller is on.
 *
 * RESPONSIBILITY
 *   Tell the dashboard what each tier costs and allows, and which one this
 *   account is actually getting.
 *
 * WHY THE CATALOG IS SERVED RATHER THAN DUPLICATED
 *   The billing page used to hold the numbers as literals in the component. It
 *   claimed to show "the real QUOTA_* defaults" while showing strings nothing
 *   verified — editing `QUOTA_PLAN_GENERATIONS_PER_DAY` changed the enforced
 *   limit and left the page advertising the old one. A price and its limits must
 *   come from one place, and that place is the API that enforces them.
 *
 * WHY THE EFFECTIVE TIER IS REPORTED SEPARATELY FROM THE STORED ONE
 *   A lapsed plan falls back to the free limits the moment it expires, because
 *   that is what `quotaService.resolveLimit` does. Reporting only the stored
 *   value would let the page say "Pro" while the meter counted against free —
 *   the page must be able to say "Pro ended on the 3rd" instead.
 *
 * ## Why the payment summary is here rather than on its own endpoint
 *
 *   Whether a plan can be bought at all decides what the cards *are*: a price to
 *   press, or a label that says checkout is closed. The page would otherwise need
 *   a second request before it could draw a single card — and could draw one
 *   offering a purchase that the second request would then refuse.
 *
 * DOES NOT OWN: the limits themselves (`config/constants.js`) or what a purchase
 * does (`services/paymentService.js`).
 */

import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { PLANS } from '../config/constants.js';
import { getPaymentOptions } from '../services/paymentService.js';
import { activeTier } from '../services/quotaService.js';

const router = Router();

router.use(requireAuth);

/**
 * GET /api/billing — the catalog plus the caller's own position.
 *
 * @param {import('express').Request} req - Authenticated by `requireAuth`.
 * @param {import('express').Response} res - Responds 200 with both halves.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
router.get('/', (req, res) => {
  const user = req.user;
  const effective = activeTier(user);
  const lapsed = Boolean(user.planExpiresAt && user.planExpiresAt <= new Date());
  const payments = getPaymentOptions();

  res.json({
    plans: Object.values(PLANS).map((plan) => ({
      tier: plan.tier,
      name: plan.name,
      price: plan.price,
      // The price actually charged, and the term it buys, so a card quotes the
      // local figures rather than converting the USD one at some imagined rate.
      pricePkr: plan.pricePkr,
      durationDays: plan.durationDays,
      limits: plan.limits,
    })),
    current: {
      /** What the quotas are actually resolved against right now. */
      plan: effective,
      /** What the account is set to, which differs only when it has lapsed. */
      storedPlan: user.plan,
      planExpiresAt: user.planExpiresAt,
      lapsed,
      unlimited: Boolean(user.unlimited),
      unlimitedUntil: user.unlimitedUntil,
      couponCode: user.couponCode,
    },
    payments: {
      enabled: payments.enabled,
      configured: payments.configured,
      autoVerify: payments.autoVerify,
      reviewHours: payments.reviewHours,
      /**
       * Deliberately without the account numbers: this endpoint says whether a
       * purchase is possible, and where to send the money belongs on the page
       * that exists to take one.
       */
      contact: payments.contact,
    },
  });
});

export default router;
