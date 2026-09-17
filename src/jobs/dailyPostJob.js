/**
 * Daily post job — advances every eligible user's plan by one slot.
 *
 * RESPONSIBILITY
 *   The unit of scheduled work: find users who should receive a post, generate
 *   the next slot for each, and report what happened.
 *
 * ## Isolation between users
 *
 * Each user is processed inside its own try/catch. A single user with a broken
 * configuration — no linked Discord account, an exhausted quota, a niche that
 * trips a safety filter — must not prevent everyone queued behind them from
 * receiving their post. Without this, one bad record silently stops the product
 * for every other user, and the failure only shows up as "nobody got a post
 * today" with no indication why.
 *
 * ## Idempotence
 *
 * Running the job twice in a day is safe. `generateNextSlot` only ever picks a
 * slot still marked `pending`, and marks it generated once it has produced
 * something — so a second run advances to the *next* slot rather than repeating
 * the first. That property is what allows the dev trigger and the cron schedule
 * to coexist without guarding against each other.
 *
 * DOES NOT OWN: scheduling (`scheduler.js`) or the generation pipeline itself
 * (`planService`).
 */

import { User } from '../models/User.js';
import { ContentPlan } from '../models/ContentPlan.js';
import { generateNextSlot } from '../services/planService.js';
import { PLAN_STATUS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Guards against two runs overlapping.
 *
 * WHY A SOFT LOCK RATHER THAN A QUEUE: this process is single-instance, so a
 * module-level flag is sufficient and costs nothing. The moment a second
 * instance exists this becomes wrong, and the comment is here so that is
 * obvious — the correct fix at that point is a real lock in the database, not a
 * bigger flag.
 *
 * @type {boolean}
 */
let isRunning = false;

/**
 * Finds users due to receive a post.
 *
 * A user qualifies when the account is active, a Discord account is linked
 * (otherwise there is nowhere to deliver), and they have an approved plan with
 * at least one pending slot.
 *
 * @returns {Promise<object[]>} The eligible user documents.
 * @sideeffect none (read-only)
 */
async function findEligibleUsers() {
  // Users without a linked Discord account are excluded in the query rather
  // than in a loop — cheaper, and it keeps the skip reason unambiguous.
  const candidates = await User.find({
    isActive: true,
    discordUserId: { $ne: null },
  });

  const approvedPlans = await ContentPlan.find({ status: PLAN_STATUS.APPROVED }).select('userId');

  const userIdsWithPlans = new Set(approvedPlans.map((plan) => plan.userId.toString()));

  return candidates.filter((user) => userIdsWithPlans.has(user._id.toString()));
}

/**
 * Runs the daily generation pass over every eligible user.
 *
 * Never throws. A total failure — the database being unreachable, say — is
 * reported through the summary rather than a rejected promise, because the
 * caller is a cron tick with nothing useful to do about it.
 *
 * @param {object} [options]
 * @param {string} [options.triggeredBy='cron'] - What started this run, for logs.
 * @returns {Promise<{startedAt: Date, finishedAt: Date, durationMs: number,
 *   triggeredBy: string, considered: number, advanced: number, exhausted: number,
 *   failed: number, results: object[], skipped: string}>} The run summary.
 * @sideeffect Generates posts, consumes quota, sends Discord DMs.
 */
export async function runDailyJob({ triggeredBy = 'cron' } = {}) {
  if (isRunning) {
    logger.warn(`Daily job already running — skipping this ${triggeredBy} trigger`);
    return {
      startedAt: new Date(),
      finishedAt: new Date(),
      durationMs: 0,
      triggeredBy,
      considered: 0,
      advanced: 0,
      exhausted: 0,
      failed: 0,
      results: [],
      skipped: 'already_running',
    };
  }

  isRunning = true;
  const startedAt = new Date();

  logger.info(`Daily job started (triggered by ${triggeredBy})`);

  const results = [];
  let failed = 0;
  let advanced = 0;
  let exhausted = 0;
  let considered = 0;

  try {
    const users = await findEligibleUsers();
    considered = users.length;

    for (const user of users) {
      try {
        const outcome = await generateNextSlot({ userId: user._id });

        if (!outcome) {
          // Nothing to do: the plan vanished mid-run, or the user was
          // deactivated between the query and here. Not an error.
          results.push({ userId: user._id.toString(), status: 'no_action' });
          continue;
        }

        if (outcome.exhausted) {
          exhausted += 1;
          results.push({ userId: user._id.toString(), status: 'plan_exhausted', planId: outcome.planId });
          continue;
        }

        advanced += 1;
        results.push({
          userId: user._id.toString(),
          status: 'generated',
          planId: outcome.planId,
          dayIndex: outcome.dayIndex,
          posts: outcome.generated.length,
          skipped: outcome.skipped,
        });
      } catch (err) {
        // Isolated: one user's failure must not stop the rest of the run.
        failed += 1;
        logger.error(`Daily job: user ${user._id} failed`, err);
        results.push({ userId: user._id.toString(), status: 'failed', error: err.message });
      }
    }
  } finally {
    // Released in a finally block so a throw from the user query cannot leave
    // the flag stuck true, which would silently disable every future run.
    isRunning = false;
  }

  const finishedAt = new Date();
  const summary = {
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    triggeredBy,
    considered,
    advanced,
    exhausted,
    failed,
    results,
    skipped: null,
  };

  logger.info(
    `Daily job finished in ${summary.durationMs}ms — ` +
      `${considered} considered, ${advanced} advanced, ${exhausted} exhausted, ${failed} failed`,
  );

  return summary;
}

/**
 * Reports whether a run is currently in progress.
 *
 * Used by the dev route to avoid stacking runs during manual testing.
 *
 * @returns {boolean} True while a run is active.
 * @sideeffect none
 */
export function isJobRunning() {
  return isRunning;
}

export default { runDailyJob, isJobRunning };
