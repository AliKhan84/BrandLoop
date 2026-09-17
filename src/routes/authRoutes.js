/**
 * Authentication routes — register, log in, and generate a Discord link code.
 *
 * RESPONSIBILITY
 *   Own the three endpoints that establish identity.
 *
 * WHY REGISTER RETURNS A TOKEN
 *   Signing up and then having to log in again is a pointless round trip, and
 *   it makes the demo script longer for no benefit. The token is issued from
 *   the same code path as `/login`, so there is one place that mints one.
 *
 * DOES NOT OWN: password hashing (the `User` model) or token verification
 * (`middleware/auth.js`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { User } from '../models/User.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { generateLinkCode } from './linkCode.js';
import { ApiError } from '../utils/ApiError.js';
import { VALID_POST_FREQUENCIES, VALID_PLAN_DURATIONS } from '../config/constants.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * Registration payload.
 *
 * `inputPoints` is optional but is the single biggest lever on output quality —
 * without it every post a user generates reads like generic industry commentary.
 */
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // 8 characters minimum. Length matters far more than composition rules, which
  // mostly push people toward predictable substitutions.
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  name: z.string().trim().max(80).optional().default(''),
  niche: z.string().trim().max(200).optional().default(''),
  inputPoints: z.array(z.string().trim().min(1)).max(20).optional().default([]),
  postFrequency: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional().default(3),
  defaultPlanDuration: z.union([z.literal(7), z.literal(30)]).optional().default(7),
});

/** Login payload. */
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/register — creates an account and returns a token.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 201 with the user and token.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 when the email is already registered.
 * @sideeffect Writes a user document.
 */
router.post('/register', validateBody(registerSchema), async (req, res) => {
  const { email, password, name, niche, inputPoints, postFrequency, defaultPlanDuration } = req.body;

  // Checked explicitly so the client gets a clear message. The unique index on
  // email is still the real guarantee — two simultaneous registrations would
  // otherwise both pass this check.
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  const user = new User({
    email,
    name,
    niche,
    inputPoints,
    postFrequency,
    defaultPlanDuration,
  });

  await user.setPassword(password);
  await user.save();

  logger.info(`Registered user ${user._id} (${email})`);

  res.status(201).json({
    user: user.toPublicJSON(),
    token: signToken(user),
  });
});

/**
 * POST /api/auth/login — exchanges credentials for a token.
 *
 * @param {import('express').Request} req - Validated body.
 * @param {import('express').Response} res - Responds 200 with the user and token.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 when the credentials do not match.
 * @sideeffect none beyond the database read.
 */
router.post('/login', validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  // `passwordHash` is `select: false`, so it must be requested explicitly here.
  const user = await User.findOne({ email }).select('+passwordHash');

  // One message for both "no such user" and "wrong password". Distinguishing
  // them would let anyone enumerate which emails have accounts.
  const valid = user ? await user.verifyPassword(password) : false;

  if (!valid) {
    throw ApiError.unauthorized('Incorrect email or password.');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account is deactivated.');
  }

  res.json({
    user: user.toPublicJSON(),
    token: signToken(user),
  });
});

/**
 * POST /api/auth/discord/link-code — issues a short-lived code to type into Discord.
 *
 * WHY `requireAuth` IS APPLIED HERE AND NOT AT THE ROUTER
 *   Every other router in this app calls `router.use(requireAuth)` once, because
 *   every route in them is private. This router cannot: `/register`, `/login`
 *   and `/options` must stay public. So the middleware goes on the individual
 *   route.
 *
 *   It was missing here, and the `if (!req.user)` guard below did not catch it —
 *   that guard only ever fired, because `requireAuth` is what populates
 *   `req.user`. The route returned 401 to every caller, including signed-in
 *   ones, and "Get a link code" could never work. A guard that reads a value
 *   only the missing middleware would have set cannot detect the middleware's
 *   absence; it just fails closed, which looks like correct authentication
 *   behaviour from the outside.
 *
 * @param {import('express').Request} req - Authenticated by `requireAuth`.
 * @param {import('express').Response} res - Responds 201 with the code and its expiry.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 when unauthenticated.
 * @sideeffect Writes the code onto the user document.
 */
router.post('/discord/link-code', requireAuth, async (req, res) => {
  const { code, expiresAt } = generateLinkCode();

  req.user.discordLinkCode = code;
  req.user.discordLinkCodeExpiresAt = expiresAt;
  await req.user.save();

  res.status(201).json({
    code,
    expiresAt,
    instructions: `In Discord, run: /connect ${code}`,
  });
});

/** Where supported plan durations and frequencies are advertised to clients. */
router.get('/options', (req, res) => {
  res.json({
    planDurations: VALID_PLAN_DURATIONS,
    postFrequencies: VALID_POST_FREQUENCIES,
  });
});

export default router;
