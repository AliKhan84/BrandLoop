/**
 * Express application wiring.
 *
 * RESPONSIBILITY
 *   Assemble the HTTP layer: middleware, static media, routes, and the error
 *   handlers that must be registered last.
 *
 * WHY THIS IS SEPARATE FROM `index.js`
 *   `createApp` returns an app without opening a port, connecting to Discord
 *   or starting a cron schedule. That means an integration test can mount the
 *   real routes against the real database without a gateway connection or a
 *   timer, and the process lifecycle stays in one file where it can be read
 *   top to bottom.
 *
 * DOES NOT OWN: connections, scheduling, or the process lifecycle.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { MEDIA_DIR } from './config/constants.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { isDatabaseConnected } from './db/connect.js';
import { isDiscordReady } from './services/discord/client.js';
import { isSchedulerRunning } from './jobs/scheduler.js';

import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import planRoutes from './routes/planRoutes.js';
import postRoutes from './routes/postRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import devRoutes from './routes/devRoutes.js';

/** Absolute path to the project root, derived from this file's location. */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Builds the Express application.
 *
 * @returns {import('express').Express} The configured app, not yet listening.
 * @sideeffect Registers routes and middleware.
 */
export function createApp() {
  const app = express();

  // Required for `req.ip` to be the real client rather than the proxy. Only
  // meaningful behind a reverse proxy, and harmless when not.
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // Body parsing. The limit is generous enough for a 20-item inputPoints array
  // and small enough that a large payload is rejected before it reaches a route.
  app.use(express.json({ limit: '1mb' }));

  /**
   * GET /health — liveness and dependency status.
   *
   * Reports each dependency separately so a failure says *which* one is down.
   * A single boolean would leave you guessing between the database, the
   * gateway and the scheduler.
   *
   * Responds 200 whenever the process is serving, even with a degraded
   * dependency — a 503 here would make an orchestrator restart a process that
   * is working correctly but waiting on Discord.
   */
  app.get('/health', (req, res) => {
    const database = isDatabaseConnected();
    const discord = isDiscordReady();

    res.json({
      status: database ? 'ok' : 'degraded',
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: {
        database,
        discord,
        scheduler: isSchedulerRunning(),
      },
      config: {
        provider: env.AI_PROVIDER,
        textModel: env.TEXT_MODEL,
        env: env.NODE_ENV,
        devTools: env.DEV_TOOLS_ENABLED,
      },
    });
  });

  // Generated images are served from disk. In this build nothing writes there
  // (Phase 3 is deferred), but the route is in place so enabling image
  // generation needs no change to this file.
  app.use(`/${MEDIA_DIR}`, express.static(path.join(projectRoot, MEDIA_DIR), {
    // Filenames are post ids, so contents never change for a given name.
    maxAge: '1h',
    fallthrough: true,
  }));

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/billing', billingRoutes);
  // Admin routes carry their own role guard, applied on the router.
  app.use('/api/admin', adminRoutes);
  // The dev router gates itself on DEV_TOOLS_ENABLED before doing anything.
  app.use('/api/dev', devRoutes);

  // A root route so a browser hitting the server gets an explanation rather
  // than a bare 404.
  app.get('/', (req, res) => {
    res.json({
      name: 'BrandLoop',
      description: 'Social branding agent — Phase 1 (planning, generation, Discord approval, assisted publishing).',
      health: '/health',
      docs: '/docs/IMPLEMENTATION-PLAN.md',
    });
  });

  // Order matters: unmatched routes become a 404, and the error handler must be
  // the very last middleware so it catches everything above it.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
