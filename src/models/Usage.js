/**
 * Usage model — one counter row per (user, quota key, period).
 *
 * RESPONSIBILITY
 *   Store how many times a user has spent a metered resource in the current
 *   period, and expose an atomic increment.
 *
 * WHY A SEPARATE COLLECTION WITH A UNIQUE INDEX
 *   Quotas are the primary cost control (PRD §7), so two concurrent runs must
 *   never both read `count: 4`, both decide they are under a limit of 5, and
 *   both spend. A unique index on `(userId, key, periodStart)` plus a single
 *   atomic `findOneAndUpdate` makes that race impossible at the database level
 *   rather than relying on application-level locking.
 *
 * WHY `periodStart` IS STORED, NOT DERIVED
 *   Buckets are pre-computed as a fixed timestamp (UTC midnight for daily,
 *   Monday 00:00 for weekly). Storing the bucket start rather than the event
 *   time means "how many today" is a single equality lookup against an
 *   indexed field, and old rows remain queryable as a usage history.
 *
 * DOES NOT OWN: the limits themselves (`constants.QUOTAS`) or the decision to
 * reject a request (`services/quotaService.js`).
 */

import mongoose from 'mongoose';
import { QUOTA_KEY, QUOTA_PERIOD } from '../config/constants.js';

const { Schema } = mongoose;

const usageSchema = new Schema(
  {
    /** Owning user. Indexed as part of the unique compound key below. */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Which quota this row counts. See `QUOTA_KEY` in constants. */
    key: {
      type: String,
      required: true,
      enum: Object.values(QUOTA_KEY),
    },

    /**
     * The start of the bucket this count belongs to.
     * Daily → UTC midnight. Weekly → Monday 00:00 UTC. See `quotaService`.
     */
    periodStart: {
      type: Date,
      required: true,
    },

    /** How many units have been spent in this bucket. */
    count: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * The uniqueness guarantee that makes concurrent spending safe.
 *
 * One row per user, per quota, per bucket. This is what allows the atomic
 * upsert in `increment` to be correct under concurrency: two simultaneous
 * increments cannot create two rows, so they must serialise onto one.
 */
usageSchema.index({ userId: 1, key: 1, periodStart: 1 }, { unique: true });

/**
 * Computes the start of the current bucket for a quota period.
 *
 * Daily buckets begin at UTC midnight; weekly buckets begin Monday 00:00 UTC.
 * UTC rather than local time keeps a user's quota from resetting twice on a
 * daylight-saving boundary.
 *
 * @param {'day'|'week'} period - The quota's window, from `QUOTA_PERIOD`.
 * @param {Date} [now=new Date()] - Reference time, injectable for tests.
 * @returns {Date} The bucket start.
 * @sideeffect none (pure)
 */
export function computePeriodStart(period, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (period === QUOTA_PERIOD.WEEK) {
    // getUTCDay: 0 = Sunday. Shifting by 6 and taking modulo 7 makes Monday
    // the first day of the week, matching how the PRD counts a "week".
    const daysSinceMonday = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  }

  return start;
}

/**
 * Atomically increments a counter and reports the new total.
 *
 * Uses `$inc` with `upsert`, so the read-modify-write happens inside MongoDB.
 * If two processes call this at the same instant they produce counts of 1 and
 * 2, never 1 and 1 — which is what makes the quota check in `quotaService`
 * correct under concurrency.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.userId - Owning user.
 * @param {string} params.key - Quota key, from `QUOTA_KEY`.
 * @param {Date} params.periodStart - Bucket start, from `computePeriodStart`.
 * @returns {Promise<{count: number}>} The new total for this bucket.
 * @sideeffect Writes to the database.
 */
usageSchema.statics.increment = async function increment({ userId, key, periodStart }) {
  // `returnDocument: 'after'` rather than the deprecated `new: true`. The
  // read *before* the write is not needed — `$inc` is atomic, so the returned
  // count already includes this increment.
  const doc = await this.findOneAndUpdate(
    { userId, key, periodStart },
    { $inc: { count: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  );

  return { count: doc?.count ?? 0 };
};

export const Usage = mongoose.model('Usage', usageSchema);
export default Usage;
