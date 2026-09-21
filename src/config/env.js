/**
 * Environment configuration — the single place that reads `process.env`.
 *
 * RESPONSIBILITY
 *   Load `.env`, validate every variable, and export one frozen, typed object.
 *   Nothing else in the codebase may touch `process.env` directly.
 *
 * WHY FAIL FAST
 *   A missing credential discovered at startup is a one-line fix. The same
 *   credential discovered three layers deep inside a scheduled job is a
 *   half-written plan and a confused user. So this module validates everything
 *   up front and exits with a readable list of what is wrong.
 *
 * DOES NOT OWN: business defaults (those live in `constants.js`), or any
 * secret ever being logged — see `utils/logger.js` for redaction.
 */

import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Loads `.env` as the authoritative configuration source.
 *
 * WHY `override: true` — this is deliberate, and it fixes a real bug found
 * during setup. dotenv's default is to leave an already-set process variable
 * alone, so a `NODE_ENV=production` inherited from the surrounding shell
 * silently beat the config file: `DEV_TOOLS_ENABLED` evaluated to false and the
 * manual pipeline triggers were disabled with no error to explain why.
 *
 * BrandLoop is self-hosted and `.env` is its config file (and is gitignored),
 * so the operator editing `.env` must be the one who decides. An invisible
 * ambient variable overriding a visible file is the harder failure to debug.
 */
dotenv.config({ override: true, quiet: true });

/**
 * Coerces a permissive env string into a real boolean.
 *
 * WHY NOT z.coerce.boolean(): in JavaScript `Boolean('false')` is `true`, so
 * coerce would turn every documented `=false` into an enabled flag — the exact
 * opposite of what the operator wrote. This parses the string properly and
 * falls back to an explicit default when the variable is absent.
 *
 * @param {boolean} fallback - Value used when the variable is unset.
 * @returns {import('zod').ZodType<boolean>} A schema producing a real boolean.
 */
function booleanFromEnv(fallback) {
  return z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined || raw.trim() === '') return fallback;
      return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
    });
}

/**
 * Trims a string env var and treats the empty string as absent.
 *
 * WHY: a trailing space or a `KEY=` line with nothing after it is the most
 * common cause of a 401 that looks like a bad key. Trimming here means the
 * probe's whitespace check is belt-and-braces rather than the only defence.
 *
 * @param {number} [minLength=1] - Minimum acceptable length after trimming.
 * @returns {import('zod').ZodType<string>} A trimmed, validated string schema.
 */
function cleanString(minLength = 1) {
  return z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= minLength, { message: `must be at least ${minLength} character(s)` });
}

/** Which AI provider implementation `services/ai/index.js` should load. */
const AI_PROVIDERS = ['gemini', 'openai'];

/**
 * The full environment schema.
 *
 * Required variables have no default — their absence is a hard failure.
 * Optional variables carry a documented default so a working dev setup only
 * needs the five credentials.
 */
const envSchema = z.object({
  // ── Identifies which AI backend to load ──────────────────────────────────
  AI_PROVIDER: z.enum(AI_PROVIDERS).default('gemini'),

  // ── Credentials (required) ───────────────────────────────────────────────
  MONGODB_URI: cleanString(10).describe('MongoDB connection string'),
  DISCORD_BOT_TOKEN: cleanString(20).describe('Discord bot token from the Developer Portal'),
  DISCORD_APP_ID: cleanString(10).describe('Discord application id, used to register slash commands'),
  JWT_SECRET: cleanString(16).describe('Signing secret for login tokens'),

  // Both AI keys are optional at the schema level because only the selected
  // provider's key is required. `resolveAiProviderKey` enforces that below.
  GEMINI_API_KEY: z.string().trim().optional(),
  OPENAI_API_KEY: z.string().trim().optional(),
  // Legacy lowercase spelling from an earlier .env — accepted so an existing
  // file does not break mid-migration, but never used when the real var exists.
  openai_api_key: z.string().trim().optional(),

  // ── Database ─────────────────────────────────────────────────────────────
  // The .env connection string has no database name, which makes Mongo silently
  // use `test`. Setting it explicitly here means the data lands where the
  // operator expects without them having to edit the URI.
  MONGODB_DB_NAME: z.string().trim().default('brandloop'),

  // ── Models ───────────────────────────────────────────────────────────────
  // Env-driven so a model rename is a config change, not a code change. The
  // catalog moves fast and `npm run probe` is the single place that validates
  // these names against the live API.
  TEXT_MODEL: z.string().trim().default('gemini-3.5-flash'),
  CHEAP_MODEL: z.string().trim().default('gemini-3.1-flash-lite'),
  IMAGE_MODEL: z.string().trim().default('gemini-3.1-flash-image'),

  // ── HTTP ─────────────────────────────────────────────────────────────────
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_BASE_URL: z.string().trim().optional(),

  /**
   * Where the dashboard runs, for links the bot hands to the user.
   *
   * Separate from PUBLIC_BASE_URL because they are different services on
   * different ports — the API serves /media and the dashboard serves pages, and
   * a single setting would have made one of those URLs wrong.
   *
   * Used for the LinkedIn "copy and open" page: LinkedIn cannot prefill post
   * text, so the link goes here instead of straight to the composer, and this
   * page puts the text on the clipboard before opening LinkedIn.
   */
  DASHBOARD_BASE_URL: z.string().trim().optional(),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ── Auth ─────────────────────────────────────────────────────────────────
  JWT_EXPIRES_IN: z.string().trim().default('7d'),
  // How long a `/connect` code stays valid before the user must request a new one.
  DISCORD_LINK_CODE_TTL_MIN: z.coerce.number().int().positive().default(15),

  // ── Scheduler ────────────────────────────────────────────────────────────
  // Default is 09:00 daily. Overridable for demos so a run can be forced.
  CRON_DAILY_POST_SCHEDULE: z.string().trim().default('0 9 * * *'),
  CRON_ENABLED: booleanFromEnv(true),

  // Manual pipeline triggers under /api/dev/*. Without these there is no way
  // to demo the loop without waiting a real day per post, so they default on
  // outside production and are force-disabled there.
  DEV_TOOLS_ENABLED: booleanFromEnv(true),

  // ── Quotas (PRD §7 — the primary cost control) ──────────────────────────
  QUOTA_PLAN_GENERATIONS_PER_DAY: z.coerce.number().int().positive().default(3),
  QUOTA_NEWS_LOOKUPS_PER_DAY: z.coerce.number().int().positive().default(2),
  QUOTA_IMAGES_PER_WEEK: z.coerce.number().int().positive().default(5),
  MAX_REGENERATIONS_PER_POST: z.coerce.number().int().positive().default(3),
  // Days of the Pro tier granted to every new signup. Zero disables the grant —
  // worth knowing before an open signup link is shared, because Pro's limits are
  // high and images are the expensive call.
  SIGNUP_TRIAL_DAYS: z.coerce.number().int().nonnegative().default(30),
  // Feedback messages per day. Nothing is paid for, but an unbounded writer is
  // an inbox nobody will read.
  QUOTA_FEEDBACK_PER_DAY: z.coerce.number().int().positive().default(5),

  // ── Platform limits ──────────────────────────────────────────────────────
  X_CHAR_LIMIT: z.coerce.number().int().positive().default(280),
  LINKEDIN_CHAR_LIMIT: z.coerce.number().int().positive().default(3000),

  // ── News ─────────────────────────────────────────────────────────────────
  // Items older than this are dropped, so a news post is genuinely recent.
  NEWS_MAX_AGE_DAYS: z.coerce.number().int().positive().default(7),

  // ── Email (address verification) ─────────────────────────────────────────
  // All optional, deliberately. With no credentials the API still boots and the
  // verification link is logged instead of sent, so a missing mail account can
  // never stop the server — and the flow stays demonstrable on a laptop. See
  // EMAIL_ENABLED in loadEnv(), which is what the email code checks.
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // true for implicit TLS on port 465, false for STARTTLS on 587. Not inferred
  // from the port: providers disagree, and a wrong guess fails as a timeout.
  SMTP_SECURE: booleanFromEnv(false),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().trim().default('BrandLoop <no-reply@brandloop.local>'),
  // A day, because the first thing a recipient does with an unexpected email is
  // look for it in the spam folder — and 15 minutes is not enough time.
  EMAIL_VERIFICATION_TTL_MIN: z.coerce.number().int().positive().default(1440),
  // Minimum gap between resends. Without it one signed-in account can burn a
  // provider's daily sending quota and get the domain flagged as a spammer.
  EMAIL_RESEND_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(60),

  // ── Misc ─────────────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});

/**
 * Verifies the API key for whichever provider is selected actually exists.
 *
 * WHY: a generic "GEMINI_API_KEY is required" message is only useful if the
 * operator knows why. This reports the failure in terms of the selected
 * provider, and accepts the legacy lowercase OpenAI spelling as a fallback.
 *
 * @param {object} raw - The parsed environment values.
 * @returns {string} The resolved API key for the active provider.
 * @throws {Error} When the active provider has no key configured.
 */
function resolveAiProviderKey(raw) {
  const provider = (raw.AI_PROVIDER ?? 'gemini').toLowerCase();

  if (provider === 'gemini') {
    if (!raw.GEMINI_API_KEY) {
      throw new Error('AI_PROVIDER is "gemini" but GEMINI_API_KEY is empty. Add it to .env.');
    }
    return raw.GEMINI_API_KEY;
  }

  // OpenAI: fall back to the legacy lowercase name so an old .env still boots.
  const key = raw.OPENAI_API_KEY || raw.openai_api_key;
  if (!key) {
    throw new Error('AI_PROVIDER is "openai" but OPENAI_API_KEY is empty. Add it to .env.');
  }
  return key;
}

/**
 * Reads `process.env`, applies defaults, and validates the result.
 *
 * On failure it prints every problem at once rather than one at a time —
 * fixing five credentials should be one round trip, not five.
 *
 * @returns {object} The fully validated configuration, frozen.
 * @throws {Error} When any required variable is missing or malformed.
 */
function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // Collect every issue so the operator sees the whole to-do list at once.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || '(root)';
      return `  • ${name}: ${issue.message}`;
    });

    throw new Error(
      [
        '',
        'Invalid environment configuration. Fix the following in .env:',
        ...problems,
        '',
        'See docs/PREREQUISITES.md §5 for the expected shape.',
        '',
      ].join('\n'),
    );
  }

  const parsed = result.data;

  // Throws early with a provider-specific message if the key is missing.
  const apiKey = resolveAiProviderKey(parsed);

  return Object.freeze({
    ...parsed,
    /** The resolved key for the active provider — never log this. */
    AI_API_KEY: apiKey,
    /** True when running under NODE_ENV=production. */
    isProduction: parsed.NODE_ENV === 'production',
    /** Falling back to a local URL keeps image links usable in dev. */
    PUBLIC_BASE_URL: parsed.PUBLIC_BASE_URL || `http://localhost:${parsed.PORT}`,
    /**
     * Where dashboard links point. Defaults to the conventional dev port.
     * Trailing slashes are stripped so concatenating a path cannot produce `//`.
     */
    DASHBOARD_BASE_URL: (parsed.DASHBOARD_BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    /** Dev triggers are never available in production, whatever the env says. */
    DEV_TOOLS_ENABLED: parsed.DEV_TOOLS_ENABLED && parsed.NODE_ENV !== 'production',
    /**
     * True when mail credentials are present.
     *
     * Derived rather than configured: a half-filled SMTP block (host but no
     * password) would otherwise look enabled and fail on the first signup. The
     * email code checks this one flag instead of four variables.
     */
    EMAIL_ENABLED: Boolean(parsed.SMTP_HOST && parsed.SMTP_USER && parsed.SMTP_PASS),
  });
}

/**
 * The application configuration, validated once at import time.
 *
 * Importing this module is therefore also the startup gate: an invalid .env
 * throws here, before any server, database or Discord connection is opened.
 *
 * @type {Readonly<object>}
 */
export const env = loadEnv();

export default env;
