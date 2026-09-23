/**
 * Tests for `services/paymentService.js` and the grant rules it relies on.
 *
 * WHY THESE
 *   A purchase moves money in one direction and access in the other, and the two
 *   ares easy to get out of step: extending a period that should have been
 *   replaced, replacing one that should have been extended, or letting a claim
 *   restore an account that has since bought something else. Each rule is a pure
 *   function, so each can be pinned exactly rather than argued about after a
 *   customer notices.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { computeTierGrant, restorePreviousGrant } from '../src/services/grantService.js';
import {
  autoVerifyEligible,
  buildPaymentMethods,
  isPurchasableTier,
  purchasability,
} from '../src/services/paymentService.js';

import {
  PAYMENT_METHOD,
  PLANS,
  PLAN_TIER,
  PURCHASABLE_TIERS,
  TIER_RANK,
} from '../src/config/constants.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** A date `days` from NOW. */
function fromNow(days) {
  return new Date(NOW.getTime() + days * DAY_MS);
}

describe('computeTierGrant', () => {
  test('grants the bought tier from now when the account is free', () => {
    const grant = computeTierGrant({
      tier: PLAN_TIER.CREATOR,
      durationDays: 30,
      user: { plan: PLAN_TIER.FREE, planExpiresAt: null },
      now: NOW,
    });

    assert.equal(grant.plan, PLAN_TIER.CREATOR);
    assert.equal(grant.planExpiresAt.getTime(), fromNow(30).getTime());
  });

  test('a renewal extends the period instead of restarting it', () => {
    // The customer already paid for the days up to the 20th. Renewing must add
    // to that end, not move it back to today.
    const existingUntil = fromNow(20);
    const grant = computeTierGrant({
      tier: PLAN_TIER.PRO,
      durationDays: 30,
      user: { plan: PLAN_TIER.PRO, planExpiresAt: existingUntil },
      now: NOW,
    });

    assert.equal(grant.planExpiresAt.getTime(), existingUntil.getTime() + 30 * DAY_MS);
  });

  test('an upgrade keeps the days already paid for', () => {
    // Creator until the 20th, then Pro for 30 days: the first period is not
    // thrown away, it is built on.
    const creatorUntil = fromNow(20);
    const grant = computeTierGrant({
      tier: PLAN_TIER.PRO,
      durationDays: 30,
      user: { plan: PLAN_TIER.CREATOR, planExpiresAt: creatorUntil },
      now: NOW,
    });

    assert.equal(grant.plan, PLAN_TIER.PRO);
    assert.equal(grant.planExpiresAt.getTime(), creatorUntil.getTime() + 30 * DAY_MS);
  });

  test('a lapsed period is not extended into the past', () => {
    const grant = computeTierGrant({
      tier: PLAN_TIER.CREATOR,
      durationDays: 30,
      user: { plan: PLAN_TIER.PRO, planExpiresAt: fromNow(-5) },
      now: NOW,
    });

    assert.equal(grant.planExpiresAt.getTime(), fromNow(30).getTime());
  });
});

describe('restorePreviousGrant', () => {
  const grantedUntil = fromNow(30);

  /** A granted claim, with the snapshot it took before granting. */
  function claim(overrides = {}) {
    return {
      grantedPlan: PLAN_TIER.PRO,
      grantedUntil,
      previousPlan: PLAN_TIER.CREATOR,
      previousPlanExpiresAt: fromNow(3),
      ...overrides,
    };
  }

  test('puts the account back exactly as it was', () => {
    const restored = restorePreviousGrant({
      payment: claim(),
      user: { plan: PLAN_TIER.PRO, planExpiresAt: grantedUntil },
    });

    assert.equal(restored.plan, PLAN_TIER.CREATOR);
    assert.equal(restored.planExpiresAt.getTime(), fromNow(3).getTime());
  });

  test('an account that was free goes back to free with no expiry', () => {
    const restored = restorePreviousGrant({
      payment: claim({ previousPlan: PLAN_TIER.FREE, previousPlanExpiresAt: null }),
      user: { plan: PLAN_TIER.PRO, planExpiresAt: grantedUntil },
    });

    assert.equal(restored.plan, PLAN_TIER.FREE);
    assert.equal(restored.planExpiresAt, null, 'free has no end date, and null says so');
  });

  test('refuses once a newer purchase has moved the expiry', () => {
    // The guard that stops a revoke deleting days bought afterwards. Restoring
    // the old snapshot here would remove the second purchase's 30 days.
    const restored = restorePreviousGrant({
      payment: claim(),
      user: { plan: PLAN_TIER.PRO, planExpiresAt: fromNow(60) },
    });

    assert.equal(restored.refused, 'superseded');
  });

  test('refuses when the plan itself was changed since', () => {
    const restored = restorePreviousGrant({
      payment: claim(),
      user: { plan: PLAN_TIER.CREATOR, planExpiresAt: grantedUntil },
    });

    assert.equal(restored.refused, 'superseded');
  });
});

describe('purchasability', () => {
  test('free is not for sale', () => {
    assert.equal(isPurchasableTier(PLAN_TIER.FREE), false);
    assert.equal(
      purchasability({ tier: PLAN_TIER.FREE, user: { plan: PLAN_TIER.FREE }, now: NOW }).reason,
      'free-tier',
    );
  });

  test('a value that is not a tier is refused rather than guessed', () => {
    assert.equal(
      purchasability({ tier: 'enterprise', user: { plan: PLAN_TIER.FREE }, now: NOW }).reason,
      'unknown-tier',
    );
  });

  test('the current tier passes, because renewing is a purchase', () => {
    const verdict = purchasability({
      tier: PLAN_TIER.PRO,
      user: { plan: PLAN_TIER.PRO, planExpiresAt: fromNow(10) },
      now: NOW,
    });

    assert.equal(verdict.ok, true);
  });

  test('a higher tier is allowed', () => {
    const verdict = purchasability({
      tier: PLAN_TIER.PRO,
      user: { plan: PLAN_TIER.CREATOR, planExpiresAt: fromNow(10) },
      now: NOW,
    });

    assert.equal(verdict.ok, true);
  });

  test('a cheaper tier is refused while a dearer one is running', () => {
    // Selling this would silently delete the Pro days already paid for, because
    // the account holds one plan with one expiry.
    const verdict = purchasability({
      tier: PLAN_TIER.CREATOR,
      user: { plan: PLAN_TIER.PRO, planExpiresAt: fromNow(10) },
      now: NOW,
    });

    assert.equal(verdict.reason, 'downgrade');
  });

  test('an account whose Pro has lapsed may buy Creator', () => {
    // Effective tier, not stored tier: the expired Pro is not protecting
    // anything, so a cheaper plan is not a downgrade from anything.
    const verdict = purchasability({
      tier: PLAN_TIER.CREATOR,
      user: { plan: PLAN_TIER.PRO, planExpiresAt: fromNow(-1) },
      now: NOW,
    });

    assert.equal(verdict.ok, true);
  });
});

describe('autoVerifyEligible', () => {
  test('grants when the switch is on and the amount is within the cap', () => {
    assert.equal(autoVerifyEligible({ amountPkr: 3000, autoVerify: true, autoVerifyMaxPkr: 5000 }), true);
  });

  test('the cap is inclusive, so a plan priced at the ceiling still applies', () => {
    assert.equal(autoVerifyEligible({ amountPkr: 5000, autoVerify: true, autoVerifyMaxPkr: 5000 }), true);
  });

  test('does not grant when the operator has asked to look first', () => {
    assert.equal(autoVerifyEligible({ amountPkr: 1500, autoVerify: false, autoVerifyMaxPkr: 5000 }), false);
  });

  test('does not grant above the cap', () => {
    assert.equal(autoVerifyEligible({ amountPkr: 5001, autoVerify: true, autoVerifyMaxPkr: 5000 }), false);
  });
});

describe('buildPaymentMethods', () => {
  test('offers only the accounts that are configured', () => {
    const methods = buildPaymentMethods({
      bankAccountNumber: 'PK00ABCD0123456789012345',
      jazzcashNumber: '',
      easypaisaNumber: '03451234567',
    });

    assert.deepEqual(
      methods.map((method) => method.id),
      [PAYMENT_METHOD.BANK, PAYMENT_METHOD.EASYPAISA],
      'a wallet with no number must not appear as an option',
    );
  });

  test('carries the bank name and the holder as one detail line', () => {
    const [bank] = buildPaymentMethods({
      bankName: 'Meezan Bank',
      bankAccountName: 'Ayesha Khan',
      bankAccountNumber: 'PK00ABCD0123456789012345',
    });

    assert.equal(bank.account, 'PK00ABCD0123456789012345');
    assert.equal(bank.detail, 'Meezan Bank · Ayesha Khan');
  });

  test('omits a detail line nobody filled in rather than showing empty punctuation', () => {
    const [wallet] = buildPaymentMethods({ jazzcashNumber: '03001234567' });

    assert.equal(wallet.id, PAYMENT_METHOD.JAZZCASH);
    assert.equal(wallet.detail, '');
  });

  test('an unconfigured deployment offers nothing to pay with', () => {
    // What makes an unconfigured deployment a missing feature: there is no
    // method to choose, so `PAYMENTS_ENABLED` cannot be true by accident.
    assert.deepEqual(buildPaymentMethods(), []);
  });
});

describe('the payment catalog', () => {
  test('every purchasable tier carries a price and a term', () => {
    for (const tier of PURCHASABLE_TIERS) {
      assert.ok(PLANS[tier].pricePkr > 0, `${tier} must cost something`);
      assert.ok(PLANS[tier].durationDays > 0, `${tier} must say how long it lasts`);
    }
  });

  test('free is neither priced nor sold', () => {
    assert.equal(PLANS[PLAN_TIER.FREE].pricePkr, 0);
    assert.equal(PLANS[PLAN_TIER.FREE].durationDays, null);
    assert.ok(!PURCHASABLE_TIERS.includes(PLAN_TIER.FREE));
  });

  test('the rank list covers every tier, cheapest first', () => {
    // purchasability is decided by these positions, so a tier missing from the
    // list would silently become unbuyable.
    assert.deepEqual([...TIER_RANK], [PLAN_TIER.FREE, PLAN_TIER.CREATOR, PLAN_TIER.PRO]);
  });
});
