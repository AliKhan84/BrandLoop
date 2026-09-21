/**
 * Tests for the quota limit resolution in `services/quotaService.js`.
 *
 * WHY THESE
 *   `resolveLimit` is the single place that answers "how much may this account
 *   spend?", and it has three ways to answer: the deployment's env default, a
 *   paid tier's published number, or Infinity. It also has one trap — a plan
 *   that has expired must fall back to free rather than keeping its ceilings
 *   because nobody cleared the field. All of it is pure.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLimit, isUnlimited, activeTier } from '../src/services/quotaService.js';
import { PLANS, PLAN_TIER, QUOTA_KEY } from '../src/config/constants.js';

const NOW = new Date('2026-03-01T12:00:00Z');
const KEY = QUOTA_KEY.PLAN_GENERATIONS;

describe('isUnlimited', () => {
  test('is false for an ordinary account', () => {
    assert.equal(isUnlimited({}, NOW), false);
    assert.equal(isUnlimited(null, NOW), false);
    assert.equal(isUnlimited({ unlimited: false }, NOW), false);
  });

  test('is true with no end date — that is what forever means', () => {
    assert.equal(isUnlimited({ unlimited: true, unlimitedUntil: null }, NOW), true);
  });

  test('is true until the date passes, then false', () => {
    const future = new Date(NOW.getTime() + 1000);
    const past = new Date(NOW.getTime() - 1000);

    assert.equal(isUnlimited({ unlimited: true, unlimitedUntil: future }, NOW), true);
    assert.equal(isUnlimited({ unlimited: true, unlimitedUntil: past }, NOW), false);
  });
});

describe('activeTier', () => {
  test('defaults to free when there is no plan', () => {
    assert.equal(activeTier({}, NOW), PLAN_TIER.FREE);
    assert.equal(activeTier(null, NOW), PLAN_TIER.FREE);
  });

  test('returns the plan while it is still running', () => {
    const future = new Date(NOW.getTime() + 1000);
    assert.equal(activeTier({ plan: PLAN_TIER.PRO, planExpiresAt: future }, NOW), PLAN_TIER.PRO);
  });

  test('falls back to free once the plan has lapsed', () => {
    // The trap this exists to catch: without this check a Pro account whose
    // period ended would keep Pro's ceilings forever.
    const past = new Date(NOW.getTime() - 1000);
    assert.equal(activeTier({ plan: PLAN_TIER.PRO, planExpiresAt: past }, NOW), PLAN_TIER.FREE);
  });

  test('treats a plan with no expiry as permanent', () => {
    assert.equal(activeTier({ plan: PLAN_TIER.PRO, planExpiresAt: null }, NOW), PLAN_TIER.PRO);
  });

  test('an unknown plan value falls back to free rather than throwing', () => {
    assert.equal(activeTier({ plan: 'enterprise' }, NOW), PLAN_TIER.FREE);
  });
});

describe('resolveLimit', () => {
  test('an unlimited account has no ceiling at all', () => {
    assert.equal(resolveLimit({ unlimited: true }, KEY, NOW), Infinity);
  });

  test('a free account gets the deployment’s configured limit', () => {
    const resolved = resolveLimit({ plan: PLAN_TIER.FREE }, KEY, NOW);
    assert.equal(resolved, PLANS[PLAN_TIER.FREE].limits[KEY]);
  });

  test('a Pro account gets Pro’s limit, not the env default', () => {
    const future = new Date(NOW.getTime() + 1000);
    const resolved = resolveLimit({ plan: PLAN_TIER.PRO, planExpiresAt: future }, KEY, NOW);
    assert.equal(resolved, PLANS[PLAN_TIER.PRO].limits[KEY]);
    assert.notEqual(resolved, PLANS[PLAN_TIER.FREE].limits[KEY]);
  });

  test('an expired Pro account is back on the free limit', () => {
    const past = new Date(NOW.getTime() - 1000);
    const resolved = resolveLimit({ plan: PLAN_TIER.PRO, planExpiresAt: past }, KEY, NOW);

    assert.equal(resolved, PLANS[PLAN_TIER.FREE].limits[KEY]);
    assert.notEqual(resolved, Infinity);
  });

  test('an expired unlimited grant stops being unlimited', () => {
    const past = new Date(NOW.getTime() - 1000);
    const resolved = resolveLimit(
      { unlimited: true, unlimitedUntil: past, plan: PLAN_TIER.FREE },
      KEY,
      NOW,
    );

    assert.equal(resolved, PLANS[PLAN_TIER.FREE].limits[KEY]);
  });

  test('every quota bucket resolves for every tier', () => {
    for (const tier of Object.values(PLAN_TIER)) {
      for (const key of Object.values(QUOTA_KEY)) {
        const resolved = resolveLimit({ plan: tier }, key, NOW);
        assert.equal(typeof resolved, 'number', `${tier}/${key} should resolve to a number`);
        assert.ok(resolved > 0);
      }
    }
  });

  test('throws on a key that is not a quota', () => {
    // A typo must be loud — silently unlimited is the failure mode being avoided.
    assert.throws(() => resolveLimit({}, 'notAQuota', NOW), /Unknown quota key/);
  });
});
