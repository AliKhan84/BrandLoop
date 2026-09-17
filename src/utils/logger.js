/**
 * Console logger with secret redaction.
 *
 * RESPONSIBILITY
 *   Produce timestamped, level-filtered log lines, and guarantee that no
 *   credential ever reaches stdout.
 *
 * WHY REDACTION LIVES HERE
 *   Logging is the one path every secret has to pass through on its way out of
 *   the process. Centralising it means a single function is responsible for
 *   scrubbing, rather than every call site remembering to be careful. An
 *   OpenAI or Discord token in a terminal scrollback — or worse, in a CI log —
 *   is a credential leak that is usually noticed too late.
 *
 * DOES NOT OWN: log shipping, structured log aggregation, or file output.
 * Everything goes to stdout/stderr, which is what a panel or a shell captures.
 */

import { env } from '../config/env.js';

/**
 * Numeric severity for each level.
 *
 * `silent` is deliberately above every other level so setting it disables all
 * output — useful in tests where a deliberately-triggered error would
 * otherwise print a stack trace and look like a failure.
 */
const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
});

/** The minimum severity that will actually be printed. */
const ACTIVE_LEVEL = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

/**
 * Patterns that look like credentials, applied to every outgoing string.
 *
 * These cover the shapes we might encounter from third-party SDKs — an error
 * message that echoes a request URL, for instance. The literal-value check
 * below is stronger, but this catches secrets that arrive from outside our
 * own config.
 */
const SECRET_PATTERNS = [
  // Google / Gemini keys
  [/AIza[0-9A-Za-z_-]{30,}/g, 'AIza***REDACTED***'],
  // OpenAI keys, both legacy `sk-` and project `sk-proj-` forms
  [/sk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{16,}/g, 'sk-***REDACTED***'],
  // Discord bot tokens: base64-ish id, timestamp, signature
  [/[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g, '***DISCORD-TOKEN-REDACTED***'],
  // MongoDB connection strings: redact the userinfo section only
  [/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/g, '$1***REDACTED***@'],
  // JWTs, in case one is ever logged
  [/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '***JWT-REDACTED***'],
];

/**
 * Every literal secret this process knows about.
 *
 * WHY BOTH THIS AND THE PATTERNS: patterns catch shapes, this catches exact
 * values. If a key ever gets concatenated into a message in a way the regexes
 * do not match, the exact-value replacement still removes it.
 */
const LITERAL_SECRETS = [
  env.AI_API_KEY,
  env.DISCORD_BOT_TOKEN,
  env.JWT_SECRET,
  env.GEMINI_API_KEY,
  env.OPENAI_API_KEY,
  // The password sits inside the URI, so redact the whole connection string.
  env.MONGODB_URI,
].filter((s) => typeof s === 'string' && s.length >= 8);

/**
 * Removes every known secret from a string.
 *
 * Applies literal-value replacement first (most reliable), then the
 * shape-based patterns for anything arriving from a third party.
 *
 * @param {string} input - The raw text about to be logged.
 * @returns {string} The same text with credentials replaced by markers.
 */
function redact(input) {
  let output = String(input);

  for (const secret of LITERAL_SECRETS) {
    // split/join rather than replaceAll: no regex escaping needed for the
    // secret, which may contain characters that are special in a pattern.
    output = output.split(secret).join('***REDACTED***');
  }

  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

/**
 * Converts any value into a redacted, single-line string.
 *
 * Errors are unwrapped to their message plus stack, because `String(error)`
 * alone loses the stack — the single most useful part when debugging a
 * scheduled job that failed at 3am.
 *
 * @param {unknown} value - Anything: string, Error, object, primitive.
 * @returns {string} A printable, secret-free representation.
 */
function stringify(value) {
  if (value instanceof Error) {
    return redact(value.stack || `${value.name}: ${value.message}`);
  }
  if (typeof value === 'string') {
    return redact(value);
  }
  if (value === undefined) {
    return '';
  }
  try {
    return redact(JSON.stringify(value, null, 2));
  } catch {
    // Circular structures and exotic objects fall back to a marker rather
    // than throwing inside the logger, which would mask the original error.
    return '[unserialisable value]';
  }
}

/**
 * Writes one formatted line if the level is enabled.
 *
 * @param {'debug'|'info'|'warn'|'error'} level - Severity of this message.
 * @param {unknown} message - Primary content; a string, Error, or object.
 * @param {unknown[]} rest - Additional values appended on their own lines.
 * @returns {void}
 * @sideeffect Writes to stdout (or stderr for warn/error).
 */
function emit(level, message, rest) {
  if (LEVELS[level] < ACTIVE_LEVEL) return;

  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const parts = [stringify(message), ...rest.map(stringify)].filter(Boolean);
  const line = `[${timestamp}] ${tag} ${parts.join(' ')}`;

  // Errors and warnings go to stderr so a shell can separate them from
  // normal program output without parsing the text.
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/**
 * The application logger.
 *
 * Each method takes any value plus optional extra values; every argument is
 * passed through redaction before printing.
 *
 * @example
 *   logger.info('Plan created', { userId, slots: plan.days.length });
 *   logger.error('Discord send failed', err);
 */
export const logger = Object.freeze({
  /**
   * Verbose diagnostics. Enabled only with LOG_LEVEL=debug.
   * @param {unknown} message - Primary content.
   * @param {...unknown} rest - Additional values.
   * @returns {void}
   */
  debug(message, ...rest) {
    emit('debug', message, rest);
  },

  /**
   * Normal operational events worth keeping in a log.
   * @param {unknown} message - Primary content.
   * @param {...unknown} rest - Additional values.
   * @returns {void}
   */
  info(message, ...rest) {
    emit('info', message, rest);
  },

  /**
   * Something recoverable that the operator should still see.
   * @param {unknown} message - Primary content.
   * @param {...unknown} rest - Additional values.
   * @returns {void}
   */
  warn(message, ...rest) {
    emit('warn', message, rest);
  },

  /**
   * A failure. Always printed unless LOG_LEVEL=silent.
   * @param {unknown} message - Primary content.
   * @param {...unknown} rest - Additional values.
   * @returns {void}
   */
  error(message, ...rest) {
    emit('error', message, rest);
  },
});

/**
 * Redacts a value without logging it.
 *
 * Exported so other modules can safely build a message containing a secret —
 * an error handler echoing a failing URL, for example — without duplicating
 * the redaction rules.
 *
 * @param {unknown} value - The value to scrub.
 * @returns {string} A printable, secret-free string.
 */
export function safeString(value) {
  return stringify(value);
}

export default logger;
