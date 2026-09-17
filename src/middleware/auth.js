/**
 * JWT authentication middleware.
 *
 * RESPONSIBILITY
 *   Issue login tokens, and verify them on protected routes.
 *
 * WHY THE TOKEN CARRIES ONLY A USER ID
 *   A JWT is signed, not encrypted — anyone holding it can read its payload.
 *   Putting a role or an email in there would mean trusting a value the client
 *   can read and, if verification ever slipped, could forge. Carrying just the
 *   id means every authorisation decision is made against the database on each
 *   request, which is the only source that cannot go stale.
 *
 * DOES NOT OWN: password checking (the `User` model does that) or the login
 * routes themselves.
 */

import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';

/**
 * Signs a login token for a user.
 *
 * @param {object} user - The user document. Only `_id` is embedded.
 * @returns {string} A signed JWT.
 * @throws {Error} When `JWT_SECRET` is missing — env validation prevents this.
 * @sideeffect none (pure)
 */
export function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString() },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  );
}

/**
 * Extracts a bearer token from the Authorization header.
 *
 * @param {import('express').Request} req - The request.
 * @returns {string|null} The token, or null when the header is absent or malformed.
 * @sideeffect none (pure)
 */
function extractToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;

  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;

  return token.trim() || null;
}

/**
 * Requires a valid token and loads the authenticated user onto the request.
 *
 * Sets `req.userId` and `req.user`. Responds 401 and stops the chain otherwise.
 *
 * @param {import('express').Request} req - The request.
 * @param {import('express').Response} res - The response.
 * @param {import('express').NextFunction} next - The next handler.
 * @returns {Promise<void>}
 * @sideeffect Loads a user from the database on success.
 */
export async function requireAuth(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return next(ApiError.unauthorized('Missing or malformed Authorization header.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (err) {
    // Deliberately vague to the client: distinguishing "expired" from "invalid
    // signature" tells an attacker which half of the problem to work on.
    const reason = err?.name === 'TokenExpiredError' ? 'Session expired.' : 'Invalid token.';
    return next(ApiError.unauthorized(reason));
  }

  // The user is re-read on every request rather than trusted from the token, so
  // a deactivated account loses access immediately instead of at token expiry.
  const user = await User.findById(payload.sub);

  if (!user) {
    return next(ApiError.unauthorized('Account no longer exists.'));
  }

  if (!user.isActive) {
    return next(ApiError.forbidden('This account is deactivated.'));
  }

  req.userId = user._id.toString();
  req.user = user;

  return next();
}

export default { requireAuth, signToken };
