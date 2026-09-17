/**
 * Cron scheduler.
 *
 * RESPONSIBILITY
 *   Register the daily job on a cron schedule and shut the schedule down
 *   cleanly.
 *
 * ## Why node-cron rather than a queue
 *
 * BullMQ would mean running Redis, which is a second stateful service to
 * install, secure and keep alive for a workload of one job per day. The job
 * function is written to be plain and idempotent, so moving to a real queue
 * later is a drop-in swap — the scheduler is the only file that would change.
 *
 * ## Why the schedule is validated before registering
 *
 * A malformed cron string makes node-cron throw at registration, which would
 * take down start-up. Validating first means a typo in the schedule logs a
 * clear warning and the API still boots — losing the automatic trigger is a
 * smaller failure than losing the whole service.
 *
 * DOES NOT OWN: what the job does (`dailyPostJob.js`).
 */

import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { runDailyJob } from './dailyPostJob.js';

/**
 * The registered task, or null when the scheduler is not running.
 * @type {import('node-cron').ScheduledTask|null}
 */
let task = null;

/**
 * Starts the daily job on its cron schedule.
 *
 * @returns {{started: boolean, schedule?: string, reason?: string}} Whether the
 *   schedule was registered, and why not when it was not.
 * @sideeffect Registers a recurring timer.
 */
export function startScheduler() {
  if (!env.CRON_ENABLED) {
    logger.info('Scheduler disabled (CRON_ENABLED=false)');
    return { started: false, reason: 'disabled' };
  }

  if (task) {
    logger.warn('Scheduler already started');
    return { started: true, schedule: env.CRON_DAILY_POST_SCHEDULE };
  }

  const schedule = env.CRON_DAILY_POST_SCHEDULE;

  // Catch a bad expression here rather than letting it abort start-up.
  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid CRON_DAILY_POST_SCHEDULE "${schedule}" — the scheduler will not run. ` +
        'Expected a standard 5-field expression, e.g. "0 9 * * *".',
    );
    return { started: false, reason: 'invalid_schedule' };
  }

  task = cron.schedule(schedule, async () => {
    try {
      await runDailyJob({ triggeredBy: 'cron' });
    } catch (err) {
      // runDailyJob absorbs its own failures, so reaching here means something
      // unexpected. Caught so a rejected promise cannot crash the process.
      logger.error('Scheduled daily job threw unexpectedly', err);
    }
  });

  logger.info(`Scheduler started — daily job on "${schedule}"`);

  return { started: true, schedule };
}

/**
 * Stops the scheduled job.
 *
 * Safe to call when nothing is running, so it can be wired directly into a
 * shutdown handler.
 *
 * @returns {Promise<void>}
 * @sideeffect Clears the recurring timer.
 */
export async function stopScheduler() {
  if (!task) return;
  await task.stop();
  task = null;
  logger.info('Scheduler stopped');
}

/**
 * Reports whether the schedule is currently registered.
 *
 * @returns {boolean} True when a task is running.
 * @sideeffect none
 */
export function isSchedulerRunning() {
  return task !== null;
}

export default { startScheduler, stopScheduler, isSchedulerRunning };
