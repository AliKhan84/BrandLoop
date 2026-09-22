#!/usr/bin/env node
/**
 * scripts/normalize-posts.mjs — rewrites stored post bodies for a paste target.
 *
 * RESPONSIBILITY
 *   Apply the current text normalisation to posts that were generated before it
 *   existed.
 *
 * WHY THIS IS NEEDED AT ALL
 *   `normalizePostText` runs when a post is generated, so everything created
 *   after it shipped pastes correctly — paragraphs separated by blank lines,
 *   bullets as bullets. Nothing rewrites what was already stored, and a draft
 *   from before the fix keeps single newlines, which LinkedIn silently ignores.
 *   The result is a draft that looks right in the dashboard and arrives cramped
 *   in the composer, which reads as the fix not working.
 *
 * WHY THE TEXT IS RE-FITTED, NOT JUST NORMALISED
 *   Inserting paragraph breaks makes the body longer. A post that exactly filled
 *   a 3000-character LinkedIn ceiling would be pushed over it by the extra newlines,
 *   so `enforcePlatformLimit` runs afterwards — the same guarantee the generator
 *   uses. Truncation is reported rather than silent.
 *
 * WHAT IT DOES NOT DO
 *   It does not touch the Discord message. Those are re-rendered by
 *   `scripts/refresh-approval-messages.mjs --email …`, which is a separate
 *   command because it makes Discord calls this one has no reason to.
 *
 * USAGE
 *   npm run normalize-posts -- --email you@example.com --dry-run
 *   npm run normalize-posts -- --email you@example.com
 *
 * Exits 0 on success, 1 when the account cannot be found or arguments are
 * missing.
 */

import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User } from '../src/models/User.js';
import { Post } from '../src/models/Post.js';
import { normalizePostText } from '../src/utils/text.js';
import { enforcePlatformLimit } from '../src/utils/text.js';

/**
 * Reads a `--name value` or `--name=value` argument.
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
  console.log(`  ${label.padEnd(18)} ${value}`);
}

/**
 * Runs the migration.
 *
 * @returns {Promise<void>}
 * @sideeffect Writes post documents unless `--dry-run` is passed.
 */
async function main() {
  const email = argumentValue('email');
  const dryRun = process.argv.includes('--dry-run');

  console.log('\nBrandLoop — normalise stored posts');
  console.log('='.repeat(50));

  if (!email) {
    console.error('\n  A target account is required.\n');
    console.error('  npm run normalize-posts -- --email you@example.com [--dry-run]\n');
    process.exitCode = 1;
    return;
  }

  await connectDatabase();

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    console.error(`\n  No account with the email ${email}.\n`);
    process.exitCode = 1;
    await disconnectDatabase();
    return;
  }

  const posts = await Post.find({ userId: user._id });

  let rewritten = 0;
  let unchanged = 0;
  let truncated = 0;

  for (const post of posts) {
    let changed = false;

    // The body and every thread part are fitted per part, because each is
    // posted as its own message and each has its own ceiling.
    const normalisedBody = normalizePostText(post.content);
    const fittedBody = enforcePlatformLimit(normalisedBody, post.platform, {
      reserve: post.hashtags.join(' ').length > 0 ? post.hashtags.join(' ').length + 2 : 0,
    });

    if (fittedBody.text !== post.content) {
      post.content = fittedBody.text;
      changed = true;
      if (fittedBody.truncated) truncated += 1;
    }

    const normalisedThread = (post.thread ?? []).map((part) => {
      const fitted = enforcePlatformLimit(normalizePostText(part), post.platform);
      if (fitted.truncated) truncated += 1;
      return fitted.text;
    });

    if (normalisedThread.join('\n') !== (post.thread ?? []).join('\n')) {
      post.thread = normalisedThread.filter(Boolean);
      changed = true;
    }

    if (changed) {
      rewritten += 1;
      if (!dryRun) await post.save();
    } else {
      unchanged += 1;
    }
  }

  console.log('\nResult');
  show('Account', user.email);
  show('Posts found', posts.length);
  show(dryRun ? 'Would rewrite' : 'Rewritten', rewritten);
  show('Already normalised', unchanged);
  if (truncated > 0) {
    console.log(
      `\n  ${truncated} part(s) were over the platform limit once paragraph breaks were\n` +
        '  inserted and were cut on a sentence boundary. Re-generate any that matter.\n',
    );
  }

  if (dryRun && rewritten > 0) {
    console.log('\n  Dry run: nothing was written. Re-run without --dry-run to apply.\n');
  } else if (rewritten > 0) {
    console.log(
      '\n  Discord still shows the old text. Re-render those messages with:\n' +
        `    npm run refresh-approval-messages -- --email ${user.email}\n`,
    );
  }

  await disconnectDatabase();
}

main()
  .then(() => process.exit(process.exitCode === 1 ? 1 : 0))
  .catch(async (err) => {
    console.error('\nFailed:');
    console.error(err);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
