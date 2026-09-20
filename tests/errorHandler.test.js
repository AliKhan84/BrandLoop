/**
 * Tests for `middleware/errorHandler.js`.
 *
 * WHY THESE
 *   A database that drops out at runtime — a sleeping laptop, a waking Atlas
 *   cluster — used to reach the client as a generic 500: "Something went wrong
 *   on our end." That is both wrong and useless, because nothing is broken and
 *   the same request would succeed a moment later. It now maps to 503.
 *
 *   The ApiError cases are here because that mapping must not swallow them. An
 *   expired session has to stay a 401 while the database is down, or the
 *   dashboard would show an outage instead of asking the user to sign in again.
 *
 * These run without a database connection on purpose: no connection IS the
 * outage being tested, which is why `isDatabaseConnected()` is false throughout.
 *
 * Run with: npm test
 */

// Before anything imports `config/env.js`, so a deliberately-triggered error
// does not print a stack trace and read as a test failure.
process.env.LOG_LEVEL = 'silent';

const { test, describe } = await import('node:test');
const assert = await import('node:assert/strict');

const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { ApiError } = await import('../src/utils/ApiError.js');

/**
 * A response object that records what the handler did to it.
 *
 * @returns {object} A minimal Express response double.
 * @sideeffect none
 */
function fakeResponse() {
  return {
    headersSent: false,
    headers: {},
    statusCode: null,
    body: null,
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

/**
 * Runs one error through the handler.
 *
 * @param {unknown} error - The value to hand to the middleware.
 * @returns {object} The response double, after handling.
 * @sideeffect none
 */
function handle(error) {
  const res = fakeResponse();
  errorHandler(error, { method: 'GET', path: '/api/users/me' }, res, () => {});
  return res;
}

describe('errorHandler, while the database is unreachable', () => {
  test('reports an outage as 503 rather than 500', () => {
    const res = handle(new Error('Client must be connected before running operations'));

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'DatabaseUnavailable');
    assert.match(res.body.message, /database/i);
  });

  test('tells the client the request is worth repeating', () => {
    const res = handle(new Error('connection lost'));

    assert.equal(res.headers['Retry-After'], '5');
  });

  test('keeps a deliberate 401 a 401, so a dead session is not mistaken for an outage', () => {
    const res = handle(ApiError.unauthorized('Session expired.'));

    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, 'Session expired.');
  });

  test('keeps a deliberate 500 a 500', () => {
    const res = handle(ApiError.internal('The image was generated but could not be stored.'));

    assert.equal(res.statusCode, 500);
    assert.equal(res.body.message, 'The image was generated but could not be stored.');
  });

  test('does not leak the underlying message to the client', () => {
    const res = handle(new Error('mongodb://user:pass@cluster0.example.net refused'));

    assert.doesNotMatch(res.body.message, /mongodb|pass|cluster0/);
  });
});
