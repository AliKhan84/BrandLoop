/**
 * MongoDB connection management.
 *
 * RESPONSIBILITY
 *   Open exactly one Mongoose connection, retry transient failures with
 *   backoff, and close cleanly on shutdown.
 *
 * WHY AN EXPLICIT DATABASE NAME
 *   The value in `.env` currently has no database segment
 *   (`.../mongodb.net/?appName=Cluster0`). MongoDB does not error on that — it
 *   silently uses a database called `test`. Everything appears to work until
 *   you look for your data and cannot find it. Passing `dbName` explicitly
 *   makes the destination unambiguous regardless of how the URI is written,
 *   which was confirmed by probe before this file was written.
 *
 * WHY RETRY WITH BACKOFF
 *   Atlas M0 clusters sleep when idle, and a cold start can reject the first
 *   connection. Failing immediately would mean a scheduled job dies because
 *   the database was briefly waking up. Backoff turns that into a short pause.
 *
 * WHY THE CONNECTION CAN BE GONE *AFTER* A SUCCESSFUL START
 *   Losing the network — a laptop sleeping, a cluster waking up — leaves the
 *   driver reconnecting while HTTP keeps serving. Queries fail in that window,
 *   which is why `isDatabaseConnected` exists and why `errorHandler` answers
 *   503 rather than 500: it is an outage, not a defect.
 *
 * DOES NOT OWN: model definitions, or deciding what to do when the database is
 * unreachable — `src/index.js` owns the startup decision to abort.
 */

import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Tracks whether we have registered the connection event listeners.
 *
 * WHY: `connection.on(...)` adds a new listener every call, so connecting more
 * than once (a test suite, or a reconnect) would multiply the log lines. This
 * keeps registration to a single pass per process.
 */
let listenersRegistered = false;

/**
 * Attaches logging to Mongoose's connection lifecycle events.
 *
 * Only registered once per process. All output goes through the redacting
 * logger, because a failed connection string often contains credentials.
 *
 * @returns {void}
 * @sideeffect Adds listeners to the Mongoose connection.
 */
function registerConnectionListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  mongoose.connection.on('connected', () => {
    logger.info(`MongoDB connected → database "${mongoose.connection.name}"`);
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  // A connection-level error is logged but not thrown: Mongoose emits this for
  // recoverable problems too, and the driver's own reconnect logic handles most
  // of them. Throwing here would crash on a blip.
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB connection error', err);
  });
}

/**
 * Connects to MongoDB, retrying transient failures with exponential backoff.
 *
 * Resolves once the connection is usable. Rejects with the final error if
 * every attempt fails, so the caller can decide whether to abort startup.
 *
 * @param {object} [options]
 * @param {number} [options.retries=5] - Total attempts before giving up.
 * @param {number} [options.baseDelayMs=1000] - First backoff delay; doubles each attempt.
 * @returns {Promise<import('mongoose').Mongoose>} The connected Mongoose instance.
 * @throws {Error} The last connection error, after all retries are exhausted.
 * @sideeffect Opens a network connection and registers lifecycle listeners.
 */
export async function connectDatabase({ retries = 5, baseDelayMs = 1000 } = {}) {
  registerConnectionListeners();

  // Already connected (a second call from a script) — nothing to do.
  if (mongoose.connection.readyState === 1) return mongoose;

  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, {
        // Overrides any database name (or absence of one) in the URI.
        dbName: env.MONGODB_DB_NAME,
        // Give up on a single attempt after 10s rather than hanging on a
        // blocked network, so the retry loop can actually advance.
        serverSelectionTimeoutMS: 10_000,
        // WHY NO BUFFERING: by default a query issued while the connection is
        // down waits for the driver's default buffer timeout, *then* throws —
        // so an Atlas blip turns a request into a ten-second hang followed by a
        // 500. Failing immediately lets `errorHandler` answer 503 while the
        // driver reconnects in the background, which is both faster and true:
        // the request cannot be served, and retrying will work.
        bufferCommands: false,
      });

      return mongoose;
    } catch (err) {
      lastError = err;

      // Last attempt — stop scheduling sleeps and fall through to the throw.
      if (attempt === retries) break;

      const delay = baseDelayMs * 2 ** (attempt - 1);
      logger.warn(`MongoDB connection attempt ${attempt}/${retries} failed, retrying in ${delay}ms`, err.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error(`MongoDB connection failed after ${retries} attempts`);
  throw lastError;
}

/**
 * Closes the MongoDB connection if one is open.
 *
 * Safe to call when already disconnected, so it can be wired directly into a
 * shutdown handler without a guard at every call site.
 *
 * @returns {Promise<void>}
 * @sideeffect Closes the connection and any underlying sockets.
 */
export async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info('MongoDB connection closed');
}

/**
 * Reports whether the database connection is currently usable.
 *
 * Used by the health endpoint, which must report a database outage without
 * attempting a query that would hang.
 *
 * @returns {boolean} True when Mongoose reports a live connection.
 * @sideeffect none
 */
export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

export default { connectDatabase, disconnectDatabase, isDatabaseConnected };
