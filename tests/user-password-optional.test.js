/**
 * An account may exist without a password.
 *
 * WHY THIS TEST EXISTS
 *   `passwordHash` was required, which made Google sign-in fail on the last step
 *   of an otherwise working flow: the token exchange succeeded, the profile came
 *   back, and creating the account threw a validation error mentioning a field
 *   the user never had. Nothing anywhere said "Google".
 *
 *   These are the two properties that make the field optional *safely*: an
 *   account without a password must be storable, and it must not authenticate.
 *
 * No database is touched — `validateSync` runs the schema's own rules in memory,
 * which is exactly the check that was failing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { User } from '../src/models/User.js';

test('an account with no password validates', () => {
  const user = new User({ email: 'google-only@example.com' });

  const error = user.validateSync();
  assert.equal(error, undefined, `expected no validation error, got: ${error?.message}`);
  assert.equal(user.passwordHash, null);
});

test('an account with no password cannot authenticate with one', async () => {
  const user = new User({ email: 'google-only@example.com' });

  // Anything at all — the point is that absence is not a wildcard.
  assert.equal(await user.verifyPassword(''), false);
  assert.equal(await user.verifyPassword('correct-horse-battery-staple'), false);
});

test('a password account still works exactly as before', async () => {
  const user = new User({ email: 'password@example.com' });
  await user.setPassword('a-real-password');

  assert.equal(user.validateSync(), undefined);
  assert.equal(await user.verifyPassword('a-real-password'), true);
  assert.equal(await user.verifyPassword('the-wrong-one'), false);
});
