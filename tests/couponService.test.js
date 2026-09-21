/**
 * Tests for `services/couponService.js`.
 *
 * WHY THESE
 *   A coupon is a money grant, and the rules that decide who gets what are easy
 *   to get subtly wrong: extending an existing Pro period instead of replacing
 *   it, telling "not valid" apart from "you already used this", and treating a
 *   null duration as "forever" rather than "zero days". Each of those is a pure
 *   function, so each can be pinned exactly.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateCouponCode,
  normalizeCouponCode,
  isCouponRedeemable,
  computeGrant,
} from '../src/services/couponService.js';

import { COUPON_KIND, PLAN_TIER, PLANS, QUOTA_KEY } from '../src/config/constants.js';

const NOW = new Date('2026-03-01T12:00:00Z');

/** A coupon with sensible defaults, overridable per test. */
function coupon(overrides = {}) {
  return {
    code: 'LAUNCH',
    kind: COUPON_KIND.PRO,
    durationDays: 30,
    maxRedemptions: null,
    redemptionCount: 0,
    redemptions: [],
    expiresAt: null,
    isActive: true,
    ...overrides,
  };
}

describe('generateCouponCode', () => {
  test('avoids the characters people misread', () => {
    // These codes get read off a slide and retyped. I/O and 0/1 are the pairs
    // that go wrong, so they are not in the alphabet at all.
    const codes = Array.from({ length: 40 }, () => generateCouponCode());
    const joined = codes.join('');
    assert.ok(!/[IO01]/.test(joined), `found an ambiguous character in ${joined}`);
    assert.match(joined, /^[A-Z2-9]+$/);
  });

  test('is the requested length and does not repeat', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCouponCode(8)));
    assert.equal(codes.size, 50);
    assert.equal([...codes][0].length, 8);
  });
});

describe('normalizeCouponCode', () => {
  test('uppercases and strips spaces, so a code read aloud still works', () => {
    assert.equal(normalizeCouponCode(' launch 30 '), 'LAUNCH30');
  });

  test('accepts hyphens and underscores', () => {
    assert.equal(normalizeCouponCode('friends-only'), 'FRIENDS-ONLY');
  });

  test('rejects anything that could not be a generated code', () => {
    assert.equal(normalizeCouponCode('no!'), '');
    assert.equal(normalizeCouponCode('ab'), '', 'too short to be a code');
    assert.equal(normalizeCouponCode(null), '');
    assert.equal(normalizeCouponCode(42), '');
  });
});

describe('isCouponRedeemable', () => {
  const userId = 'user-1';

  test('accepts a fresh, active coupon', () => {
    assert.deepEqual(isCouponRedeemable({ coupon: coupon(), userId, now: NOW }), { ok: true });
  });

  test('reports a missing coupon distinctly from an unusable one', () => {
    assert.equal(isCouponRedeemable({ coupon: null, userId, now: NOW }).reason, 'not-found');
  });

  test('refuses a switched-off coupon', () => {
    assert.equal(
      isCouponRedeemable({ coupon: coupon({ isActive: false }), userId, now: NOW }).reason,
      'inactive',
    );
  });

  test('refuses an expired coupon', () => {
    const expired = coupon({ expiresAt: new Date(NOW.getTime() - 1000) });
    assert.equal(isCouponRedeemable({ coupon: expired, userId, now: NOW }).reason, 'expired');
  });

  test('accepts a coupon with no expiry at all', () => {
    // A nullable date must not be read as "expired long ago".
    assert.equal(isCouponRedeemable({ coupon: coupon({ expiresAt: null }), userId, now: NOW }).ok, true);
  });

  test('refuses a coupon that has been used up', () => {
    const used = coupon({ maxRedemptions: 2, redemptionCount: 2 });
    assert.equal(isCouponRedeemable({ coupon: used, userId, now: NOW }).reason, 'exhausted');
  });

  test('refuses a second redemption by the same user', () => {
    const used = coupon({ redemptions: [{ userId: 'someone-else', at: NOW }, { userId, at: NOW }] });
    assert.equal(
      isCouponRedeemable({ coupon: used, userId, now: NOW }).reason,
      'already-redeemed',
      'the reason matters: "not valid" would send the user to support for nothing',
    );
  });
});

describe('computeGrant', () => {
  test('grants Pro for the coupon duration', () => {
    const grant = computeGrant({ coupon: coupon({ durationDays: 30 }), now: NOW });
    assert.equal(grant.plan, PLAN_TIER.PRO);
    assert.equal(grant.planExpiresAt.getTime(), NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  test('a null duration means forever, not zero', () => {
    const grant = computeGrant({ coupon: coupon({ durationDays: null }), now: NOW });
    assert.equal(grant.plan, PLAN_TIER.PRO);
    assert.equal(grant.planExpiresAt, null);
  });

  test('extends an existing Pro period rather than replacing it', () => {
    // Redeeming a second code while still on Pro must add to the end of the
    // current period — shortening a paid-for period would be a bug that costs
    // the user something they already had.
    const existingUntil = new Date(NOW.getTime() + 10 * 24 * 60 * 60 * 1000);
    const grant = computeGrant({
      coupon: coupon({ durationDays: 30 }),
      user: { plan: PLAN_TIER.PRO, planExpiresAt: existingUntil },
      now: NOW,
    });

    assert.equal(grant.planExpiresAt.getTime(), existingUntil.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  test('extends from now when the previous Pro grant has already lapsed', () => {
    const lapsed = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    const grant = computeGrant({
      coupon: coupon({ durationDays: 7 }),
      user: { plan: PLAN_TIER.PRO, planExpiresAt: lapsed },
      now: NOW,
    });

    assert.ok(grant.planExpiresAt > NOW, 'a lapsed period must not be extended into the past');
  });

  test('an unlimited coupon with a duration sets both the flag and the date', () => {
    const grant = computeGrant({
      coupon: coupon({ kind: COUPON_KIND.UNLIMITED, durationDays: 14 }),
      now: NOW,
    });

    assert.equal(grant.unlimited, true);
    assert.equal(grant.unlimitedUntil.getTime(), NOW.getTime() + 14 * 24 * 60 * 60 * 1000);
  });

  test('an unlimited coupon with no duration means forever', () => {
    const grant = computeGrant({
      coupon: coupon({ kind: COUPON_KIND.UNLIMITED, durationDays: null }),
      now: NOW,
    });

    assert.equal(grant.unlimited, true);
    assert.equal(grant.unlimitedUntil, null, 'null date plus the flag is how "forever" is expressed');
  });

  test('does not turn an unlimited grant into a plan change', () => {
    // Unlimited is orthogonal to the tier: it bypasses the quotas, it does not
    // move the account to a different plan.
    const grant = computeGrant({ coupon: coupon({ kind: COUPON_KIND.UNLIMITED }), now: NOW });
    assert.equal(grant.plan, undefined);
  });
});

describe('the plan catalog', () => {
  test('the free tier prices exactly the buckets that cost money', () => {
    // Nothing about an existing account's allowance may change when plans
    // arrive, so free mirrors the env-driven quotas. Feedback is metered as
    // well, but it is not a plan feature — nothing is paid for, so it must not
    // appear in a tier's limits.
    const priced = Object.keys(PLANS[PLAN_TIER.FREE].limits).sort();

    assert.deepEqual(priced, ['images', 'newsLookups', 'planGenerations']);
    assert.ok(
      !priced.includes(QUOTA_KEY.FEEDBACK),
      'feedback is a rate limit, not something a plan sells',
    );
  });

  test('paid tiers advertise more than free on every priced bucket', () => {
    // The billing page shows these numbers as a promise, so a tier that is worse
    // than free anywhere would be advertising something untrue.
    for (const tier of [PLAN_TIER.CREATOR, PLAN_TIER.PRO]) {
      for (const key of Object.keys(PLANS[PLAN_TIER.FREE].limits)) {
        assert.ok(
          PLANS[tier].limits[key] > PLANS[PLAN_TIER.FREE].limits[key],
          `${tier}.${key} must exceed free`,
        );
      }
    }
  });

  test('every tier has a name and a price', () => {
    for (const plan of Object.values(PLANS)) {
      assert.equal(typeof plan.name, 'string');
      assert.equal(typeof plan.price, 'number');
    }
  });
});
