/**
 * Authentication routes — register, log in, verify an address, and generate a
 * Discord link code.
 *
 * RESPONSIBILITY
 *   Own the endpoints that establish identity, and the two that confirm the
 *   address behind it.
 *
 * WHY REGISTER RETURNS A TOKEN
 *   Signing up and then having to log in again is a pointless round trip, and
 *   it makes the demo script longer for no benefit. The token is issued from
 *   the same code path as `/login`, so there is one place that mints one.
 *
 * WHY VERIFICATION IS SOFT
 *   An unverified account works normally and the dashboard asks it to confirm.
 *   Refusing to sign in until an email arrives would let one wrong credential
 *   lock every new account out — a worse failure than an unconfirmed address.
 *
 * DOES NOT OWN: password hashing (the `User` model), token verification
 * (`middleware/auth.js`), or the mail itself (`services/email/`).
 */

import { Router } from 'express';
import { z } from 'zod';

import { User } from '../models/User.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { generateLinkCode } from './linkCode.js';
import { issueVerification, consumeVerification, loadForResend } from '../services/email/verification.js';
import { resendAllowedAt } from '../utils/emailToken.js';
import { ApiError } from '../utils/ApiError.js';
import { VALID_POST_FREQUENCIES, VALID_PLAN_DURATIONS, PLAN_TIER, SIGNUP_TRIAL_DAYS } from '../config/constants.js';
import { env } from '../config/env.js';
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

/** Verification payload — the raw token from the link in the email. */
const verifyEmailSchema = z.object({
  token: z.string().trim().min(10, 'A verification token is required.'),
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

  // Every new account starts on Pro for `SIGNUP_TRIAL_DAYS`. Applied here rather
  // than as a schema default so the grant is visible in the code that creates
  // the account, and so setting the env value to 0 switches it off cleanly
  // instead of leaving a half-applied rule behind.
  if (SIGNUP_TRIAL_DAYS > 0) {
    user.plan = PLAN_TIER.PRO;
    user.planExpiresAt = new Date(Date.now() + SIGNUP_TRIAL_DAYS * 24 * 60 * 60 * 1000);
    user.signupTrialAppliedAt = new Date();
  }

  await user.save();

  logger.info(
    `Registered user ${user._id} (${email})` +
      (SIGNUP_TRIAL_DAYS > 0 ? ` — ${SIGNUP_TRIAL_DAYS} days of Pro` : ''),
  );

  // Sent after the account exists, and never fatal: a mail server that is down
  // must not cost someone their signup, so `issueVerification` reports rather
  // than throws. The client is told which of the two happened, so it can say
  // "check your inbox" or "we could not send it" truthfully.
  const verification = await issueVerification(user);

  res.status(201).json({
    user: user.toPublicJSON(),
    token: signToken(user),
    verification: { sent: verification.sent, reason: verification.reason },
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

/**
 * POST /api/auth/verify-email — redeems the token from a verification link.
 *
 * PUBLIC BY NECESSITY, and that is not a hole: the token *is* the credential.
 * Someone may open the link on a phone where they are not signed in, and
 * requiring a session first would mean the most common way of clicking an email
 * link fails. The token is single-use and expiring, which is what bounds it.
 *
 * @param {import('express').Request} req - Body carries the raw token.
 * @param {import('express').Response} res - Responds 200 with the updated user.
 * @returns {Promise<void>}
 * @throws {ApiError} 400 when the token is unknown, already used, or expired.
 * @sideeffect Marks the user verified.
 */
router.post('/verify-email', validateBody(verifyEmailSchema), async (req, res) => {
  const result = await consumeVerification(req.body.token);

  if (!result.ok) {
    // Two different messages, because they call for different actions: an
    // expired link needs a new one, a used link usually means it worked already.
    throw ApiError.badRequest(
      result.reason === 'expired'
        ? 'That verification link has expired. Request a new one from the dashboard.'
        : 'That verification link is not valid. It may already have been used.',
    );
  }

  res.json({ user: result.user.toPublicJSON(), emailVerified: true });
});

/**
 * POST /api/auth/resend-verification — sends a fresh verification link.
 *
 * Rate limited by a per-user cooldown rather than a middleware limiter: the
 * cost being protected here is the provider's daily sending quota, which is
 * per account, so the rule belongs with the account.
 *
 * @param {import('express').Request} req - Authenticated by `requireAuth`.
 * @param {import('express').Response} res - Responds 200 with whether it was sent.
 * @returns {Promise<void>}
 * @throws {ApiError} 401 when unauthenticated, 429 inside the cooldown.
 * @sideeffect Sends mail and rewrites the stored token.
 */
router.post('/resend-verification', requireAuth, async (req, res) => {
  if (req.user.emailVerified) {
    // Not an error — the client is asking for a state that is already true, and
    // the banner disappears on this response.
    return res.json({ emailVerified: true, sent: false, reason: 'already-verified' });
  }

  // The token fields are `select: false`, so the document on `req.user` does not
  // carry them — this is a deliberate second read rather than a wider select on
  // every authenticated request.
  const user = await loadForResend(req.user._id);
  if (!user) {
    throw ApiError.unauthorized('Your session is no longer valid. Please sign in again.');
  }

  const allowedAt = resendAllowedAt(user);
  if (allowedAt) {
    throw ApiError.tooManyRequests('A verification email was just sent. Please wait before asking for another.', {
      nextAllowedAt: allowedAt,
    });
  }

  const result = await issueVerification(user);

  logger.info(
    `Verification email for ${user.email}: ${result.sent ? 'sent' : `not sent (${result.reason})`}`,
  );

  res.json({
    sent: result.sent,
    reason: result.reason,
    nextAllowedAt: new Date(Date.now() + env.EMAIL_RESEND_COOLDOWN_SEC * 1000),
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
