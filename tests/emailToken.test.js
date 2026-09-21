/**
 * Tests for `utils/emailToken.js`.
 *
 * WHY THESE
 *   This module decides whether an email address can be trusted, and every
 *   branch in it is a security decision: a token that repeats would let one
 *   user's link verify another's address, a hash that varies would make every
 *   stored token unverifiable, and an expiry that never fires would leave
 *   links live forever. All of it is pure, so it can be pinned exactly.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateEmailToken,
  hashEmailToken,
  verificationExpiry,
  isVerificationExpired,
  tokenHashesMatch,
  resendAllowedAt,
} from '../src/utils/emailToken.js';

import { env } from '../src/config/env.js';

describe('generateEmailToken', () => {
  test('produces a URL-safe token', () => {
    // The token travels in a query string. `+` would decode as a space and `/`
    // as a path separator, so a base64 token with either would break on the way
    // out of an email client.
    const token = generateEmailToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  test('is 43 characters, i.e. 32 bytes of entropy', () => {
    assert.equal(generateEmailToken().length, 43);
  });

  test('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateEmailToken()));
    assert.equal(tokens.size, 50, 'every token must be distinct');
  });
});

describe('hashEmailToken', () => {
  test('is deterministic, so a stored hash can be matched later', () => {
    const token = 'a-fixed-token-value';
    assert.equal(hashEmailToken(token), hashEmailToken(token));
  });

  test('produces a 64-character hex digest', () => {
    assert.match(hashEmailToken('anything'), /^[0-9a-f]{64}$/);
  });

  test('different tokens hash differently', () => {
    assert.notEqual(hashEmailToken('one'), hashEmailToken('two'));
  });

  test('never reveals the token it was given', () => {
    assert.ok(!hashEmailToken('secret-token').includes('secret-token'));
  });

  test('returns an empty string for missing input', () => {
    assert.equal(hashEmailToken(''), '');
    assert.equal(hashEmailToken(null), '');
    assert.equal(hashEmailToken(undefined), '');
  });
});

describe('tokenHashesMatch', () => {
  test('accepts identical hashes', () => {
    const hash = hashEmailToken('same');
    assert.equal(tokenHashesMatch(hash, hash), true);
  });

  test('rejects different hashes', () => {
    assert.equal(tokenHashesMatch(hashEmailToken('one'), hashEmailToken('two')), false);
  });

  test('rejects hashes of different lengths without throwing', () => {
    // `timingSafeEqual` throws on a length mismatch, so the guard is what keeps
    // a malformed token from becoming a 500 rather than a rejected link.
    assert.equal(tokenHashesMatch('abc', 'abcdef'), false);
  });

  test('rejects missing values', () => {
    assert.equal(tokenHashesMatch(null, null), false);
    assert.equal(tokenHashesMatch(undefined, hashEmailToken('x')), false);
    assert.equal(tokenHashesMatch('', ''), false);
  });
});

describe('verificationExpiry', () => {
  test('is in the future by the configured TTL', () => {
    const expected = Date.now() + env.EMAIL_VERIFICATION_TTL_MIN * 60_000;
    const expiry = verificationExpiry().getTime();
    // Allow a second of slack for the call itself.
    assert.ok(Math.abs(expiry - expected) < 1000, `expected about ${expected}, got ${expiry}`);
  });
});

describe('isVerificationExpired', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  test('is true when nothing was ever issued', () => {
    assert.equal(isVerificationExpired({}, now), true);
    assert.equal(isVerificationExpired(null, now), true);
  });

  test('is false for a future expiry', () => {
    const user = { emailVerificationExpiresAt: new Date('2026-01-02T12:00:00Z') };
    assert.equal(isVerificationExpired(user, now), false);
  });

  test('is true for a past expiry', () => {
    const user = { emailVerificationExpiresAt: new Date('2025-12-31T12:00:00Z') };
    assert.equal(isVerificationExpired(user, now), true);
  });

  test('treats the exact expiry moment as expired', () => {
    // Boundary: a link is not valid *at* its expiry instant, so the comparison
    // must be `<=`, not `<`.
    const user = { emailVerificationExpiresAt: new Date(now) };
    assert.equal(isVerificationExpired(user, now), true);
  });
});

describe('resendAllowedAt', () => {
  const now = new Date('2026-01-01T12:00:00Z');

  test('allows a first resend when nothing has been sent', () => {
    assert.equal(resendAllowedAt({}, now), null);
  });

  test('blocks a resend inside the cooldown and says when it lifts', () => {
    const justSent = { emailVerificationSentAt: new Date(now) };
    const allowedAt = resendAllowedAt(justSent, now);

    assert.ok(allowedAt instanceof Date, 'a cooldown must return the time it ends');
    assert.equal(allowedAt.getTime(), now.getTime() + env.EMAIL_RESEND_COOLDOWN_SEC * 1000);
  });

  test('allows a resend once the cooldown has passed', () => {
    const old = new Date(now.getTime() - (env.EMAIL_RESEND_COOLDOWN_SEC + 1) * 1000);
    assert.equal(resendAllowedAt({ emailVerificationSentAt: old }, now), null);
  });
});
