/**
 * ApiError — an Error that carries an HTTP status code.
 *
 * RESPONSIBILITY
 *   Represent an expected, user-correctable failure with a status code and a
 *   client-safe message, so the Express error handler can respond correctly
 *   without inspecting the error's text.
 *
 * WHY A CLASS RATHER THAN PLAIN OBJECTS
 *   `errorMiddleware` distinguishes a deliberate ApiError (safe to show the
 *   client) from an unexpected throw (must be logged and hidden behind a
 *   generic body). `instanceof` is the clearest way to make that distinction,
 *   and it makes the intent obvious at every throw site.
 *
 * DOES NOT OWN: unexpected errors. A TypeError from a bad property access is
 * not an ApiError and should surface as a 500, not as a clean 4xx.
 */

/**
 * An operational error with an associated HTTP status code.
 *
 * @extends Error
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode - HTTP status to send to the client.
   * @param {string} message - Client-safe explanation. Never include secrets,
   *   stack details, or upstream provider text here.
   * @param {object} [options]
   * @param {unknown} [options.details] - Extra machine-readable context. Only
   *   attached in non-production; see `toJSON`.
   * @param {Error} [options.cause] - The underlying error, preserved for logs
   *   but never serialised to the client.
   */
  constructor(statusCode, message, { details, cause } = {}) {
    super(message);

    /** @type {string} Identifies deliberate API errors during error handling. */
    this.name = 'ApiError';
    /** @type {number} HTTP status to respond with. */
    this.statusCode = statusCode;
    /** @type {unknown} Optional machine-readable context. */
    this.details = details;
    /** @type {boolean} Marks this as expected, so no stack trace is reported. */
    this.isOperational = true;

    if (cause) this.cause = cause;

    // Trims this constructor's own frame from the stack, so a logged stack
    // points at the code that threw rather than at this file.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    }
  }

  /**
   * 400 — the request body or parameters are invalid.
   * @param {string} [message='Invalid request'] - Client-safe explanation.
   * @param {unknown} [details] - Which field failed, and why.
   * @returns {ApiError} The constructed error.
   */
  static badRequest(message = 'Invalid request', details) {
    return new ApiError(400, message, { details });
  }

  /**
   * 401 — no valid credentials were presented.
   * @param {string} [message='Authentication required'] - Client-safe explanation.
   * @returns {ApiError} The constructed error.
   */
  static unauthorized(message = 'Authentication required') {
    return new ApiError(401, message);
  }

  /**
   * 403 — authenticated, but not permitted to touch this resource.
   * Used when a user requests a plan or post that belongs to someone else.
   * @param {string} [message='Not permitted'] - Client-safe explanation.
   * @returns {ApiError} The constructed error.
   */
  static forbidden(message = 'Not permitted') {
    return new ApiError(403, message);
  }

  /**
   * 404 — the resource does not exist, or is not visible to this user.
   * @param {string} [message='Not found'] - Client-safe explanation.
   * @returns {ApiError} The constructed error.
   */
  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  /**
   * 409 — the request conflicts with current state.
   * Used for a plan that is already approved, or a Discord account already linked.
   * @param {string} [message='Conflict'] - Client-safe explanation.
   * @returns {ApiError} The constructed error.
   */
  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  /**
   * 429 — a per-user quota is exhausted.
   * @param {string} [message='Quota exceeded'] - Client-safe explanation.
   * @param {unknown} [details] - Which quota, and when it resets.
   * @returns {ApiError} The constructed error.
   */
  static tooManyRequests(message = 'Quota exceeded', details) {
    return new ApiError(429, message, { details });
  }

  /**
   * 502 — an upstream provider (AI, Discord, RSS) failed.
   * Distinguished from 500 because the fault is not ours, and it is worth
   * retrying rather than reporting as a bug.
   * @param {string} [message='Upstream provider failed'] - Client-safe explanation.
   * @param {Error} [cause] - The provider error, kept for logs only.
   * @returns {ApiError} The constructed error.
   */
  static upstream(message = 'Upstream provider failed', cause) {
    return new ApiError(502, message, { cause });
  }

  /**
   * 500 — a deliberate internal failure with a safe message.
   * @param {string} [message='Internal error'] - Client-safe explanation.
   * @returns {ApiError} The constructed error.
   */
  static internal(message = 'Internal error') {
    return new ApiError(500, message);
  }

  /**
   * Serialises for an HTTP response body.
   *
   * `details` is included only outside production: it frequently contains
   * internal identifiers that are useful while developing and unnecessary
   * to expose once deployed.
   *
   * @param {boolean} [includeDetails=false] - Whether to attach `details`.
   * @returns {{error: string, message: string, details?: unknown}} Response body.
   */
  toJSON(includeDetails = false) {
    const body = { error: this.name, message: this.message };
    if (includeDetails && this.details !== undefined) {
      body.details = this.details;
    }
    return body;
  }
}

export default ApiError;
