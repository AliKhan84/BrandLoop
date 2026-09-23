/**
 * Payments — buying a plan locally, and reconciling the claim afterwards.
 *
 * RESPONSIBILITY
 *   Decide whether a purchase may be made, record the claim, apply the grant, and
 *   let an operator settle the claim once they have seen their own statement.
 *
 * ## The design decision this file exists to carry out
 *
 *   A customer who pays and is then told to wait for a human is a customer who
 *   has already left. So by default the plan is granted in the same request that
 *   records the claim (`PAYMENT_AUTO_VERIFY`), and the operator's job moves
 *   *behind* the customer: confirm the money arrived, or revoke.
 *
 *   That is only defensible because the grant is reversible. Every grant stores
 *   what it replaced, so a revoke restores the account instead of dropping a
 *   paying customer to Free, and an account cannot be granted twice for one
 *   claim. The alternative — a human in front of every purchase — is still here
 *   behind one flag, because it is the right choice the day claims are abused.
 *
 * ## What cannot be automated, and is therefore not pretended
 *
 *   Nothing here confirms that money moved: there is no processor. The reference
 *   the customer types is what the operator matches against their statement, and
 *   `PAYMENT_AUTO_VERIFY=false` exists for anyone who would rather look first.
 *
 * DOES NOT OWN: the claim schema (`models/Payment.js`), the grant arithmetic
 * (`services/grantService.js`), or the notification (`discord/paymentQueue.js`).
 */

import mongoose from 'mongoose';

import {
  PAYMENT_DECISION,
  PAYMENT_METHOD,
  PAYMENT_METHOD_LABELS,
  PAYMENT_REVIEW_HOURS,
  PAYMENT_STATUS,
  PLANS,
  PURCHASABLE_TIERS,
  TIER_RANK,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { Payment } from '../models/Payment.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { computeTierGrant, restorePreviousGrant } from './grantService.js';
import { activeTier } from './quotaService.js';

/**
 * The status filters the queue understands.
 *
 * `awaiting` is not a status: it is the pair of pending shapes an operator still
 * has to act on, which is the only question the queue is asked by default.
 */
export const PAYMENT_QUEUE_FILTER = Object.freeze({
  awaiting: { status: PAYMENT_STATUS.PENDING },
  verified: { status: PAYMENT_STATUS.VERIFIED },
  rejected: { status: PAYMENT_STATUS.REJECTED },
  revoked: { status: PAYMENT_STATUS.REVOKED },
  all: {},
});

/**
 * Builds the "where to send the money" list from the configured accounts.
 *
 * Only what the operator has actually filled in appears: an option that cannot
 * receive money is worse than one that is absent.
 *
 * @param {object} [accounts] - The account details, from the environment.
 * @param {string} [accounts.bankName] - The bank, e.g. "Meezan Bank".
 * @param {string} [accounts.bankAccountName] - The account holder's name.
 * @param {string} [accounts.bankAccountNumber] - The account number or IBAN.
 * @param {string} [accounts.jazzcashNumber] - The JazzCash wallet number.
 * @param {string} [accounts.easypaisaNumber] - The Easypaisa wallet number.
 * @returns {Array<{id: string, label: string, account: string, detail: string, hint: string}>}
 *   The methods, in a stable order.
 * @sideeffect none (pure)
 */
export function buildPaymentMethods({
  bankName = '',
  bankAccountName = '',
  bankAccountNumber = '',
  jazzcashNumber = '',
  easypaisaNumber = '',
} = {}) {
  const methods = [];

  if (bankAccountNumber) {
    methods.push({
      id: PAYMENT_METHOD.BANK,
      label: PAYMENT_METHOD_LABELS[PAYMENT_METHOD.BANK],
      account: bankAccountNumber,
      detail: [bankName, bankAccountName].filter(Boolean).join(' · '),
      hint: 'Transfer to this account, or send it from your own bank app with Raast. Keep the transaction ID.',
    });
  }

  if (jazzcashNumber) {
    methods.push({
      id: PAYMENT_METHOD.JAZZCASH,
      label: PAYMENT_METHOD_LABELS[PAYMENT_METHOD.JAZZCASH],
      account: jazzcashNumber,
      detail: bankAccountName,
      hint: 'Send Money to this number, then copy the transaction ID from your JazzCash message.',
    });
  }

  if (easypaisaNumber) {
    methods.push({
      id: PAYMENT_METHOD.EASYPAISA,
      label: PAYMENT_METHOD_LABELS[PAYMENT_METHOD.EASYPAISA],
      account: easypaisaNumber,
      detail: bankAccountName,
      hint: 'Send Money to this number, then copy the transaction ID from your Easypaisa message.',
    });
  }

  return methods;
}

/**
 * Where a tier sits in the order, cheapest first.
 *
 * @param {string} tier - A tier from `PLAN_TIER`.
 * @returns {number} Its position, or -1 when it is not a tier at all.
 * @sideeffect none (pure)
 */
function rankOf(tier) {
  return TIER_RANK.indexOf(tier);
}

/**
 * Whether a tier can be bought at all.
 *
 * @param {string} tier - A tier from `PLAN_TIER`.
 * @returns {boolean} True for the paid tiers only.
 * @sideeffect none (pure)
 */
export function isPurchasableTier(tier) {
  return PURCHASABLE_TIERS.includes(tier);
}

/**
 * Whether this tier is a legitimate purchase for this account.
 *
 * A downgrade is refused rather than sold: the plan field holds one tier with
 * one expiry, so buying a cheaper tier while a more expensive one is running
 * would delete days the customer already paid for. Doing that silently is the
 * one outcome worth blocking outright — support can arrange a downgrade by hand
 * if someone genuinely wants one.
 *
 * The comparison is against the *effective* tier, so an account whose Pro has
 * lapsed is free again and may buy anything.
 *
 * @param {object} params
 * @param {string} params.tier - What is being bought.
 * @param {object|null} params.user - The account.
 * @param {Date} [params.now] - Reference time.
 * @returns {{ok: boolean, reason?: string}} The verdict.
 * @sideeffect none (pure)
 */
export function purchasability({ tier, user, now = new Date() }) {
  if (rankOf(tier) === -1) return { ok: false, reason: 'unknown-tier' };
  if (!isPurchasableTier(tier)) return { ok: false, reason: 'free-tier' };

  const current = activeTier(user, now);
  if (rankOf(tier) < rankOf(current)) return { ok: false, reason: 'downgrade' };

  return { ok: true };
}

/**
 * Whether a claim may grant without a human looking first.
 *
 * @param {object} params
 * @param {number} params.amountPkr - What the claim is for.
 * @param {boolean} [params.autoVerify] - The operator's switch.
 * @param {number} [params.autoVerifyMaxPkr] - The ceiling auto-verification applies under.
 * @returns {boolean} True when the plan should be granted at submit time.
 * @sideeffect none (pure)
 */
export function autoVerifyEligible({
  amountPkr,
  autoVerify = true,
  autoVerifyMaxPkr = Infinity,
}) {
  if (!autoVerify) return false;
  return Number(amountPkr) <= autoVerifyMaxPkr;
}

/**
 * Everything the pay page needs: what can be bought, and where to send money.
 *
 * @returns {object} The options, safe to send to a signed-in customer.
 * @sideeffect none (read-only)
 */
export function getPaymentOptions() {
  return {
    enabled: env.PAYMENTS_ENABLED,
    /** Whether any account is configured. False explains an empty method list. */
    configured: env.PAYMENTS_CONFIGURED,
    autoVerify: env.PAYMENT_AUTO_VERIFY,
    reviewHours: PAYMENT_REVIEW_HOURS,
    contact: env.PAYMENT_CONTACT || '',
    notes: env.PAYMENT_NOTES || '',
    methods: buildPaymentMethods({
      bankName: env.PAYMENT_BANK_NAME,
      bankAccountName: env.PAYMENT_BANK_ACCOUNT_NAME,
      bankAccountNumber: env.PAYMENT_BANK_ACCOUNT_NUMBER,
      jazzcashNumber: env.PAYMENT_JAZZCASH_NUMBER,
      easypaisaNumber: env.PAYMENT_EASYPAISA_NUMBER,
    }),
    plans: PURCHASABLE_TIERS.map((tier) => ({
      tier,
      name: PLANS[tier].name,
      pricePkr: PLANS[tier].pricePkr,
      durationDays: PLANS[tier].durationDays,
    })),
  };
}

/**
 * The refusal for a decision that no longer fits the claim.
 *
 * WHY THIS EXISTS: a claim is settled from two surfaces (a DM and the admin page)
 * and by more than one person, so losing that race is normal. The message says
 * both what the row is now and which decisions it would accept, because "conflict"
 * on its own leaves the operator guessing.
 *
 * @param {object} payment - The claim as it stands.
 * @param {string} decision - What was attempted.
 * @returns {import('../utils/ApiError.js').ApiError} A 409 describing the mismatch.
 * @sideeffect none (pure)
 */
function conflictFor(payment, decision) {
  const settled = payment.status !== PAYMENT_STATUS.PENDING;

  if (settled) {
    return ApiError.conflict(
      `That payment has already been settled as ${payment.status}, so "${decision}" no longer applies.`,
    );
  }

  return ApiError.conflict(
    payment.grantedAt
      ? 'That payment already granted a plan — confirm it, or revoke it if the money is not there.'
      : 'That payment has not granted anything yet — verify it to grant the plan, or reject it.',
  );
}

/**
 * Applies a claim's grant to an account, at most once.
 *
 * The order is deliberate: the claim on the payment row is taken *before* the
 * account is written, because the claim is the thing that must happen once. If
 * the write then fails, the claim is released rather than left looking granted —
 * a row that says "granted" while the account holds nothing is the failure that
 * looks settled and is never looked at again.
 *
 * @param {object} params
 * @param {object} params.payment - The claim.
 * @param {object} params.user - The account to write.
 * @param {boolean} [params.autoVerified] - Whether a human looked first.
 * @param {string|null} [params.reviewedBy] - The operator, when there was one.
 * @param {Date} [params.now] - Reference time.
 * @returns {Promise<{payment: object, user: object, grant: object}|null>} The
 *   updated claim and account, or null when another path got there first.
 * @sideeffect Writes the claim and the account.
 */
async function applyGrant({ payment, user, autoVerified = false, reviewedBy = null, now = new Date() }) {
  const grant = computeTierGrant({
    tier: payment.tier,
    durationDays: payment.durationDays,
    user,
    now,
  });

  const claimed = await Payment.claimGrant({
    paymentId: payment._id,
    plan: grant.plan,
    until: grant.planExpiresAt,
    // The state before the grant, so a revoke can put it back exactly.
    previousPlan: user.plan ?? null,
    previousPlanExpiresAt: user.planExpiresAt ?? null,
    autoVerified,
    reviewedBy,
    now,
  });

  if (!claimed) return null;

  try {
    Object.assign(user, grant);
    await user.save();
  } catch (err) {
    await Payment.releaseGrantClaim({ paymentId: payment._id });
    throw err;
  }

  return { payment: claimed, user, grant };
}

/**
 * Records a purchase claim, and grants it when the instant path applies.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId - The buyer.
 * @param {string} params.tier - What is being bought.
 * @param {string} params.method - Which channel the money went through.
 * @param {string} params.reference - The transaction id the customer was given.
 * @param {string} [params.note] - Anything else they said.
 * @returns {Promise<{payment: object, user: object, notified: object}>} The claim,
 *   the account as it now stands, and what the admin notice did.
 * @throws {ApiError} 400 when payments are off or the method is not offered, 409
 *   for a downgrade or an unsettled claim.
 * @sideeffect Writes a claim, possibly the account, and sends DMs.
 */
export async function createPayment({ userId, tier, method, reference, note = '' }) {
  const options = getPaymentOptions();

  if (!options.enabled) {
    throw ApiError.badRequest('Payments are not set up on this deployment yet.');
  }

  // Checked against the configured list, not the enum: choosing a wallet the
  // operator never filled in would produce a claim nobody can reconcile.
  if (!options.methods.some((option) => option.id === method)) {
    throw ApiError.badRequest('Choose one of the payment methods shown on this page.');
  }

  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');

  const verdict = purchasability({ tier, user });
  if (!verdict.ok) {
    if (verdict.reason === 'downgrade') {
      throw ApiError.conflict(
        `You are on ${PLANS[activeTier(user)]?.name ?? 'a higher plan'} until ` +
          `${user.planExpiresAt ? user.planExpiresAt.toISOString().slice(0, 10) : 'further notice'}. ` +
          'A cheaper plan would cut that short, so it is not sold here — get in touch and we will sort it out.',
      );
    }
    throw ApiError.badRequest('That plan cannot be bought.');
  }

  // One unreconciled claim at a time. This is what keeps the exposure of
  // granting on submit bounded: at most one plan period is at risk per account,
  // and the queue cannot be flooded by a single user.
  const openClaim = await Payment.exists({ userId, status: PAYMENT_STATUS.PENDING });
  if (openClaim) {
    throw ApiError.conflict(
      'Your previous payment is still being confirmed. Send another one once it has cleared.',
    );
  }

  const plan = PLANS[tier];
  const payment = await Payment.create({
    userId,
    tier,
    method,
    reference,
    note,
    // Snapshotted, so a later price or term change cannot rewrite what this
    // claim was for.
    amountPkr: plan.pricePkr,
    durationDays: plan.durationDays,
  });

  logger.info(
    `payment: ${user.email} submitted ${payment.tier} for Rs ${payment.amountPkr} via ` +
      `${payment.method} (ref ${payment.reference})`,
  );

  let account = user;
  let granted = null;

  if (
    autoVerifyEligible({
      amountPkr: payment.amountPkr,
      autoVerify: env.PAYMENT_AUTO_VERIFY,
      autoVerifyMaxPkr: env.PAYMENT_AUTO_VERIFY_MAX_PKR,
    })
  ) {
    try {
      granted = await applyGrant({ payment, user, autoVerified: true });
    } catch (err) {
      // The claim stays a clean pending one and the operator is told, so the
      // customer is never left with a confirmation for something they did not
      // get — and never silently charged.
      logger.error(
        `payment: instant grant failed for claim ${payment._id}; it stays pending for manual verification`,
        err,
      );
    }
  }

  if (granted) {
    payment.grantedAt = granted.payment.grantedAt;
    payment.grantedPlan = granted.payment.grantedPlan;
    payment.grantedUntil = granted.payment.grantedUntil;
    account = granted.user;

    logger.info(
      `payment: ${user.email} → ${granted.grant.plan} until ` +
        `${granted.grant.planExpiresAt ? granted.grant.planExpiresAt.toISOString() : 'forever'} ` +
        '(granted on submit, awaiting reconciliation)',
    );
  }

  // Imported lazily: this service is imported by the routes, and the Discord
  // module pulls in the gateway client — a cycle worth avoiding for a function
  // that only ever runs on a submitted claim.
  const { notifyAdminsOfPayment } = await import('./discord/paymentQueue.js');
  const notified = await notifyAdminsOfPayment(payment, account);

  return { payment, user: account, notified };
}

/**
 * One customer's own claims, newest first.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId - The owner.
 * @param {number} [params.limit=20] - Maximum rows.
 * @returns {Promise<object[]>} The claims.
 * @sideeffect none (read-only)
 */
export async function listUserPayments({ userId, limit = 20 }) {
  return Payment.find({ userId }).sort({ createdAt: -1 }).limit(limit);
}

/**
 * The operator's queue, with the account attached.
 *
 * @param {object} [params]
 * @param {string} [params.status='awaiting'] - A key of `PAYMENT_QUEUE_FILTER`.
 * @param {number} [params.limit=100] - Maximum rows.
 * @returns {Promise<object[]>} The claims, each with its account populated.
 * @sideeffect none (read-only)
 */
export async function listPayments({ status = 'awaiting', limit = 100 } = {}) {
  const filter = PAYMENT_QUEUE_FILTER[status] ?? PAYMENT_QUEUE_FILTER.awaiting;

  const query = Payment.find(filter).populate('userId', 'email name plan planExpiresAt');

  if (status === 'awaiting') {
    // Granted claims first: those are money already given away, so not looking
    // costs something. Then oldest first, because customers are waiting in the
    // order they arrived.
    query.sort({ grantedAt: -1, createdAt: 1 });
  } else {
    query.sort({ createdAt: -1 });
  }

  return query.limit(limit);
}

/**
 * Settles a claim.
 *
 * @param {object} params
 * @param {string} params.paymentId - The claim.
 * @param {string} params.decision - One of `PAYMENT_DECISION`.
 * @param {string|import('mongoose').Types.ObjectId} params.reviewedBy - The operator.
 * @param {string} [params.note] - Reason, shown to the customer on a rejection or revoke.
 * @returns {Promise<{payment: object, user: object|null, grant: object|null}>} The
 *   settled claim, and the account when the decision touched it.
 * @throws {ApiError} 404 for an unknown claim, 409 when the decision does not fit
 *   the claim's state.
 * @sideeffect Writes the claim, and the account for verify or revoke.
 */
export async function reviewPayment({ paymentId, decision, reviewedBy, note = '' }) {
  // Checked before the query: a malformed id makes Mongoose throw a CastError,
  // which the error handler would report as a 500 for what is a bad reference.
  if (!mongoose.isValidObjectId(paymentId)) throw ApiError.notFound('No such payment.');

  const payment = await Payment.findById(paymentId);
  if (!payment) throw ApiError.notFound('No such payment.');

  if (decision === PAYMENT_DECISION.CONFIRM) {
    const claimed = await Payment.claimConfirm({ paymentId, reviewedBy, note });
    if (!claimed) throw conflictFor(payment, decision);

    logger.info(`payment: ${claimed._id} confirmed by ${reviewedBy} (Rs ${claimed.amountPkr})`);
    return { payment: claimed, user: null, grant: null };
  }

  if (decision === PAYMENT_DECISION.REJECT) {
    const claimed = await Payment.claimReject({ paymentId, reviewedBy, note });
    if (!claimed) throw conflictFor(payment, decision);

    logger.info(`payment: ${claimed._id} rejected by ${reviewedBy} — no plan was granted`);
    return { payment: claimed, user: null, grant: null };
  }

  const user = await User.findById(payment.userId);
  if (!user) throw ApiError.notFound('The account for that payment no longer exists.');

  if (decision === PAYMENT_DECISION.VERIFY) {
    const applied = await applyGrant({ payment, user, autoVerified: false, reviewedBy });
    if (!applied) throw conflictFor(payment, decision);

    logger.info(
      `payment: ${applied.user.email} → ${applied.grant.plan} until ` +
        `${applied.grant.planExpiresAt ? applied.grant.planExpiresAt.toISOString() : 'forever'} ` +
        `(verified by ${reviewedBy})`,
    );

    return { payment: applied.payment, user: applied.user, grant: applied.grant };
  }

  if (decision === PAYMENT_DECISION.REVOKE) {
    const restored = restorePreviousGrant({ payment, user });

    if (restored.refused) {
      // The snapshot is stale: something has moved this account on since, and
      // writing it back would take away days bought afterwards.
      throw ApiError.conflict(
        'This plan has been extended by a newer purchase since that payment, so it cannot be rolled ' +
          'back automatically. Adjust the account by hand so the customer keeps what they paid for.',
      );
    }

    // The decision is claimed before the account is written, so two admins
    // revoking at once cannot both roll the account back.
    const claimed = await Payment.claimRevoke({ paymentId, reviewedBy, note });
    if (!claimed) throw conflictFor(payment, decision);

    Object.assign(user, restored);
    try {
      await user.save();
    } catch (err) {
      // Put the claim back in the queue rather than leaving it marked revoked
      // while the plan is still live — the account must not lose access silently.
      await Payment.releaseReview({ paymentId });
      throw err;
    }

    logger.warn(
      `payment: ${claimed._id} revoked by ${reviewedBy} — ${user.email} returned to ` +
        `${restored.plan}${restored.planExpiresAt ? ` until ${restored.planExpiresAt.toISOString()}` : ''}`,
    );

    return { payment: claimed, user, grant: restored };
  }

  throw ApiError.badRequest(`Unknown decision "${decision}".`);
}

export default {
  PAYMENT_QUEUE_FILTER,
  buildPaymentMethods,
  isPurchasableTier,
  purchasability,
  autoVerifyEligible,
  getPaymentOptions,
  createPayment,
  listUserPayments,
  listPayments,
  reviewPayment,
};
