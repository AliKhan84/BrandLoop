/**
 * Payment model — one claim that money was sent, and the single decision on it.
 *
 * RESPONSIBILITY
 *   Record what a customer says they paid, what that bought, and how the claim
 *   was settled. The product effect lives on the `User` (plan and expiry); this
 *   document is the reason it can be trusted, refunded or reversed.
 *
 * ## Why every transition is one atomic findOneAndUpdate
 *
 *   A claim is acted on by a human reading their own bank statement, and there
 *   are three ways to act on the same row at once: two admins, an admin pressing
 *   Confirm in Discord and in the dashboard, the dashboard and a retry after a
 *   slow response. Reading the status and then writing it back would let two of
 *   those both pass, and — for a grant — a single payment would buy two months.
 *   Every precondition therefore sits *in the query*: the loser of a race gets
 *   `null` rather than a second write. Nothing here throws on a lost race,
 *   because losing one is normal, not exceptional.
 *
 * ## Why the state that preceded a grant is stored on the claim
 *
 *   This build grants access on submit and reconciles afterwards
 *   (`PAYMENT_AUTO_VERIFY`), which is only safe because the grant is reversible:
 *   `previousPlan` and `previousPlanExpiresAt` are captured *before* the plan is
 *   moved, so a revoke can put the account back exactly as it was instead of
 *   dumping a paying customer on Free. `grantService.restorePreviousGrant`
 *   refuses to use the snapshot once a newer grant has moved the account on.
 *
 * ## Why there is one review note rather than one per decision
 *
 *   Confirm, reject and revoke all mean "the operator's reason", and `status`
 *   already says which of them happened. A field per decision would leave two of
 *   them empty in every row and invite reading the wrong one.
 *
 * DOES NOT OWN: whether a claim may be made (`services/paymentService.js`), what
 * a tier is worth (`config/constants.js`), or how a grant is computed
 * (`services/grantService.js`).
 */

import mongoose from 'mongoose';

import {
  PAYMENT_METHOD,
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  PLANS,
  PLAN_TIER,
  PURCHASABLE_TIERS,
} from '../config/constants.js';

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    /** Who claims to have paid. Indexed through the compound index below. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * What was bought. Only the purchasable tiers: Free is the absence of a
     * purchase, not a product, so it cannot be the subject of a claim.
     */
    tier: {
      type: String,
      required: true,
      enum: [...PURCHASABLE_TIERS],
    },

    /**
     * Days bought, copied from the catalog at claim time.
     *
     * Copied rather than read at grant time: the operator's plan length is a
     * commercial setting, and shortening it later must not silently shorten what
     * an existing claim pays for.
     */
    durationDays: {
      type: Number,
      required: true,
      min: 1,
    },

    /**
     * What it cost, in PKR, copied from the catalog at claim time.
     *
     * The same rule as `durationDays`, for the same reason: the row has to keep
     * the price that was quoted, or a later price edit would rewrite history and
     * make the reconciliation unverifiable.
     */
    amountPkr: {
      type: Number,
      required: true,
      min: 0,
    },

    /** Which channel the money was sent through. */
    method: {
      type: String,
      required: true,
      enum: Object.values(PAYMENT_METHOD),
    },

    /**
     * The transaction id, sender number or wallet reference the customer was
     * given. This is the field the operator matches against their statement,
     * which is why it is required and cannot be empty.
     */
    reference: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },

    /** Anything else the customer wanted to say. Never load-bearing. */
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },

    /** Where the claim sits in the workflow. */
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },

    /**
     * Where it came from. `gateway` is reserved for a processor webhook, which
     * would reuse every field below and skip the operator entirely.
     */
    source: {
      type: String,
      enum: Object.values(PAYMENT_SOURCE),
      default: PAYMENT_SOURCE.MANUAL,
    },

    /** A processor's own payment id, when a gateway is the source. */
    providerRef: {
      type: String,
      trim: true,
      default: null,
    },

    /**
     * When the plan was actually moved, with what.
     *
     * `null` while the claim is pending means nothing has been granted yet — the
     * customer is waiting on a human. Set while pending means the plan is live
     * and only the money is unconfirmed. That distinction is the whole feature.
     */
    grantedAt: {
      type: Date,
      default: null,
    },
    grantedPlan: {
      type: String,
      enum: Object.values(PLAN_TIER),
      default: null,
    },
    grantedUntil: {
      type: Date,
      default: null,
    },

    /** What the account looked like immediately before the grant. */
    previousPlan: {
      type: String,
      enum: Object.values(PLAN_TIER),
      default: null,
    },
    previousPlanExpiresAt: {
      type: Date,
      default: null,
    },

    /**
     * Whether the grant happened without a human looking first.
     *
     * Kept because it is the honest measure of how much revenue was settled
     * automatically: a confirmed grant and an auto-grant ending in the same
     * place are not the same event.
     */
    autoVerified: {
      type: Boolean,
      default: false,
    },

    /** The operator who settled it. Null while it is still pending. */
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },

    /**
     * The operator's reason. Shown to the customer on a rejection or revocation,
     * so it is written for them rather than for the file.
     */
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 300,
      default: '',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * A customer's own history, newest first.
 *
 * The only shape that path ever asks for, so the index matches it exactly.
 */
paymentSchema.index({ userId: 1, createdAt: -1 });

/**
 * The reconciliation queue.
 *
 * `grantedAt` sits in the index because the two pending shapes are sorted
 * differently on purpose: a grant with no money found is money already lost and
 * is shown first, while an ungranted claim is a customer waiting and is shown
 * oldest first. Both are answered by this one index.
 */
paymentSchema.index({ status: 1, grantedAt: 1, createdAt: -1 });

/**
 * Atomically marks that this claim's plan has been applied.
 *
 * The `grantedAt: null` precondition is what makes a claim grant at most once:
 * the auto-grant at submit and a later manual verify both call this, and only
 * one of them can win.
 *
 * The snapshot is written in the same update as the grant, so a row can never
 * claim to have granted without also carrying what it replaced.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @param {string} params.plan - The tier that was applied.
 * @param {Date|null} [params.until] - When it ends.
 * @param {string} params.previousPlan - The tier before the grant.
 * @param {Date|null} [params.previousPlanExpiresAt] - The expiry before the grant.
 * @param {boolean} [params.autoVerified] - Whether a human had looked first.
 * @param {import('mongoose').Types.ObjectId|string|null} [params.reviewedBy] - The
 *   operator, when a human made the grant. Null on the instant path.
 * @param {Date} [params.now] - Reference time.
 * @returns {Promise<object|null>} The updated claim, or null when it was already
 *   granted (or is no longer pending).
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.claimGrant = async function claimGrant({
  paymentId,
  plan,
  until = null,
  previousPlan = null,
  previousPlanExpiresAt = null,
  autoVerified = false,
  reviewedBy = null,
  now = new Date(),
}) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING, grantedAt: null },
    {
      grantedAt: now,
      grantedPlan: plan,
      grantedUntil: until,
      previousPlan,
      previousPlanExpiresAt,
      autoVerified,
      // A grant with no operator was made by the system, and saying a human
      // approved it would be the one lie this record must never tell.
      reviewedBy,
      reviewedAt: reviewedBy ? now : null,
    },
    { new: true },
  );
};

/**
 * Atomically puts a settled claim back into the queue.
 *
 * The compensation for a revoke whose account write failed. Without it the row
 * would read as revoked while the plan is still live — the customer keeps access
 * while the books say they do not, which is the direction that hides.
 *
 * Only valid from `revoked`, the one settled state reached by changing the
 * account: there is nothing to undo for the others.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @returns {Promise<object|null>} The released claim, or null if it had moved on.
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.releaseReview = async function releaseReview({ paymentId }) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.REVOKED },
    { status: PAYMENT_STATUS.PENDING, reviewedBy: null, reviewedAt: null, reviewNote: '' },
    { new: true },
  );
};

/**
 * Atomically hands a granted claim back to the queue.
 *
 * The compensation for a grant that failed to reach the user document. Without
 * it the row would read as granted while the account holds nothing — the failure
 * that looks settled and is therefore never looked at again.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @returns {Promise<object|null>} The released claim, or null if it had moved on.
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.releaseGrantClaim = async function releaseGrantClaim({ paymentId }) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING, grantedAt: { $ne: null } },
    {
      grantedAt: null,
      grantedPlan: null,
      grantedUntil: null,
      previousPlan: null,
      previousPlanExpiresAt: null,
      autoVerified: false,
    },
    { new: true },
  );
};

/**
 * Atomically settles a claim as confirmed.
 *
 * Only valid once a grant exists: confirming a claim that granted nothing would
 * close it as settled while the customer got nothing.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @param {import('mongoose').Types.ObjectId|string} params.reviewedBy - The operator.
 * @param {string} [params.note] - Reason, shown to the customer.
 * @param {Date} [params.now] - Reference time.
 * @returns {Promise<object|null>} The updated claim, or null on a lost race.
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.claimConfirm = async function claimConfirm({
  paymentId,
  reviewedBy,
  note = '',
  now = new Date(),
}) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING, grantedAt: { $ne: null } },
    { status: PAYMENT_STATUS.VERIFIED, reviewedBy, reviewedAt: now, reviewNote: note },
    { new: true },
  );
};

/**
 * Atomically settles a claim as rejected.
 *
 * Only valid when nothing was granted — a claim whose plan is already live must
 * be revoked instead, so that the grant is actually taken back rather than
 * relabelled.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @param {import('mongoose').Types.ObjectId|string} params.reviewedBy - The operator.
 * @param {string} [params.note] - Reason, shown to the customer.
 * @param {Date} [params.now] - Reference time.
 * @returns {Promise<object|null>} The updated claim, or null on a lost race.
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.claimReject = async function claimReject({
  paymentId,
  reviewedBy,
  note = '',
  now = new Date(),
}) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING, grantedAt: null },
    { status: PAYMENT_STATUS.REJECTED, reviewedBy, reviewedAt: now, reviewNote: note },
    { new: true },
  );
};

/**
 * Atomically settles a claim as revoked.
 *
 * The caller must have restored the account *before* this runs, so the row and
 * the user document cannot disagree about whether the plan is live. Only valid
 * once a grant exists, for the mirror image of the reject rule.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.paymentId - The claim.
 * @param {import('mongoose').Types.ObjectId|string} params.reviewedBy - The operator.
 * @param {string} [params.note] - Reason, shown to the customer.
 * @param {Date} [params.now] - Reference time.
 * @returns {Promise<object|null>} The updated claim, or null on a lost race.
 * @sideeffect Writes to the database.
 */
paymentSchema.statics.claimRevoke = async function claimRevoke({
  paymentId,
  reviewedBy,
  note = '',
  now = new Date(),
}) {
  return this.findOneAndUpdate(
    { _id: paymentId, status: PAYMENT_STATUS.PENDING, grantedAt: { $ne: null } },
    { status: PAYMENT_STATUS.REVOKED, reviewedBy, reviewedAt: now, reviewNote: note },
    { new: true },
  );
};

/**
 * The claim as its owner needs it.
 *
 * `reviewNote` is included deliberately: a customer whose claim was revoked or
 * rejected has to be told why, and an empty screen is how support requests are
 * made. No operator ids, and no snapshot of the previous state — that is our
 * bookkeeping, not theirs.
 *
 * @returns {object} Whitelisted fields.
 * @sideeffect none
 */
paymentSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    tier: this.tier,
    tierName: PLANS[this.tier]?.name ?? this.tier,
    durationDays: this.durationDays,
    amountPkr: this.amountPkr,
    method: this.method,
    reference: this.reference,
    note: this.note,
    status: this.status,
    grantedAt: this.grantedAt,
    grantedUntil: this.grantedUntil,
    reviewedAt: this.reviewedAt,
    reviewNote: this.reviewNote,
    createdAt: this.createdAt,
  };
};

/**
 * The claim as the reconciliation queue needs it.
 *
 * A superset of the customer's view, plus what an operator needs to judge it:
 * which account, what the account looked like before the grant, and whether a
 * human ever saw it first.
 *
 * @returns {object} The claim, with the owning account summarised when the
 *   caller populated `userId`.
 * @sideeffect none
 */
paymentSchema.methods.toAdminJSON = function toAdminJSON() {
  const account = this.userId;

  return {
    ...this.toPublicJSON(),
    userId: String(account?._id ?? account),
    // Present only when the query populated `userId`; the queue always does, so
    // the operator sees whose money this is without a second request.
    user: account?.email
      ? {
        id: String(account._id),
        email: account.email,
        name: account.name ?? '',
        plan: account.plan ?? null,
        planExpiresAt: account.planExpiresAt ?? null,
      }
      : null,
    source: this.source,
    providerRef: this.providerRef,
    autoVerified: this.autoVerified,
    previousPlan: this.previousPlan,
    previousPlanExpiresAt: this.previousPlanExpiresAt,
    reviewedBy: this.reviewedBy ? String(this.reviewedBy) : null,
  };
};

export const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
