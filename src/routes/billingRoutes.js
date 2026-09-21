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
 * DOES NOT OWN: the limits themselves (`config/constants.js`) or any payment —
 * there is no checkout in this build, by design.
 */

import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { PLANS } from '../config/constants.js';
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

  res.json({
    plans: Object.values(PLANS).map((plan) => ({
      tier: plan.tier,
      name: plan.name,
      price: plan.price,
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
  });
});

export default router;
