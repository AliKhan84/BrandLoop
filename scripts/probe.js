#!/usr/bin/env node
/**
 * scripts/probe.js — the credential gate.
 *
 * RESPONSIBILITY
 *   Prove, against the live services, that every credential works and every
 *   configured model name is callable — before any application logic runs.
 *
 * WHY THIS EXISTS AS A SEPARATE SCRIPT
 *   A bad key or a retired model name does not fail loudly at startup; it fails
 *   three layers deep in a scheduled job, after a partial plan has been
 *   written. This script moves that discovery to a single command with a clear
 *   PASS/FAIL per line.
 *
 * WHY IT MAKES REAL CALLS
 *   Listing models does not prove the key is *authorised* for one — a key can
 *   see a model and still be refused (that is exactly what happened here: the
 *   catalog listed `gemini-2.5-flash`, but calling it returned 404 "no longer
 *   available to new users"). So every check issues an actual request.
 *
 * EXIT CODE: 0 when every required check passes, 1 otherwise. Wire it into CI
 * or a pre-deploy step and a broken credential stops the deploy.
 *
 * Run with: npm run probe
 *   Add `-- --images` to also generate one real image, proving the Phase 3 path
 *   end to end. Off by default because that call is paid (~$0.04, ~16s).
 */

import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/db/connect.js';
import {
  describeImageModel,
  describeModel,
  getProvider,
  getProviderName,
} from '../src/services/ai/index.js';
import { verifyMailer } from '../src/services/email/mailer.js';
import { safeString } from '../src/utils/logger.js';

/**
 * Whether to exercise the real image generation path.
 *
 * Opt-in because it is a paid call (see the note in `checkAi`); everything else
 * in this probe is free or negligible.
 */
const IMAGE_PROBE_REQUESTED = process.argv.includes('--images');

/**
 * Collected outcomes, so the summary can be printed after all checks run.
 * @type {{label: string, ok: boolean, critical: boolean, detail: string}[]}
 */
const outcomes = [];

/**
 * Records and prints a passing check.
 *
 * @param {string} label - What was checked.
 * @param {string} [detail=''] - Supporting evidence, e.g. a timing or an id.
 * @param {object} [options]
 * @param {boolean} [options.critical=true] - Whether a failure should fail the run.
 * @returns {void}
 * @sideeffect Appends to `outcomes` and writes to stdout.
 */
function pass(label, detail = '', { critical = true } = {}) {
  outcomes.push({ label, ok: true, critical, detail });
  console.log(`  PASS  ${label}${detail ? `  →  ${detail}` : ''}`);
}

/**
 * Records and prints a failing check.
 *
 * @param {string} label - What was checked.
 * @param {string} [detail=''] - Why it failed.
 * @param {object} [options]
 * @param {boolean} [options.critical=true] - Whether a failure should fail the run.
 * @returns {void}
 * @sideeffect Appends to `outcomes` and writes to stdout.
 */
function fail(label, detail = '', { critical = true } = {}) {
  outcomes.push({ label, ok: false, critical, detail });
  console.log(`  FAIL  ${label}${detail ? `  →  ${detail}` : ''}`);
}

/**
 * Prints a section heading.
 *
 * @param {string} title - The section name.
 * @returns {void}
 * @sideeffect Writes to stdout.
 */
function section(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(Math.max(title.length, 40)));
}

/**
 * Runs an async check, converting a thrown error into a FAIL line.
 *
 * WHY: without this, one unexpected throw would abort the whole probe and hide
 * every check after it. The operator should see the complete picture in one run.
 *
 * @param {string} label - What is being checked.
 * @param {() => Promise<string>} fn - The check. Returns a detail string on success.
 * @param {object} [options]
 * @param {boolean} [options.critical=true] - Whether failure should fail the run.
 * @returns {Promise<boolean>} True when the check passed.
 * @sideeffect Runs the supplied check.
 */
async function check(label, fn, { critical = true } = {}) {
  try {
    const detail = await fn();
    pass(label, detail, { critical });
    return true;
  } catch (err) {
    fail(label, safeString(err.message ?? err), { critical });
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Environment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates the loaded configuration without touching the network.
 *
 * @returns {Promise<void>}
 * @sideeffect Appends to `outcomes`.
 */
async function checkEnvironment() {
  section('1. Environment');

  await check('configuration parses', async () => {
    // Reaching this line means env.js already validated everything, because an
    // invalid .env throws at import time.
    return `NODE_ENV=${env.NODE_ENV}, PORT=${env.PORT}`;
  });

  await check('no whitespace in the AI key', async () => {
    // A trailing space is the single most common cause of a 401 that looks
    // like a revoked key, so it is asserted separately from key validity.
    if (/\s/.test(env.AI_API_KEY)) {
      throw new Error('key contains whitespace — check for a trailing space in .env');
    }
    return `${env.AI_API_KEY.length} chars, clean`;
  });

  await check('DATABASE — MongoDB URI present', async () => {
    // Report the destination, not the credential. safeString redacts it.
    return `database "${env.MONGODB_DB_NAME}"`;
  });

  await check('dev tools availability', async () => {
    return env.DEV_TOOLS_ENABLED
      ? 'enabled (/api/dev/* available)'
      : 'disabled (set DEV_TOOLS_ENABLED=true and NODE_ENV!=production)';
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MongoDB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Connects to MongoDB and proves read/write access with a throwaway document.
 *
 * WHY A WRITE, NOT JUST A CONNECT: a connection proves the network and the
 * credentials, but not the authorisation. A user with read-only rights connects
 * happily and then fails on the first insert — mid-plan.
 *
 * @returns {Promise<boolean>} True when the database is fully usable.
 * @sideeffect Opens a connection and writes a temporary document.
 */
async function checkDatabase() {
  section('2. MongoDB');

  const connected = await check('connection established', async () => {
    await connectDatabase({ retries: 2, baseDelayMs: 800 });
    // Explicitly report the database actually selected, because a URI without
    // a database segment silently resolves to `test`. Confirming the name here
    // means that mistake is visible rather than discovered later.
    return `database "${mongoose.connection.name}"`;
  });

  if (!connected) return false;

  await check('write and read access', async () => {
    const collection = mongoose.connection.db.collection('_probe');

    await collection.insertOne({ at: new Date(), probe: true });
    const found = await collection.countDocuments({ probe: true });
    if (found < 1) throw new Error('insert succeeded but the document was not readable');

    // Clean up so repeated probes do not accumulate rows.
    await collection.deleteMany({ probe: true });
    return 'insert → read → delete verified';
  });

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. AI provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies the AI key by making real structured-output calls.
 *
 * Every model is tested with an actual request rather than a catalog lookup,
 * because a model can be listed and still refuse the key.
 *
 * @returns {Promise<boolean>} True when at least the primary model works.
 * @sideeffect Makes network requests.
 */
async function checkAi() {
  section('3. AI provider');

  await check('provider module loads', async () => {
    return await getProviderName();
  });

  // The primary model — a failure here is fatal, because every generator uses it.
  const textOk = await check(`TEXT_MODEL "${env.TEXT_MODEL}" answers with valid JSON`, async () => {
    const result = await describeModel(env.TEXT_MODEL);
    if (!result.ok) throw new Error(result.reason);
    return 'structured output verified';
  });

  // The cheap model is used for high-volume calls, so it is worth confirming
  // separately — a wrong value would only surface on a busy run.
  await check(`CHEAP_MODEL "${env.CHEAP_MODEL}" answers`, async () => {
    const result = await describeModel(env.CHEAP_MODEL);
    if (!result.ok) throw new Error(result.reason);
    return 'structured output verified';
  });

  // The image model is informational either way: a failure here does not fail
  // the run, because a text-only draft is a supported outcome (see
  // `IMAGE_SKIP_NOTES`).
  //
  // It is checked through `describeImageModel`, NOT `describeModel`. Image
  // models are not served by the same endpoint as text models, so probing one
  // through the text path returns a 400 that reads like "model unavailable"
  // when the model is perfectly fine. Testing through the wrong endpoint gives
  // a confident wrong answer, which is worse than not testing at all.
  //
  // Phase 3's image model is checked for visibility by default, and the real
  // generation path only on request.
  //
  // WHY VISIBILITY IS NOT ENOUGH: a model can be listed and still refuse the
  // key — `gemini-2.5-flash` was listed and returned 404, and every Gemini
  // image model was listed and returned `429 limit: 0`. That is precisely how
  // Phase 3 came to be deferred, so a name check alone cannot be trusted.
  //
  // WHY IT IS OPT-IN ANYWAY: a real image costs ~$0.04 and ~16 seconds, and
  // the probe is meant to be cheap enough to run on every setup. `--images`
  // turns the paid call on, and then it is the proof.
  if (IMAGE_PROBE_REQUESTED) {
    await check(`IMAGE_MODEL "${env.IMAGE_MODEL}" generates an image`, async () => {
      const provider = await getProvider();
      const result = await provider.generateImage({
        prompt: 'A single teal circle centred on a warm white background, flat vector, no text.',
        size: '1024x1024',
      });
      return `${result.buffer.length} bytes of ${result.mimeType} in ${result.durationMs}ms`;
    }, { critical: false });
  } else {
    const imageCheck = await describeImageModel(env.IMAGE_MODEL);

    if (imageCheck.ok) {
      pass(
        `IMAGE_MODEL "${env.IMAGE_MODEL}"`,
        `${imageCheck.note ?? 'available'} — run with --images to generate one for real`,
        { critical: false },
      );
    } else {
      fail(`IMAGE_MODEL "${env.IMAGE_MODEL}"`, imageCheck.reason ?? 'unavailable', { critical: false });
    }
  }

  return textOk;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Discord
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Logs the bot in over a real gateway connection and confirms the app id.
 *
 * WHY A GATEWAY LOGIN AND NOT A REST CALL: the REST check only proves the token
 * is valid. The bot needs a persistent gateway connection to receive button
 * presses, and a network that blocks the gateway would pass a REST check and
 * then fail silently at runtime. Connecting for real tests the thing that
 * actually has to work.
 *
 * @returns {Promise<boolean>} True when the bot can connect and identify.
 * @sideeffect Opens and closes a Discord gateway connection.
 */
async function checkDiscord() {
  section('4. Discord');

  const { Client, GatewayIntentBits } = await import('discord.js');

  const client = new Client({ intents: [GatewayIntentBits.DirectMessages] });

  /**
   * Resolves when the gateway reports ready; rejects after a timeout.
   *
   * MUST BE CREATED BEFORE `client.login()`. discord.js resolves `login()` at
   * almost the same instant it emits `clientReady`, so attaching the listener
   * afterwards races the event and then waits forever — which is exactly how
   * this check failed the first time it ran. Registering first removes the race.
   *
   * `clientReady` rather than `ready`: discord.js renamed it to distinguish it
   * from the raw gateway READY packet, and v15 emits only the new name.
   *
   * @type {Promise<void>}
   */
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('gateway did not become ready within 20s')),
      20_000,
    );
    client.once('clientReady', () => {
      clearTimeout(timer);
      resolve();
    });
  });

  // If login() throws first, nothing awaits `ready` and its rejection would
  // surface 20 seconds later as an unhandled rejection. This marks it handled
  // while leaving the original promise still rejectable for the await below.
  ready.catch(() => {});

  const ok = await check('bot login + gateway connection', async () => {
    await client.login(env.DISCORD_BOT_TOKEN);
    await ready;
    return `connected as ${client.user.tag}`;
  });

  if (ok) {
    await check('application id matches DISCORD_APP_ID', async () => {
      const application = await client.application.fetch();
      if (application.id !== env.DISCORD_APP_ID) {
        throw new Error(`token belongs to app ${application.id}, but .env says ${env.DISCORD_APP_ID}`);
      }
      return `${application.name} (${application.id})`;
    });
  }

  // Always destroy the client, even on failure, or the probe hangs on exit
  // waiting for an open websocket.
  await client.destroy().catch(() => {});

  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Email (optional)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies the SMTP credentials, when there are any.
 *
 * WHY A MISSING CONFIGURATION IS A PASS, NOT A FAILURE: email is optional by
 * design. With no credentials the API logs the verification link instead of
 * sending it and the feature still works end to end, so reporting it as a
 * failure would train the operator to skim past probe failures — which is the
 * one habit this script exists to prevent. A *configured* credential that does
 * not work, on the other hand, is exactly what should stop a demo.
 *
 * @returns {Promise<void>}
 * @sideeffect Opens an SMTP connection when configured.
 */
async function checkEmail() {
  section('5. Email (address verification)');

  if (!env.EMAIL_ENABLED) {
    pass('SMTP not configured', 'verification links are written to the log instead', {
      critical: false,
    });
    return;
  }

  await check(`SMTP — ${env.SMTP_HOST}:${env.SMTP_PORT}`, async () => {
    const { ok, error } = await verifyMailer();
    if (!ok) throw new Error(error);
    return `authenticated as ${env.SMTP_USER}, sending from ${env.MAIL_FROM}`;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prints the final tally and reports what to do about any failures.
 *
 * @returns {void}
 * @sideeffect Writes to stdout.
 */
function printSummary() {
  const critical = outcomes.filter((o) => o.critical);
  const criticalFailures = critical.filter((o) => !o.ok);

  section('Summary');

  console.log(`  ${critical.filter((o) => o.ok).length}/${critical.length} required checks passed`);

  if (criticalFailures.length === 0) {
    console.log('\n  ✓ All required credentials verified. Phase 1 can be built.\n');
    return;
  }

  console.log(`\n  ${criticalFailures.length} required check(s) failed:\n`);
  for (const failure of criticalFailures) {
    console.log(`    • ${failure.label}`);
    if (failure.detail) console.log(`      ${failure.detail}`);
  }
  console.log('\n  Fix these in .env, then run `npm run probe` again.\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs every check in order and sets the process exit code.
 *
 * Sections are sequential because the AI and Discord checks both need the
 * configuration validated first, and parallel output would interleave into
 * something unreadable.
 *
 * @returns {Promise<void>}
 * @sideeffect Runs checks, writes output, sets `process.exitCode`.
 */
async function main() {
  console.log('\nBrandLoop credential probe');
  console.log('='.repeat(40));

  await checkEnvironment();

  const dbOk = await checkDatabase();

  const aiOk = await checkAi();

  let discordOk = false;
  try {
    discordOk = await checkDiscord();
  } catch (err) {
    fail('Discord check crashed', safeString(err.message ?? err));
  }

  await checkEmail();

  // ALWAYS close the connection, including when the check failed. A failed
  // check can still have opened a socket, and an open Mongoose connection keeps
  // the event loop alive indefinitely — which is why the first run of this
  // probe printed its summary and then hung instead of exiting.
  await disconnectDatabase().catch(() => {});

  printSummary();

  const requiredPassed = outcomes.filter((o) => o.critical).every((o) => o.ok);

  // Exit explicitly rather than relying on the event loop draining. A probe is
  // a one-shot script with no legitimate reason to stay resident, and a stray
  // handle (a Discord socket, a keep-alive agent) would otherwise leave it
  // hanging with no output to explain why.
  process.exit(requiredPassed && dbOk && aiOk && discordOk ? 0 : 1);
}

main().catch((err) => {
  console.error('\nProbe crashed unexpectedly:');
  console.error(safeString(err));
  // Explicit exit for the same reason as in main(): a half-open connection
  // would otherwise keep the process alive after the error is reported.
  process.exit(1);
});
