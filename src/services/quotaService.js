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
import { QUOTAS } from '../config/constants.js';
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
export async function getUsage({ userId, key, now = new Date() }) {
  const { limit, period } = quotaConfig(key);
  const periodStart = computePeriodStart(period, now);

  const row = await Usage.findOne({ userId, key, periodStart }).lean();
  const used = row?.count ?? 0;

  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
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
export async function consume({ userId, key, now = new Date() }) {
  const { limit, period } = quotaConfig(key);
  const periodStart = computePeriodStart(period, now);

  // Reserve the unit first, then check. Incrementing before comparing means a
  // refusal costs one unit — but doing it the other way round would allow two
  // concurrent callers to both pass the check and both spend.
  const { count } = await Usage.increment({ userId, key, periodStart });

  // The claim exceeded the limit, so give it back. A refund keeps the stored
  // count honest, which matters because this collection is also the usage
  // history the cost report reads from.
  if (count > limit) {
    await Usage.updateOne({ userId, key, periodStart }, { $inc: { count: -1 } });

    logger.warn(`quota: ${key} exhausted for user ${userId} (${count - 1}/${limit})`);

    throw ApiError.tooManyRequests(
      `You have reached your ${key} limit for this ${period}.`,
      { key, limit, period, resetsAt: nextPeriodStart(period, now) },
    );
  }

  logger.debug(`quota: ${key} ${count}/${limit} for user ${userId}`);

  return { used: count, limit, remaining: Math.max(0, limit - count) };
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
export async function getUsageSummary({ userId }) {
  const keys = Object.keys(QUOTAS);

  // Parallel reads: the buckets are independent and this is a reporting path.
  const entries = await Promise.all(
    keys.map(async (key) => {
      const usage = await getUsage({ userId, key });
      return [key, { used: usage.used, limit: usage.limit, remaining: usage.remaining, period: usage.period }];
    }),
  );

  return Object.fromEntries(entries);
}

export default { consume, getUsage, getUsageSummary, nextPeriodStart };
