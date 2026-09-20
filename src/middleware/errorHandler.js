/**
 * Express error handling.
 *
 * RESPONSIBILITY
 *   Convert any thrown value into a correct HTTP response, and make sure
 *   unexpected errors are logged without leaking internals to the client.
 *
 * WHY THE DISTINCTION BETWEEN ApiError AND EVERYTHING ELSE
 *   An `ApiError` is deliberate: someone decided this failure is expected and
 *   wrote a message safe to show a user. Anything else is a bug — a typo, a
 *   null dereference, a provider returning an unexpected shape. Those get a
 *   generic body and a full stack in the server log, because a stack trace in
 *   an HTTP response tells an attacker about the internals and tells the user
 *   nothing useful.
 *
 * WHY THIS WORKS WITHOUT A WRAPPER
 *   Express 5 forwards rejected promises from async handlers to this middleware
 *   automatically. On Express 4 every async route needed an `asyncHandler`
 *   wrapper; that is no longer the case here, which is why no route in this
 *   codebase has one.
 *
 * WHY A DISCONNECTED DATABASE IS NOT A 500
 *   Every authenticated route needs Mongo — `requireAuth` re-reads the user on
 *   each request — so a connection lost at runtime (a sleeping laptop, a waking
 *   Atlas cluster) fails requests that are perfectly valid. Reporting that as
 *   500 says "this code is broken" to both the log reader and the client, when
 *   the truth is "this will work again in a moment". 503 says the second thing,
 *   and it is the difference between a user retrying and a user filing a bug.
 *
 *   `ApiError`s keep their own statuses regardless: an expired session must
 *   still answer 401 while the database is down, or the dashboard would treat a
 *   dead session as an outage and never ask the user to sign in again.
 *
 * DOES NOT OWN: deciding what counts as an error, or retry logic.
 */

import { env } from '../config/env.js';
import { isDatabaseConnected } from '../db/connect.js';
import { ApiError } from '../utils/ApiError.js';
import { logger, safeString } from '../utils/logger.js';

/**
 * Handles any request that matched no route.
 *
 * @param {import('express').Request} req - The request.
 * @param {import('express').Response} res - The response.
 * @param {import('express').NextFunction} next - Passes an ApiError onward.
 * @returns {void}
 * @sideeffect Calls `next` with a 404 ApiError.
 */
export function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`No route matches ${req.method} ${req.path}.`));
}

/**
 * Terminal error middleware.
 *
 * MUST keep all four parameters. Express identifies error middleware by
 * `fn.length === 4`, so dropping the unused `next` silently turns this into an
 * ordinary handler that never runs on an error.
 *
 * @param {unknown} err - The thrown value.
 * @param {import('express').Request} req - The request.
 * @param {import('express').Response} res - The response.
 * @param {import('express').NextFunction} next - Unused, required for arity.
 * @returns {void}
 * @sideeffect Logs and sends a response.
 */
export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const isApiError = err instanceof ApiError;

  // Checked before the status is decided, because it changes both the response
  // and how the failure should be logged.
  const databaseDown = !isApiError && !isDatabaseConnected();

  const statusCode = isApiError ? err.statusCode : databaseDown ? 503 : 500;

  // Deliberate failures are logged at warn — they are expected and do not need
  // a stack trace. Anything else is a bug and gets the full treatment.
  if (isApiError && statusCode < 500) {
    logger.warn(`${req.method} ${req.path} → ${statusCode}: ${err.message}`);
  } else {
    logger.error(`${req.method} ${req.path} → ${statusCode}`, err);

    // Upstream failures keep their cause in the log, since the client-facing
    // message is intentionally generic.
    if (err?.cause) logger.error('  caused by:', safeString(err.cause));
  }

  // A response may already be half-written if the failure happened during
  // streaming. Delegating to Express's default handler is the only correct move.
  if (res.headersSent) return next(err);

  if (isApiError) {
    return res.status(statusCode).json(err.toJSON(!env.isProduction));
  }

  if (databaseDown) {
    // Tells a client (or a proxy) that the same request is worth repeating,
    // which is exactly the case here.
    res.set('Retry-After', '5');

    return res.status(503).json({
      error: 'DatabaseUnavailable',
      message:
        'BrandLoop cannot reach its database right now. This is usually brief, and nothing was changed — try again in a moment.',
    });
  }

  return res.status(500).json({
    error: 'InternalError',
    message: 'Something went wrong on our end. The details have been logged.',
  });
}

export default { notFoundHandler, errorHandler };
