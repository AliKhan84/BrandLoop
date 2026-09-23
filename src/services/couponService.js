/**
 * Coupons — creating codes, and applying what they grant.
 *
 * RESPONSIBILITY
 *   Turn a code into a grant on an account, exactly once per user.
 *
 * ## Where the grant is computed
 *
 * The arithmetic moved to `grantService.js` when purchases arrived, because both
 * features end in the same act — extend or set a plan on an account — and the
 * rule that matters most must not exist twice. It is re-exported here under its
 * original name so every caller and its tests are unchanged.
 *
 * ## Why the claim happens before the grant is written
 *
 * The order matters when something fails halfway. Claiming first means the
 * worst case is a spent redemption that granted nothing — an operator can see
 * it in the log and hand out another code. Granting first would mean a failed
 * claim still granted access, which is the failure that costs money. Fail
 * closed, toward the operator.
 *
 * DOES NOT OWN: the coupon schema (`models/Coupon.js`), who may create one (the
 * admin routes), or what a limit means (`quotaService.js`).
 */

import { randomInt } from 'node:crypto';

import mongoose from 'mongoose';

import { COUPON_KIND } from '../config/constants.js';
import { Coupon } from '../models/Coupon.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { computeCouponGrant } from './grantService.js';

/**
 * Characters a generated code may use.
 *
 * No `I`, `O`, `0` or `1`: these codes get read aloud, retyped from a slide, or
 * copied out of a screenshot, and those four are the pairs that go wrong.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Why a code cannot be redeemed, in the user's words rather than a code name. */
const REASONS = Object.freeze({
  'not-found': 'That code is not valid.',
  inactive: 'That code has been switched off.',
  expired: 'That code has expired.',
  exhausted: 'That code has already been used as many times as it can be.',
  'already-redeemed': 'You have already used that code.',
});

/**
 * Generates a readable coupon code.
 *
 * @param {number} [length=8] - How many characters.
 * @returns {string} An uppercase code from the unambiguous alphabet.
 * @sideeffect none (uses the CSPRNG)
 */
export function generateCouponCode(length = 8) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Normalises a code exactly the way the schema stores it.
 *
 * Redemption is case-insensitive because a code that only works in the case it
 * was created in fails for anyone reading it off a slide.
 *
 * @param {string} input - What the user typed.
 * @returns {string} The uppercase code, or an empty string when it cannot be a code.
 * @sideeffect none (pure)
 */
export function normalizeCouponCode(input) {
  if (typeof input !== 'string') return '';

  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '');
  // Anything outside this set was never in a generated code, so rejecting early
  // gives a better message than a not-found later.
  return /^[A-Z0-9_-]{3,32}$/.test(cleaned) ? cleaned : '';
}

/**
 * Reports whether a coupon can be redeemed by this user.
 *
 * @param {object} params
 * @param {object|null} params.coupon - The coupon document, or null.
 * @param {string} params.userId - Who is redeeming.
 * @param {Date} [params.now] - Reference time.
 * @returns {{ok: boolean, reason?: string}} The verdict.
 * @sideeffect none (pure)
 */
export function isCouponRedeemable({ coupon, userId, now = new Date() }) {
  if (!coupon) return { ok: false, reason: 'not-found' };
  if (!coupon.isActive) return { ok: false, reason: 'inactive' };
  if (coupon.expiresAt && coupon.expiresAt <= now) return { ok: false, reason: 'expired' };

  if (
    typeof coupon.maxRedemptions === 'number' &&
    coupon.redemptionCount >= coupon.maxRedemptions
  ) {
    return { ok: false, reason: 'exhausted' };
  }

  const alreadyUsed = (coupon.redemptions ?? []).some(
    (entry) => String(entry.userId) === String(userId),
  );
  if (alreadyUsed) return { ok: false, reason: 'already-redeemed' };

  return { ok: true };
}

/**
 * Works out the fields a redemption should write onto the user.
 *
 * A re-export rather than a copy: the arithmetic lives in `grantService.js`,
 * where the purchase path can reach the same implementation. The name is kept
 * because callers and tests have always imported it from here.
 *
 * @type {typeof import('./grantService.js').computeCouponGrant}
 */
export const computeGrant = computeCouponGrant;

/**
 * Creates a coupon.
 *
 * @param {object} params
 * @param {string} [params.code] - A chosen code. Generated when omitted.
 * @param {string} [params.kind] - One of `COUPON_KIND`.
 * @param {number|null} [params.durationDays] - Days granted; null for forever.
 * @param {number|null} [params.maxRedemptions] - Cap; null for no cap.
 * @param {Date|null} [params.expiresAt] - When the code itself stops working.
 * @param {string} [params.note] - Why it exists.
 * @param {string|null} [params.createdBy] - The admin's user id.
 * @returns {Promise<object>} The saved coupon.
 * @throws {ApiError} 400 when a chosen code is malformed or already exists.
 * @sideeffect Writes a coupon document.
 */
export async function createCoupon({
  code,
  kind = COUPON_KIND.PRO,
  durationDays = null,
  maxRedemptions = null,
  expiresAt = null,
  note = '',
  createdBy = null,
} = {}) {
  const normalized = code ? normalizeCouponCode(code) : generateCouponCode();

  if (!normalized) {
    throw ApiError.badRequest(
      'A coupon code may contain only letters, digits, hyphen and underscore (3–32 characters).',
    );
  }

  const existing = await Coupon.findOne({ code: normalized });
  if (existing) {
    throw ApiError.conflict(`The code ${normalized} already exists.`);
  }

  const coupon = await Coupon.create({
    code: normalized,
    kind,
    durationDays,
    maxRedemptions,
    expiresAt,
    note,
    createdBy,
  });

  logger.info(
    `coupon: created ${coupon.code} (${coupon.kind}, ` +
      `${coupon.durationDays == null ? 'no expiry' : `${coupon.durationDays} days`}, ` +
      `${coupon.maxRedemptions == null ? 'unlimited uses' : `${coupon.maxRedemptions} uses`})`,
  );

  return coupon;
}

/**
 * Lists coupons for the admin page, newest first.
 *
 * @param {object} [params]
 * @param {number} [params.limit=100] - Maximum rows.
 * @returns {Promise<object[]>} The coupons.
 * @sideeffect none (read-only)
 */
export async function listCoupons({ limit = 100 } = {}) {
  return Coupon.find().sort({ createdAt: -1 }).limit(limit);
}

/**
 * Switches a coupon on or off.
 *
 * Deactivating is preferred over deleting: the redemption history is the record
 * of who was given what.
 *
 * @param {object} params
 * @param {string} params.couponId - The coupon to change.
 * @param {boolean} params.isActive - The new state.
 * @returns {Promise<object>} The updated coupon.
 * @throws {ApiError} 404 when there is no such coupon.
 * @sideeffect Updates a coupon document.
 */
export async function setCouponActive({ couponId, isActive }) {
  // Checked before the query: a malformed id makes Mongoose throw a CastError,
  // which the error handler would report as a 500 — a server fault for what is
  // really a bad reference.
  if (!mongoose.isValidObjectId(couponId)) {
    throw ApiError.notFound('No such coupon.');
  }

  const coupon = await Coupon.findByIdAndUpdate(couponId, { isActive }, { new: true });
  if (!coupon) throw ApiError.notFound('No such coupon.');

  logger.info(`coupon: ${coupon.code} ${isActive ? 'enabled' : 'disabled'}`);
  return coupon;
}

/**
 * Redeems a code for a user.
 *
 * @param {object} params
 * @param {string} params.code - The code as typed.
 * @param {string} params.userId - Who is redeeming.
 * @returns {Promise<{coupon: object, grant: object, user: object}>} The coupon,
 *   what it granted, and the updated user.
 * @throws {ApiError} 400 with a specific reason when the code cannot be used.
 * @sideeffect Claims the redemption and writes the grant onto the user.
 */
export async function redeemCoupon({ code, userId }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw ApiError.badRequest('That does not look like a coupon code.');

  const coupon = await Coupon.findOne({ code: normalized });
  const verdict = isCouponRedeemable({ coupon, userId });
  if (!verdict.ok) {
    // Specific reasons, because "not valid" for a code the user has already used
    // sends them to support for nothing.
    throw ApiError.badRequest(REASONS[verdict.reason]);
  }

  const claimed = await Coupon.claim({ code: normalized, userId });
  if (!claimed) {
    // Only reachable when two requests raced between the check above and here.
    throw ApiError.conflict('That code was just used up. Please try another.');
  }

  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists.');

  const grant = computeCouponGrant({ coupon: claimed, user });
  Object.assign(user, grant, { couponCode: claimed.code });
  await user.save();

  logger.info(
    `coupon: ${user.email} redeemed ${claimed.code} (${claimed.kind}) → ` +
      `${grant.unlimited ? `unlimited${grant.unlimitedUntil ? ` until ${grant.unlimitedUntil.toISOString()}` : ' forever'}` : `${grant.plan}${grant.planExpiresAt ? ` until ${grant.planExpiresAt.toISOString()}` : ' forever'}`}`,
  );

  return { coupon: claimed, grant, user };
}

export default {
  generateCouponCode,
  normalizeCouponCode,
  isCouponRedeemable,
  computeGrant,
  createCoupon,
  listCoupons,
  setCouponActive,
  redeemCoupon,
};
