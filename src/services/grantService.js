/**
 * Grants — the arithmetic that turns "something was paid for" into fields on a user.
 *
 * RESPONSIBILITY
 *   Compute the plan fields a grant should write: the Pro or unlimited period a
 *   coupon gives, the tier a purchase buys, and the state a revoked purchase
 *   must be put back to. No database here, so every rule that decides who gets
 *   what is testable exactly.
 *
 * ## Why this is not inside the two services that use it
 *
 *   `couponService` redeems codes and `paymentService` settles purchases; both
 *   end in the same act — move or extend a plan on an account. Keeping the
 *   arithmetic in one place means the two cannot drift, and the rule that
 *   matters most ("never shorten a period already paid for") is written once and
 *   pinned by one set of tests.
 *
 * ## Why extending is the default, and what is not allowed to reach here
 *
 *   A renewal and an upgrade both keep the days the account already has: an
 *   account with Creator until the 20th that buys Pro for 30 days should end on
 *   the 20th + 30, not lose the 20 days it already paid for. The one move that
 *   *removes* paid-for time is a downgrade, and that is refused before it gets
 *   here (`paymentService.purchasability`), not silently allowed.
 *
 * ## Why a revoke compares timestamps
 *
 *   Revoking restores the state a claim replaced. If a newer grant has landed
 *   since, that snapshot is stale and restoring it would delete days the user
 *   paid for a second time — so the revoke is refused instead, and a human
 *   decides. See `restorePreviousGrant`.
 *
 * DOES NOT OWN: when a grant is allowed (`couponService`, `paymentService`),
 * what a limit means (`quotaService.js`), or the fields themselves
 * (`models/User.js`).
 */

import { COUPON_KIND, PLAN_TIER } from '../config/constants.js';

/** One day in milliseconds. The unit every grant duration is expressed in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Continues an existing period rather than overwriting it.
 *
 * A date in the past is not extended — a lapsed period must never push the new
 * one into the past, which would grant nothing while looking like it had.
 *
 * @param {Date|null|undefined} current - The period's current end, if any.
 * @param {Date} now - Reference time.
 * @returns {Date} The base the new period starts from.
 * @sideeffect none (pure)
 */
function extendFrom(current, now) {
  return current && current > now ? current : now;
}

/**
 * Works out the fields a coupon redemption should write onto the user.
 *
 * A `null` duration means the grant never lapses, which is why the plan field
 * carries a `null` expiry rather than a far-future date — an expiry that is not
 * a date should not look like one.
 *
 * @param {object} params
 * @param {object} params.coupon - The redeemed coupon.
 * @param {object|null} [params.user] - The current user, for extension rules.
 * @param {Date} [params.now] - Reference time.
 * @returns {{plan?: string, planExpiresAt?: Date|null, unlimited?: boolean, unlimitedUntil?: Date|null}}
 *   The fields to assign.
 * @sideeffect none (pure)
 */
export function computeCouponGrant({ coupon, user = null, now = new Date() }) {
  const days = coupon.durationDays;
  const milliseconds = days == null ? null : days * DAY_MS;

  if (coupon.kind === COUPON_KIND.UNLIMITED) {
    let unlimitedUntil = null;
    if (milliseconds != null) {
      const base = user?.unlimited ? extendFrom(user.unlimitedUntil, now) : now;
      unlimitedUntil = new Date(base.getTime() + milliseconds);
    }
    return { unlimited: true, unlimitedUntil };
  }

  // Pro. Two ways to already be on Pro: the same tier, or a previous grant that
  // has not lapsed — either way the new days are added to the end.
  const onPro = user?.plan === PLAN_TIER.PRO;
  const base = onPro ? extendFrom(user?.planExpiresAt, now) : now;

  return {
    plan: PLAN_TIER.PRO,
    planExpiresAt: milliseconds == null ? null : new Date(base.getTime() + milliseconds),
  };
}

/**
 * Works out the fields a purchase should write onto the user.
 *
 * The tier is set as purchased; the period starts now, or at the end of the
 * period already running when that is later — so a renewal adds to the term and
 * an upgrade keeps the days it is replacing. A downgrade cannot arrive here.
 *
 * @param {object} params
 * @param {string} params.tier - The purchased tier, from `PLAN_TIER`.
 * @param {number|null} params.durationDays - Days bought; null for no expiry.
 * @param {object|null} [params.user] - The current user, for extension rules.
 * @param {Date} [params.now] - Reference time.
 * @returns {{plan: string, planExpiresAt: Date|null}} The fields to assign.
 * @sideeffect none (pure)
 */
export function computeTierGrant({ tier, durationDays, user = null, now = new Date() }) {
  const base = extendFrom(user?.planExpiresAt, now);

  return {
    plan: tier,
    planExpiresAt: durationDays == null
      ? null
      : new Date(base.getTime() + durationDays * DAY_MS),
  };
}

/**
 * Whether two optional dates describe the same instant.
 *
 * @param {Date|null|undefined} left - First date.
 * @param {Date|null|undefined} right - Second date.
 * @returns {boolean} True when both are absent, or both the same moment.
 * @sideeffect none (pure)
 */
function sameInstant(left, right) {
  const a = left ? new Date(left).getTime() : null;
  const b = right ? new Date(right).getTime() : null;
  return a === b;
}

/**
 * Works out the fields that undo a grant, or refuses because it is too late.
 *
 * WHY THIS REFUSES RATHER THAN GUESSES: the snapshot on the claim is only valid
 * while it is still the newest grant on the account. If a later purchase has
 * moved the plan or the expiry since, restoring the old snapshot would take away
 * days the user bought afterwards. A refusal the operator can read beats a
 * silent subtraction they cannot.
 *
 * @param {object} params
 * @param {object} params.payment - The claim that granted, carrying its snapshot.
 * @param {object|null} [params.user] - The account as it stands now.
 * @returns {{plan: string, planExpiresAt: Date|null}|{refused: string}} The fields
 *   to write, or the reason the revoke must be handled by hand.
 * @sideeffect none (pure)
 */
export function restorePreviousGrant({ payment, user = null }) {
  const grantedPlan = payment?.grantedPlan ?? null;

  // The plan moved: something else has written to the account since this grant.
  if (grantedPlan && user?.plan !== grantedPlan) return { refused: 'superseded' };

  // The expiry moved: a second purchase extended it, so this snapshot is stale.
  if (!sameInstant(payment?.grantedUntil, user?.planExpiresAt)) return { refused: 'superseded' };

  return {
    plan: payment?.previousPlan ?? PLAN_TIER.FREE,
    planExpiresAt: payment?.previousPlanExpiresAt ?? null,
  };
}

export default {
  computeCouponGrant,
  computeTierGrant,
  restorePreviousGrant,
};
