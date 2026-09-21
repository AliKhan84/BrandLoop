#!/usr/bin/env node
/**
 * scripts/make-admin.js — grants or revokes the admin role.
 *
 * RESPONSIBILITY
 *   Set `role` on one account, identified by email.
 *
 * WHY THIS IS A SCRIPT AND NOT A ROUTE
 *   The first admin cannot be created from the admin page: the route that would
 *   do it is already behind the role it grants. This connects straight to
 *   MongoDB the way `seed.js` does, so bootstrapping needs no temporary hole in
 *   the API's authorisation model.
 *
 * WHY IT TAKES `--email` EXPLICITLY
 *   Same reason the other operational scripts do: a fixture account left behind
 *   by a test run must never be able to become an administrator by accident.
 *
 * USAGE
 *   npm run make-admin -- --email you@example.com
 *   npm run make-admin -- --email you@example.com --revoke
 *
 * Exits 0 on success, 1 when the account cannot be found or the arguments are
 * missing, so it is safe to use in a shell chain.
 */

import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User } from '../src/models/User.js';
import { USER_ROLE } from '../src/config/constants.js';

/**
 * Reads a `--name value` or `--name=value` argument.
 *
 * `seed.js` only needs boolean flags, so this is the first value flag in the
 * repository. Both spellings are accepted because both get typed by hand.
 *
 * @param {string} name - Flag name, without the dashes.
 * @returns {string|null} The value, or null when the flag is absent.
 * @sideeffect none (pure)
 */
function argumentValue(name) {
  const flag = `--${name}`;

  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);

  const index = process.argv.indexOf(flag);
  if (index === -1) return null;

  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : null;
}

/**
 * Prints a labelled line for the operator.
 *
 * @param {string} label - Left-hand label.
 * @param {unknown} value - Value to show.
 * @returns {void}
 * @sideeffect Writes to stdout.
 */
function show(label, value) {
  console.log(`  ${label.padEnd(12)} ${value}`);
}

/**
 * Applies the role change.
 *
 * @returns {Promise<void>}
 * @sideeffect Writes a user document.
 */
async function main() {
  const email = argumentValue('email');
  const revoke = process.argv.includes('--revoke');

  console.log('\nBrandLoop — admin role');
  console.log('='.repeat(50));

  if (!email) {
    console.error('\n  A target account is required.\n');
    console.error('  npm run make-admin -- --email you@example.com');
    console.error('  npm run make-admin -- --email you@example.com --revoke\n');
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  // Lowercased to match the schema, which stores emails that way — otherwise a
  // correctly-spelled address would be reported as missing.
  const user = await User.findOne({ email: email.trim().toLowerCase() });

  if (!user) {
    console.error(`\n  No account with the email ${email}.\n`);
    process.exitCode = 1;
    await disconnectDatabase();
    return;
  }

  const previous = user.role;
  user.role = revoke ? USER_ROLE.USER : USER_ROLE.ADMIN;
  await user.save();

  console.log('\nAccount');
  show('Email', user.email);
  show('Role', `${previous} → ${user.role}`);

  if (!revoke) {
    console.log('\n  That account can now open /admin in the dashboard.');
    console.log('  The role is read from the database on every request, so it');
    console.log('  takes effect immediately — no re-login needed.\n');
  } else {
    console.log('');
  }

  await disconnectDatabase();
}

main()
  .then(() => {
    // The connection is already closed; an explicit exit avoids waiting on a
    // stray handle (the same reason probe.js exits deliberately).
    if (process.exitCode !== 1) process.exit(0);
    process.exit(1);
  })
  .catch(async (err) => {
    console.error('\nFailed:');
    console.error(err);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
