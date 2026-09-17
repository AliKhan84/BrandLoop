#!/usr/bin/env node
/**
 * scripts/seed.js — creates a demo account and, optionally, a ready-to-approve plan.
 *
 * RESPONSIBILITY
 *   Set up everything needed to demonstrate the loop, without clicking through
 *   the API by hand.
 *
 * WHY A SEED SCRIPT AT ALL
 *   There is no front end in this build (PRD decision 2). Registering a user,
 *   setting a niche, adding input points, creating a plan and approving it
 *   would otherwise be five curl calls before anything interesting happens.
 *
 * USAGE
 *   npm run seed                     create the demo user and print a link code
 *   npm run seed -- --plan           also create and approve a 7-day plan
 *   npm run seed -- --plan --slice   additionally generate the first slot now
 *   npm run seed -- --reset          delete the demo user's data first
 *
 * Idempotent on email: running it twice updates the same account rather than
 * failing on the unique index.
 */

import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import { User } from '../src/models/User.js';
import { ContentPlan } from '../src/models/ContentPlan.js';
import { Post } from '../src/models/Post.js';
import { Usage } from '../src/models/Usage.js';
import { GenerationLog } from '../src/models/GenerationLog.js';
import { createPlan } from '../src/services/planService.js';
import { generateLinkCode } from '../src/routes/linkCode.js';
import { PLAN_STATUS } from '../src/config/constants.js';

/** Demo account credentials. Deliberately obvious — this is not a real user. */
const DEMO = Object.freeze({
  email: 'demo@brandloop.local',
  password: 'demo-password-123',
  name: 'Demo User',
  niche: 'AI in healthcare',
  inputPoints: [
    'I spent three years deploying clinical decision support in NHS trusts.',
    'Most hospital AI projects fail at integration and procurement, not model accuracy.',
    'Clinicians trust systems that show their reasoning far more than black-box scores.',
  ],
  postFrequency: 3,
  defaultPlanDuration: 7,
});

/**
 * Reads a boolean flag from `process.argv`.
 *
 * @param {string} name - Flag name without dashes, e.g. `"plan"`.
 * @returns {boolean} True when the flag is present.
 * @sideeffect none (pure)
 */
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
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
  console.log(`  ${label.padEnd(16)} ${value}`);
}

/**
 * Creates or updates the demo user.
 *
 * @returns {Promise<object>} The saved user document.
 * @sideeffect Writes a user document.
 */
async function upsertDemoUser() {
  let user = await User.findOne({ email: DEMO.email }).select('+passwordHash');

  if (user) {
    // Update the profile fields but leave the password alone, so a re-run does
    // not invalidate a session someone already has open.
    user.name = DEMO.name;
    user.niche = DEMO.niche;
    user.inputPoints = DEMO.inputPoints;
    user.postFrequency = DEMO.postFrequency;
    user.defaultPlanDuration = DEMO.defaultPlanDuration;
    user.isActive = true;
    await user.save();
    return user;
  }

  user = new User({
    email: DEMO.email,
    name: DEMO.name,
    niche: DEMO.niche,
    inputPoints: DEMO.inputPoints,
    postFrequency: DEMO.postFrequency,
    defaultPlanDuration: DEMO.defaultPlanDuration,
  });

  await user.setPassword(DEMO.password);
  await user.save();

  return user;
}

/**
 * Deletes the demo user's data so a run starts from nothing.
 *
 * @param {object} user - The demo user.
 * @returns {Promise<void>}
 * @sideeffect Deletes plans, posts, usage rows and log rows.
 */
async function resetUserData(user) {
  const [posts, plans, usage, logs] = await Promise.all([
    Post.deleteMany({ userId: user._id }),
    ContentPlan.deleteMany({ userId: user._id }),
    Usage.deleteMany({ userId: user._id }),
    GenerationLog.deleteMany({ userId: user._id }),
  ]);

  console.log(
    `  Reset: removed ${plans.deletedCount} plan(s), ${posts.deletedCount} post(s), ` +
      `${usage.deletedCount} usage row(s), ${logs.deletedCount} log row(s).`,
  );
}

/**
 * Runs the seed.
 *
 * @returns {Promise<void>}
 * @sideeffect Writes to the database and prints a summary.
 */
async function main() {
  console.log('\nBrandLoop seed');
  console.log('='.repeat(50));

  await connectDatabase();

  const user = await upsertDemoUser();

  if (hasFlag('reset')) {
    await resetUserData(user);
  }

  // Always issue a fresh link code — the previous one may have expired, and
  // this is the value the operator needs most from this script.
  const { code, expiresAt } = generateLinkCode();
  user.discordLinkCode = code;
  user.discordLinkCodeExpiresAt = expiresAt;
  await user.save();

  console.log('\nAccount');
  show('Email', DEMO.email);
  show('Password', DEMO.password);
  show('User id', user._id.toString());
  show('Niche', user.niche);
  show('Input points', `${user.inputPoints.length} supplied`);
  show('Discord linked', user.discordUserId ? `yes (${user.discordUserId})` : 'no');

  console.log('\nDiscord link');
  show('Code', code);
  show('Expires', expiresAt.toISOString());
  console.log(`\n  In Discord, run:  /connect ${code}`);

  if (hasFlag('plan')) {
    console.log('\nCreating a plan…');

    const plan = await createPlan({ userId: user._id, durationDays: DEMO.defaultPlanDuration });

    // Approved immediately so the scheduler will pick it up — the point of
    // seeding is to have something runnable.
    plan.status = PLAN_STATUS.APPROVED;
    plan.approvedAt = new Date();
    await plan.save();

    const newsCount = plan.days.filter((slot) => slot.type === 'news').length;

    console.log('\nPlan');
    show('Plan id', plan._id.toString());
    show('Status', plan.status);
    show('Slots', `${plan.days.length} (${plan.days.length - newsCount} planned, ${newsCount} news)`);
    show('Window', `${plan.durationDays} days`);

    if (plan.days[0]) show('First theme', plan.days[0].theme);

    console.log('\nNext steps');
    console.log('  1. Start the API:      npm run dev');
    console.log(`  2. Generate a slot:    POST http://localhost:${process.env.PORT ?? 3000}/api/dev/scheduler/run`);
    console.log('     (or wait for the daily cron)');
    console.log('  3. Approve the draft from the Discord DM.');

    if (hasFlag('slice')) {
      console.log('\nGenerating the first slot now…');
      const { generateSlot } = await import('../src/services/planService.js');
      const { generated, skipped } = await generateSlot({ user, plan, slot: plan.days[0] });

      show('Generated', generated.length);
      if (skipped.length) show('Skipped', skipped.join('; '));
      if (generated.length) {
        console.log('\n  Check your Discord DMs for the draft.');
      }
    }
  } else {
    console.log('\nTip: run with --plan to also create an approved plan.');
  }

  await disconnectDatabase();

  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nSeed failed:');
    console.error(err);
    process.exit(1);
  });
