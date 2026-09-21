/**
 * Coupon model — a code that grants access when redeemed.
 *
 * RESPONSIBILITY
 *   Store the codes an operator hands out, and record who redeemed each one.
 *
 * WHY REDEMPTION IS ONE ATOMIC OPERATION
 *   `Coupon.claim` performs the capacity check, the counter increment and the
 *   audit entry inside a single MongoDB update. Reading the count and then
 *   writing it back would let two simultaneous redemptions both see "0 of 1
 *   used" and both succeed — the same class of bug the `Usage` counters were
 *   built to avoid, and the reason the same pattern is reused here.
 *
 * WHY THE REDEMPTION LIST IS EMBEDDED
 *   A coupon is bounded: at most `maxRedemptions` entries, and in practice a
 *   handful. Embedding keeps "who used this, and when" readable in one
 *   document, and the one-redemption-per-user rule is a query condition on the
 *   same array.
 *
 * DOES NOT OWN: what a redemption grants (`services/couponService.js`), or who
 * may create a coupon (the admin routes).
 */

import mongoose from 'mongoose';

import { COUPON_KIND } from '../config/constants.js';

const { Schema } = mongoose;

/** One user's redemption of a coupon. */
const redemptionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    at: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const couponSchema = new Schema(
  {
    /**
     * The code as typed. Stored uppercase so redemption is not case-sensitive —
     * a code that only works in the exact case it was created would fail for
     * anyone reading it off a slide or a screenshot.
     */
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },

    /** What redeeming it grants: a Pro period, or unlimited usage. */
    kind: {
      type: String,
      enum: Object.values(COUPON_KIND),
      default: COUPON_KIND.PRO,
    },

    /** How long the grant lasts. `null` means it never expires. */
    durationDays: {
      type: Number,
      default: null,
      min: 1,
    },

    /** How many users may redeem it. `null` means no limit. */
    maxRedemptions: {
      type: Number,
      default: null,
      min: 1,
    },

    /** Incremented atomically on each successful claim. */
    redemptionCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Who redeemed it, newest last. */
    redemptions: {
      type: [redemptionSchema],
      default: [],
    },

    /** When the code itself stops being accepted. `null` means never. */
    expiresAt: {
      type: Date,
      default: null,
    },

    /** Switched off rather than deleted, so the audit trail survives. */
    isActive: {
      type: Boolean,
      default: true,
    },

    /** Why the code exists, for the operator's own records. */
    note: {
      type: String,
      trim: true,
      default: '',
    },

    /** The admin who created it. Null for anything made by a script. */
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * Atomically claims a redemption.
 *
 * Every condition is part of the query, so the check and the write cannot be
 * separated by another request. A caller that loses the race gets `null` rather
 * than a second grant.
 *
 * @param {object} params
 * @param {string} params.code - The normalised (uppercase) code.
 * @param {import('mongoose').Types.ObjectId|string} params.userId - Who is redeeming.
 * @param {Date} [params.now] - Reference time for the expiry check.
 * @returns {Promise<object|null>} The updated coupon, or null when the claim failed.
 * @sideeffect Increments the counter and appends a redemption.
 */
couponSchema.statics.claim = async function claim({ code, userId, now = new Date() }) {
  return this.findOneAndUpdate(
    {
      code,
      isActive: true,
      // `$or` rather than a nullable comparison: a coupon with no expiry has the
      // field set to null, and `null > now` is false, which would reject every
      // never-expiring code.
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        { $or: [{ maxRedemptions: null }, { $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] } }] },
        // One redemption per user: a second attempt cannot push a duplicate.
        { 'redemptions.userId': { $ne: userId } },
      ],
    },
    {
      $inc: { redemptionCount: 1 },
      $push: { redemptions: { userId, at: now } },
    },
    { new: true },
  );
};

/**
 * The coupon as the admin UI needs it.
 *
 * @returns {object} Whitelisted fields, with the redemption list reduced to a
 *   count plus the most recent entries — enough to answer "who used this"
 *   without shipping an unbounded array.
 * @sideeffect none
 */
couponSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    code: this.code,
    kind: this.kind,
    durationDays: this.durationDays,
    maxRedemptions: this.maxRedemptions,
    redemptionCount: this.redemptionCount,
    redemptions: this.redemptions.slice(-10).map((entry) => ({
      userId: entry.userId.toString(),
      at: entry.at,
    })),
    expiresAt: this.expiresAt,
    isActive: this.isActive,
    note: this.note,
    createdAt: this.createdAt,
  };
};

export const Coupon = mongoose.model('Coupon', couponSchema);
export default Coupon;
