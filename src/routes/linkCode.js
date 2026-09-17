/**
 * Discord link-code generation.
 *
 * RESPONSIBILITY
 *   Produce the short numeric code a user types into Discord to prove they own
 *   a BrandLoop account.
 *
 * WHY NUMERIC AND SIX DIGITS
 *   The code is typed on a phone keyboard into a chat app. Six digits is short
 *   enough to enter comfortably and long enough that guessing is impractical
 *   inside the expiry window — a million combinations against a 15-minute TTL,
 *   with the attempt rate limited by the user having to press a button.
 *
 * WHY NOT REUSE THE SESSION
 *   The code is single-use and cleared on redemption, so a leaked code cannot
 *   be replayed. A session token in a chat message would remain valid.
 *
 * DOES NOT OWN: storing the code (the `User` model does) or redeeming it
 * (`services/discord/commands.js` does).
 */

import { randomInt } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Generates a random six-digit code and its expiry.
 *
 * Uses `crypto.randomInt` rather than `Math.random`: the latter is seeded
 * predictably enough that an attacker who observes a few codes could narrow the
 * next one. This is a security boundary, so it uses the cryptographic source.
 *
 * @returns {{code: string, expiresAt: Date}} The code and when it stops working.
 * @sideeffect none (pure)
 */
export function generateLinkCode() {
  // randomInt is exclusive of the upper bound, so 100000–999999 is six digits
  // with no leading zero — a leading zero would render as five digits and look
  // like a truncated code to the user.
  const code = String(randomInt(100_000, 1_000_000));

  const expiresAt = new Date(Date.now() + env.DISCORD_LINK_CODE_TTL_MIN * 60_000);

  return { code, expiresAt };
}

/**
 * Reports whether a stored code is still valid.
 *
 * @param {object} user - The user document, loaded with the code fields selected.
 * @returns {boolean} True when a code exists and has not expired.
 * @sideeffect none (pure)
 */
export function isLinkCodeValid(user) {
  if (!user?.discordLinkCode || !user?.discordLinkCodeExpiresAt) return false;
  return user.discordLinkCodeExpiresAt > new Date();
}

export default { generateLinkCode, isLinkCodeValid };
