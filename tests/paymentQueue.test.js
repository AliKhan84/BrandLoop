/**
 * Tests for `services/discord/paymentQueue.js`.
 *
 * WHY THESE
 *   Two things here are easy to get wrong and expensive to notice. The buttons
 *   must match the claim's state, because offering "Verify" on a plan that is
 *   already live presents a control that can only fail. And the embed carries the
 *   customer's own text, which Discord rejects outright — the whole message, with
 *   the buttons — if any field exceeds its limit. Both are pure builders, so
 *   neither needs a gateway connection to check.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPaymentButtons,
  buildPaymentCustomId,
  buildPaymentEmbed,
  buildReviewedPayload,
  parsePaymentCustomId,
} from '../src/services/discord/paymentQueue.js';

import {
  DISCORD_EMBED_FIELD_LIMIT,
  PAYMENT_DECISION,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PLAN_TIER,
} from '../src/config/constants.js';

/**
 * A claim with sensible defaults, overridable per test.
 *
 * @param {object} [overrides] - Fields to change.
 * @returns {object} A claim shaped like the model's.
 */
function payment(overrides = {}) {
  return {
    _id: '65f0000000000000000000aa',
    userId: '65f0000000000000000000bb',
    tier: PLAN_TIER.PRO,
    durationDays: 30,
    amountPkr: 3000,
    method: PAYMENT_METHOD.JAZZCASH,
    reference: 'TEST-1234',
    note: '',
    status: PAYMENT_STATUS.PENDING,
    grantedAt: null,
    grantedPlan: null,
    grantedUntil: null,
    previousPlan: PLAN_TIER.FREE,
    previousPlanExpiresAt: null,
    reviewNote: '',
    createdAt: new Date('2026-03-01T12:00:00Z'),
    ...overrides,
  };
}

/** The button labels on a row, in order. */
function buttonLabels(row) {
  return row.components.map((component) => component.data.label);
}

/** The custom ids on a row, in order. */
function buttonIds(row) {
  return row.components.map((component) => component.data.custom_id);
}

describe('the payment button namespace', () => {
  test('an id round-trips through its own parser', () => {
    const id = buildPaymentCustomId(PAYMENT_DECISION.CONFIRM, 'abc123');

    assert.deepEqual(parsePaymentCustomId(id), { decision: 'confirm', paymentId: 'abc123' });
  });

  test('a draft button id is not mistaken for a payment one', () => {
    // The two namespaces must not overlap: the draft router would otherwise act
    // on a payment id, or this one on a post's.
    assert.equal(parsePaymentCustomId('post:approve:abc123'), null);
  });

  test('an unknown action is refused rather than dispatched', () => {
    assert.equal(parsePaymentCustomId('payment:delete:abc123'), null);
    assert.equal(parsePaymentCustomId('payment:confirm'), null);
    assert.equal(parsePaymentCustomId(null), null);
  });
});

describe('the decision pair offered', () => {
  test('a claim that granted a plan offers confirm and revoke', () => {
    const row = buildPaymentButtons(payment({ grantedAt: new Date(), grantedPlan: PLAN_TIER.PRO }));

    assert.deepEqual(buttonLabels(row), ['Confirm', 'Revoke']);
    assert.deepEqual(buttonIds(row).map((id) => id.split(':')[1]), ['confirm', 'revoke']);
  });

  test('a claim that granted nothing offers verify and reject', () => {
    const row = buildPaymentButtons(payment());

    assert.deepEqual(buttonLabels(row), ['Verify', 'Reject']);
    assert.deepEqual(buttonIds(row).map((id) => id.split(':')[1]), ['verify', 'reject']);
  });
});

describe('the embed', () => {
  test('every field fits Discord\u2019s limit, even with the longest note allowed', () => {
    // A field over 1024 characters makes Discord reject the entire message,
    // buttons included, so the claim would never reach an operator at all.
    const embed = buildPaymentEmbed(payment({ note: 'x'.repeat(500), reference: 'r'.repeat(64) }));

    for (const field of embed.data.fields) {
      assert.ok(
        field.value.length <= DISCORD_EMBED_FIELD_LIMIT,
        `field "${field.name}" is ${field.value.length} characters`,
      );
    }
  });

  test('says whether the plan is already active', () => {
    const pending = buildPaymentEmbed(payment());
    const granted = buildPaymentEmbed(
      payment({ grantedAt: new Date(), grantedPlan: PLAN_TIER.PRO, grantedUntil: new Date('2026-04-01T12:00:00Z') }),
    );

    const effectOf = (embed) => embed.data.fields.find((f) => f.name === 'Effect on the account').value;

    assert.match(effectOf(pending), /nothing granted yet/i);
    assert.match(effectOf(granted), /active/i);
  });

  test('names the account when it was passed in', () => {
    const embed = buildPaymentEmbed(payment(), { email: 'someone@example.com' });
    const account = embed.data.fields.find((field) => field.name === 'Account');

    assert.equal(account.value, 'someone@example.com');
  });

  test('omits the note field when the customer left none', () => {
    const embed = buildPaymentEmbed(payment({ note: '' }));

    assert.equal(embed.data.fields.some((field) => field.name === 'Their note'), false);
  });
});

describe('the settled message', () => {
  test('drops the buttons, so a decision cannot be taken twice', () => {
    const payload = buildReviewedPayload(payment({ status: PAYMENT_STATUS.VERIFIED }), 'admin#0001');

    assert.deepEqual(payload.components, []);
    assert.match(payload.embeds[0].data.title, /confirmed/i);
  });

  test('a revoke says the plan was rolled back, not that money was confirmed', () => {
    const payload = buildReviewedPayload(payment({ status: PAYMENT_STATUS.REVOKED }), 'admin#0001');

    assert.match(payload.embeds[0].data.title, /revoked/i);
    assert.match(payload.embeds[0].data.title, /rolled back/i);
  });

  test('carries the operator\u2019s note when there is one', () => {
    const payload = buildReviewedPayload(
      payment({ status: PAYMENT_STATUS.REJECTED, reviewNote: 'No credit for this reference.' }),
      'admin#0001',
    );

    const note = payload.embeds[0].data.fields.find((field) => field.name === 'Note');
    assert.equal(note.value, 'No credit for this reference.');
  });
});
