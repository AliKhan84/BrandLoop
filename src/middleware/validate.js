/**
 * Request body validation.
 *
 * RESPONSIBILITY
 *   Validate and coerce request bodies against Zod schemas before a route
 *   handler sees them.
 *
 * WHY THIS REPLACES THE RAW BODY
 *   On success the parsed result is written back to `req.body`. That means a
 *   handler receives coerced, known-shape data — a numeric field is a number,
 *   an unknown field is gone. Handlers can then read properties without
 *   defensive checks, and an unexpected extra field cannot reach a Mongoose
 *   update and set something it should not.
 *
 * DOES NOT OWN: authentication (that is `auth.js`) or business rules — a schema
 * checks shape, not whether the operation makes sense.
 */

import { ApiError } from '../utils/ApiError.js';

/**
 * Builds middleware that validates `req.body` against a Zod schema.
 *
 * @param {import('zod').ZodType} schema - The schema to validate against.
 * @returns {import('express').RequestHandler} Middleware that either replaces
 *   `req.body` with the parsed value or calls `next` with a 400.
 * @sideeffect Mutates `req.body` on success.
 */
export function validateBody(schema) {
  return function validate(req, res, next) {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Every field problem is returned at once, so a client can fix the whole
      // payload in one round trip instead of discovering issues one at a time.
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(body)',
        message: issue.message,
      }));

      return next(ApiError.badRequest('Request body failed validation.', details));
    }

    req.body = result.data;
    return next();
  };
}

/**
 * Builds middleware that validates `req.query` against a Zod schema.
 *
 * Query values are all strings, so schemas used here should coerce explicitly
 * (e.g. `z.coerce.number()`).
 *
 * @param {import('zod').ZodType} schema - The schema to validate against.
 * @returns {import('express').RequestHandler} Middleware that either replaces
 *   `req.query` with the parsed value or calls `next` with a 400.
 * @sideeffect Mutates `req.query` on success — Express 5 makes this writable.
 */
export function validateQuery(schema) {
  return function validate(req, res, next) {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(query)',
        message: issue.message,
      }));

      return next(ApiError.badRequest('Query parameters failed validation.', details));
    }

    req.validatedQuery = result.data;
    return next();
  };
}

export default { validateBody, validateQuery };
