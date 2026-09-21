/**
 * Quota enforcement.
 *
 * RESPONSIBILITY
 *   Decide whether a user may spend a metered resource, and record the spend
 *   atomically at the moment of the decision.
 *
 * ## The one rule that matters: consume BEFORE the paid call
 *
 * Every metered operation calls `consume` *before* it touches a provider. That
 * ordering is deliberate. If the increment happened after a successful call, a
 * crash between the two would give the work away for free — and a run of those
 * is exactly how a quota fails to control cost. Consuming first means the worst
 * case is a user losing one unit to a failed call, which is recoverable and
 * bounded.
 *
 * ## Why the increment is a single atomic operation
 *
 * `Usage.increment` performs the read and the write inside MongoDB. Two
 * concurrent runs cannot both observe `count: 4` and both decide they are under
 * a limit of 5 — they serialise, producing 4→5 and then 5→6, and the second
 * caller is correctly refused.
 *
 * DOES NOT OWN: the limit values (constants.QUOTAS) or the decision to surface
 * a refusal to the user.
 */

import { Usage, computePeriodStart } from '../models/Usage.js';
import { PLANS, PLAN_TIER, QUOTAS } from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';

/**
 * Looks up a quota's configuration.
 *
 * @param {string} key - A quota key from `QUOTA_KEY`.
 * @returns {{limit: number, period: string}} The limit and its window.
 * @throws {Error} When the key is not a configured quota — a typo should be
 *   loud rather than silently unlimited.
 * @sideeffect none (pure)
 */
function quotaConfig(key) {
  const config = QUOTAS[key];
  if (!config) {
    throw new Error(`Unknown quota key "${key}". Expected one of: ${Object.keys(QUOTAS).join(', ')}.`);
  }
  return config;
}

/**
 * Whether every quota is bypassed for this user right now.
 *
 * `unlimited` without a date means forever; with one, it means until then. Two
 * fields rather than one because "forever" and "two weeks" are different
 * grants, and a null date on its own cannot express both.
 *
 * @param {object|null} user - The user document.
 * @param {Date} [now] - Reference time.
 * @returns {boolean} True when the limits are bypassed.
 * @sideeffect none (pure)
 */
export function isUnlimited(user, now = new Date()) {
  if (!user?.unlimited) return false;
  if (!user.unlimitedUntil) return true;
  return user.unlimitedUntil > now;
}

/**
 * Resolves the limit that actually applies to this user for this quota.
 *
 * WHY THIS IS NOT JUST `QUOTAS[key].limit`: the free tier's allowance is the
 * deployment's env value, but a paid tier's is a published number that must not
 * move with an env edit — and an unlimited grant bypasses both. One function
 * decides, so no caller has to remember the three cases.
 *
 * @param {object|null} user - The user document.
 * @param {string} key - A quota key from `QUOTA_KEY`.
 * @param {Date} [now] - Reference time.
 * @returns {number} The limit, or `Infinity` when unlimited.
 * @throws {Error} When the key is not a configured quota.
 * @sideeffect none (pure)
 */
export function resolveLimit(user, key, now = new Date()) {
  const { limit: environmentLimit } = quotaConfig(key);

  if (isUnlimited(user, now)) return Infinity;

  const tierLimit = PLANS[activeTier(user, now)]?.limits?.[key];

  return typeof tierLimit === 'number' ? tierLimit : environmentLimit;
}

/**
 * The tier a user is actually on right now.
 *
 * WHY THIS IS NOT JUST `user.plan`: a plan has an end date, and a lapsed Pro
 * account must fall back to the free limits rather than keep its high ceilings
 * because nobody cleared the field. Everything that reports or enforces a limit
 * goes through this, so the meter and the enforcement cannot disagree.
 *
 * @param {object|null} user - The user document.
 * @param {Date} [now] - Reference time.
 * @returns {string} One of `PLAN_TIER`.
 * @sideeffect none (pure)
 */
export function activeTier(user, now = new Date()) {
  const plan = user?.plan;
  if (!plan || !PLANS[plan]) return PLAN_TIER.FREE;
  if (user.planExpiresAt && user.planExpiresAt <= now) return PLAN_TIER.FREE;
  return plan;
}

/**
 * Reads current usage for a quota without modifying it.
 *
 * Used for reporting and for pre-flight checks where the caller wants to warn
 * rather than refuse.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId - The user.
 * @param {string} params.key - A quota key from `QUOTA_KEY`.
 * @param {Date} [params.now=new Date()] - Reference time, injectable for tests.
 * @returns {Promise<{used: number, limit: number, remaining: number, periodStart: Date, period: string}>}
 *   The current state of the bucket.
 * @sideeffect none (read-only)
 */
export async function getUsage({ userId, key, now = new Date(), user = null }) {
  const { period } = quotaConfig(key);
  const limit = user ? resolveLimit(user, key, now) : quotaConfig(key).limit;
  const periodStart = computePeriodStart(period, now);

  const row = await Usage.findOne({ userId, key, periodStart }).lean();
  const used = row?.count ?? 0;

  // An unlimited account has no meaningful ceiling, so the limit and the
  // remainder are reported as null rather than as `Infinity` — which does not
  // survive JSON, and would reach the dashboard as `null` anyway but without
  // saying why.
  const unlimited = limit === Infinity;

  return {
    used,
    limit: unlimited ? null : limit,
    remaining: unlimited ? null : Math.max(0, limit - used),
    unlimited,
    periodStart,
    period,
  };
}

/**
 * Atomically claims one unit of a quota.
 *
 * Call this immediately before the operation it pays for.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId - The user.
 * @param {string} params.key - A quota key from `QUOTA_KEY`.
 * @param {Date} [params.now=new Date()] - Reference time, injectable for tests.
 * @returns {Promise<{used: number, limit: number, remaining: number}>} State
 *   after the claim.
 * @throws {ApiError} 429 when the quota is already exhausted. The counter is
 *   *not* incremented in that case, so repeated refusals do not inflate it.
 * @sideeffect Writes to the database.
 */
export async function consume({ userId, key, now = new Date(), limit = null }) {
  const { period } = quotaConfig(key);
  const resolvedLimit = limit ?? quotaConfig(key).limit;
  const periodStart = computePeriodStart(period, now);

  // Reserve the unit first, then check. Incrementing before comparing means a
  // refusal costs one unit — but doing it the other way round would allow two
  // concurrent callers to both pass the check and both spend.
  //
  // A `limit` of Infinity never refuses, and still records the spend: the usage
  // history is what the cost report reads, so an unlimited account must not look
  // like an idle one.
  const { count } = await Usage.increment({ userId, key, periodStart });

  if (count > resolvedLimit) {
    await Usage.updateOne({ userId, key, periodStart }, { $inc: { count: -1 } });

    logger.warn(`quota: ${key} exhausted for user ${userId} (${count - 1}/${resolvedLimit})`);

    throw ApiError.tooManyRequests(
      `You have reached your ${key} limit for this ${period}.`,
      { key, limit: resolvedLimit, period, resetsAt: nextPeriodStart(period, now) },
    );
  }

  logger.debug(
    `quota: ${key} ${count}/${resolvedLimit === Infinity ? 'unlimited' : resolvedLimit} for user ${userId}`,
  );

  return {
    used: count,
    limit: resolvedLimit === Infinity ? null : resolvedLimit,
    remaining: resolvedLimit === Infinity ? null : Math.max(0, resolvedLimit - count),
    unlimited: resolvedLimit === Infinity,
  };
}

/**
 * Computes when the current bucket rolls over.
 *
 * Surfaced to the user on a refusal, because "you have hit your limit" without
 * saying when it resets is an unhelpful error.
 *
 * @param {'day'|'week'} period - The quota's window.
 * @param {Date} [now=new Date()] - Reference time.
 * @returns {Date} The start of the next bucket.
 * @sideeffect none (pure)
 */
export function nextPeriodStart(period, now = new Date()) {
  const next = computePeriodStart(period, now);
  if (period === 'week') {
    next.setUTCDate(next.getUTCDate() + 7);
  } else {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Reports every quota's state for one user.
 *
 * Backs the `/status` Discord command and the usage summary in the API.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.userId - The user.
 * @returns {Promise<Record<string, {used: number, limit: number, remaining: number, period: string}>>}
 *   One entry per configured quota.
 * @sideeffect none (read-only)
 */
export async function getUsageSummary({ userId, user = null }) {
  const keys = Object.keys(QUOTAS);

  // Parallel reads: the buckets are independent and this is a reporting path.
  const entries = await Promise.all(
    keys.map(async (key) => {
      const usage = await getUsage({ userId, key, user });
      return [
        key,
        {
          used: usage.used,
          limit: usage.limit,
          remaining: usage.remaining,
          unlimited: usage.unlimited,
          period: usage.period,
        },
      ];
    }),
  );

  return Object.fromEntries(entries);
}

export default { consume, getUsage, getUsageSummary, nextPeriodStart, resolveLimit, isUnlimited, activeTier };
