/**
 * User model — an account, its brand profile, and its Discord link.
 *
 * RESPONSIBILITY
 *   Persist the account, the niche and personal input the generator writes
 *   from, and the Discord identity that drafts get delivered to.
 *
 * WHY THE PASSWORD IS HASHED IN THE MODEL
 *   Keeping `setPassword` / `verifyPassword` next to the field they protect
 *   means there is one place that knows the hashing rules. A service that
 *   forgot to hash would store a plaintext password that still *looks* fine in
 *   the database. bcrypt with a work factor of 12 is deliberately slow.
 *
 * DOES NOT OWN: sessions, JWT issuance, or quota counters (see `Usage`).
 */

import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import {
  PLATFORM,
  VALID_PLAN_DURATIONS,
  VALID_POST_FREQUENCIES,
} from '../config/constants.js';

/** bcrypt work factor. Higher is slower to crack and slower to log in. */
const BCRYPT_ROUNDS = 12;

const { Schema } = mongoose;

const userSchema = new Schema(
  {
    /** Unique, lowercased. Used as the login identifier. */
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    /**
     * bcrypt hash of the password. Never the plaintext.
     * `select: false` keeps it out of every query result by default, so it can
     * only be read by explicitly asking for it — accidental exposure in an API
     * response becomes impossible rather than merely unlikely.
     */
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },

    /** Display name, used in Discord messages. */
    name: {
      type: String,
      trim: true,
      default: '',
    },

    // ── Brand profile ───────────────────────────────────────────────────────
    /** The user's field of expertise, e.g. "AI in healthcare". Drives all generation. */
    niche: {
      type: String,
      trim: true,
      default: '',
    },

    /**
     * The user's own opinions, facts and anecdotes, supplied at signup.
     *
     * WHY THIS EXISTS: without it the generator produces generic advice that
     * reads like everyone else's feed. These points are injected into the
     * prompt so posts carry the user's actual perspective — it is the main
     * difference between a useful tool and a content mill.
     */
    inputPoints: {
      type: [String],
      default: [],
    },

    /** Posts per week. Must be one of VALID_POST_FREQUENCIES. */
    postFrequency: {
      type: Number,
      enum: VALID_POST_FREQUENCIES,
      default: 3,
    },

    /** Preferred plan length in days. Must be one of VALID_PLAN_DURATIONS. */
    defaultPlanDuration: {
      type: Number,
      enum: VALID_PLAN_DURATIONS,
      default: 7,
    },

    /** IANA timezone, recorded for future scheduling decisions. */
    timezone: {
      type: String,
      default: 'UTC',
    },

    /** Platforms to generate for. Both by default (PRD §5). */
    platforms: {
      type: [String],
      enum: Object.values(PLATFORM),
      default: () => Object.values(PLATFORM),
    },

    // ── Discord link ────────────────────────────────────────────────────────
    /**
     * The user's Discord snowflake id. Null until `/connect` succeeds.
     * The daily job skips users whose value is null, because there is nowhere
     * to deliver their drafts.
     */
    discordUserId: {
      type: String,
      default: null,
      index: true,
    },

    /**
     * Short-lived code the user types into Discord to prove account ownership.
     * Deliberately avoids asking for a website password inside a chat app.
     */
    discordLinkCode: {
      type: String,
      default: null,
      select: false,
    },

    /** When `discordLinkCode` stops being valid. */
    discordLinkCodeExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    // ── Lifecycle ───────────────────────────────────────────────────────────
    /** Paused users keep their data but are skipped by the scheduler. */
    isActive: {
      type: Boolean,
      default: true,
    },

    /** When a plan finishes, automatically start a fresh one on the next run. */
    autoRenewPlan: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    // Suppresses the internal __v field — nothing here does optimistic locking.
    versionKey: false,
  },
);

/**
 * Hashes and stores a new password.
 *
 * Assigns to `passwordHash`; the caller must still `save()` the document.
 *
 * @param {string} plainText - The password as entered.
 * @returns {Promise<void>}
 * @throws {Error} When bcrypt fails, or the password is empty.
 * @sideeffect Mutates `this.passwordHash`.
 */
userSchema.methods.setPassword = async function setPassword(plainText) {
  if (typeof plainText !== 'string' || plainText.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  this.passwordHash = await bcrypt.hash(plainText, BCRYPT_ROUNDS);
};

/**
 * Checks a plaintext password against the stored hash.
 *
 * The document must have been loaded with `.select('+passwordHash')` —
 * otherwise `passwordHash` is undefined and this always returns false.
 *
 * @param {string} plainText - The password to check.
 * @returns {Promise<boolean>} True when the password matches.
 * @sideeffect none
 */
userSchema.methods.verifyPassword = async function verifyPassword(plainText) {
  if (!this.passwordHash || typeof plainText !== 'string') return false;
  return bcrypt.compare(plainText, this.passwordHash);
};

/**
 * Reports whether this user can receive drafts right now.
 *
 * A user needs both an active account and a linked Discord id — drafts are
 * delivered by DM, so one without the other has nowhere to go.
 *
 * @returns {boolean} True when the scheduler should process this user.
 * @sideeffect none
 */
userSchema.methods.canReceivePosts = function canReceivePosts() {
  return Boolean(this.isActive && this.discordUserId);
};

/**
 * The public shape of a user, safe to return from an API response.
 *
 * WHY EXPLICIT: spreading the document would leak `passwordHash` the moment
 * someone removes `select: false`. Listing fields positively means new
 * sensitive fields are private by default, not public by accident.
 *
 * @returns {object} Whitelisted fields only.
 * @sideeffect none
 */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    niche: this.niche,
    inputPoints: this.inputPoints,
    postFrequency: this.postFrequency,
    defaultPlanDuration: this.defaultPlanDuration,
    platforms: this.platforms,
    timezone: this.timezone,
    discordLinked: Boolean(this.discordUserId),
    isActive: this.isActive,
    autoRenewPlan: this.autoRenewPlan,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
export default User;
