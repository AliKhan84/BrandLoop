/**
 * Application entry point.
 *
 * RESPONSIBILITY
 *   Bring the process up in the right order, and take it down cleanly.
 *
 * ## Start-up order, and why it is this order
 *
 *   1. Environment   — validated on import of `config/env.js`; a bad .env exits
 *                      here, before anything is opened.
 *   2. Database      — everything else needs it, and a failure here should stop
 *                      start-up rather than surface on the first request.
 *   3. HTTP server   — starts listening so /health answers during the slower
 *                      gateway connection below.
 *   4. Discord       — connects and registers commands. The scheduler is only
 *                      started once this succeeds, because the daily job
 *                      delivers by DM and running it without a gateway would
 *                      spend quota on posts nobody can receive.
 *   5. Scheduler     — last, when every dependency it needs is known good.
 *
 * ## Graceful shutdown
 *
 * On SIGINT/SIGTERM the process stops accepting connections, drains in-flight
 * requests, then closes the database and the gateway. Without this, Ctrl-C
 * during a generation run leaves an open MongoDB connection and a half-sent
 * Discord message.
 *
 * DOES NOT OWN: routes (`app.js`), the pipeline (`planService`), or scheduling
 * (`jobs/scheduler.js`).
 */

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './db/connect.js';
import { createApp } from './app.js';
import {
  startDiscord,
  stopDiscord,
} from './services/discord/client.js';
import { registerInteractionHandlers } from './services/discord/interactions.js';
import { registerCommands } from './services/discord/commands.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

/**
 * Set once shutdown begins, so a second signal does not start a second teardown.
 * @type {boolean}
 */
let shuttingDown = false;

/**
 * Handle for the background Discord reconnect timer, so shutdown can clear it.
 * @type {NodeJS.Timeout|null}
 */
let discordRetryTimer = null;

/** How often to re-attempt a failed Discord connection. */
const DISCORD_RETRY_INTERVAL_MS = 60_000;

/**
 * Connects Discord, registers its handlers, and starts the scheduler.
 *
 * Extracted so the same sequence can be run both at startup and from the
 * background retry below — the two paths must not drift apart, and the
 * scheduler may only start once delivery is actually possible.
 *
 * @returns {Promise<boolean>} True when Discord is connected and usable.
 * @sideeffect Opens a gateway connection; may register slash commands.
 */
async function connectDiscord() {
  const client = await startDiscord();

  // Handlers before commands, so a button press arriving during command
  // registration is not dropped.
  registerInteractionHandlers(client);
  await registerCommands(client);

  return true;
}

/**
 * Retries the Discord connection in the background until it succeeds.
 *
 * ## Why this exists rather than "just restart it"
 *
 * The gateway WebSocket upgrade from this network is intermittent — roughly one
 * attempt in four succeeds and the rest return `503`. Discord's own status feed
 * reports everything operational, REST works every time, and the session budget
 * is untouched, so the failures are environmental rather than anything the app
 * controls.
 *
 * A single bounded retry at startup is therefore not enough. If boot happens to
 * land in a bad window, the process would run indefinitely with `discord: no`,
 * the scheduler would never start, and every user would silently receive no
 * posts — with nothing in the logs after the first minute to say why. Retrying
 * until it succeeds converts an unlucky boot into a short delay.
 *
 * The scheduler is started here rather than in `main` because it must not run
 * without a delivery path: generating drafts nobody can receive would spend
 * users' quota for nothing.
 *
 * @returns {void}
 * @sideeffect Schedules a recurring timer.
 */
function retryDiscordInBackground() {
  if (discordRetryTimer) return;

  discordRetryTimer = setInterval(async () => {
    if (shuttingDown) return;

    try {
      await connectDiscord();
      logger.info('Discord reconnected — starting the scheduler');

      clearInterval(discordRetryTimer);
      discordRetryTimer = null;

      startScheduler();
    } catch (err) {
      // Logged at debug: this fires once a minute and would otherwise bury
      // anything useful in the log during a long outage.
      logger.debug(`Discord still unavailable: ${String(err?.message).split('\n')[0]}`);
    }
  }, DISCORD_RETRY_INTERVAL_MS);

  // Do not hold the event loop open for this timer alone — shutdown must not
  // be blocked by a pending retry.
  discordRetryTimer.unref?.();
}

/**
 * Stops everything in reverse order of start-up.
 *
 * @param {object} params
 * @param {import('node:http').Server} params.server - The HTTP server to close.
 * @param {string} params.signal - The signal that triggered this.
 * @returns {Promise<void>}
 * @sideeffect Closes the server, scheduler, Discord connection and database.
 */
async function shutdown({ server, signal }) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Received ${signal} — shutting down`);

  // Stop the reconnect timer first, so a retry cannot fire mid-teardown and
  // open a gateway connection while everything else is closing.
  if (discordRetryTimer) {
    clearInterval(discordRetryTimer);
    discordRetryTimer = null;
  }

  // Stop the scheduler next so no new generation run starts while the
  // remaining dependencies are being torn down.
  await stopScheduler().catch((err) => logger.warn('Scheduler shutdown failed', err?.message));

  // Stop accepting new connections, then let in-flight requests finish. The
  // force-close timer guarantees exit even if one hangs.
  await new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(() => {
      logger.warn('HTTP server did not close in time — forcing exit');
      resolve();
    }, 10_000).unref();
  });

  await stopDiscord().catch((err) => logger.warn('Discord shutdown failed', err?.message));
  await disconnectDatabase().catch((err) => logger.warn('Database shutdown failed', err?.message));

  logger.info('Shutdown complete');
}

/**
 * Starts the whole application.
 *
 * @returns {Promise<void>}
 * @throws {Error} When a required dependency cannot be reached.
 * @sideeffect Opens a database connection, an HTTP listener, a Discord gateway
 *   connection and a cron schedule.
 */
async function main() {
  logger.info(`BrandLoop starting — ${env.NODE_ENV}, provider ${env.AI_PROVIDER}, model ${env.TEXT_MODEL}`);

  // 2. Database. A failure here is fatal: every route needs it, so serving
  //    without one would only produce confusing 500s.
  await connectDatabase();

  // 3. HTTP.
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`HTTP listening on http://localhost:${env.PORT} (health at /health)`);
  });

  // 4. Discord. Failure is not fatal — the API, the plan endpoints and the dev
  //    triggers all remain usable. The connection is retried in the background
  //    rather than abandoned, because the gateway is intermittent from this
  //    network and an unlucky boot should not mean a dead scheduler.
  let discordReady = false;
  try {
    await connectDiscord();
    discordReady = true;
  } catch (err) {
    logger.warn(
      'Discord unavailable at startup — the HTTP API is up and the connection will be ' +
        'retried every 60s. Until it succeeds, drafts cannot be delivered, so the ' +
        'scheduler is held back.',
      String(err?.message).split('\n')[0],
    );
  }

  // 5. Scheduler, only when delivery is actually possible.
  if (discordReady) {
    startScheduler();
  } else {
    retryDiscordInBackground();
  }

  /**
   * Reports the final state so a start-up problem is visible in the log rather
   * than inferred from behaviour.
   */
  logger.info(
    `BrandLoop ready — api: yes, discord: ${discordReady ? 'yes' : 'no'}, ` +
      `scheduler: ${discordReady && env.CRON_ENABLED ? env.CRON_DAILY_POST_SCHEDULE : 'off'}`,
  );

  // Signal handlers. `once` rather than `on`: a second Ctrl-C during a slow
  // drain should not start a second teardown.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown({ server, signal })
        .then(() => process.exit(0))
        .catch((err) => {
          logger.error('Shutdown failed', err);
          process.exit(1);
        });
    });
  }

  // A crash here is a bug rather than a routine failure, so it is logged with
  // the stack and the process exits non-zero to let a supervisor restart it.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — the process is now in an unknown state', err);
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error('Failed to start BrandLoop', err);
  process.exit(1);
});
