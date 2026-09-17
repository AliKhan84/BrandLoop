/**
 * Discord client lifecycle.
 *
 * RESPONSIBILITY
 *   Own the single gateway connection: create it, log in, register slash
 *   commands, and shut down cleanly.
 *
 * ## The race that this file exists to avoid
 *
 * `client.login()` resolves at almost the same instant discord.js emits
 * `clientReady`. Registering the ready listener *after* awaiting login
 * therefore misses the event and waits forever — which is exactly how the
 * setup probe failed on its first run, reported as "gateway did not become
 * ready within 20s" while the bot was in fact connected and healthy.
 *
 * The fix is ordering: listeners are attached before `login()` is called, and
 * `startDiscord` keeps a reference to that promise rather than re-subscribing.
 *
 * ## Why the event is `clientReady`, not `ready`
 *
 * discord.js renamed it to distinguish it from the raw gateway READY packet.
 * v14 emits both and warns; v15 emits only the new name.
 *
 * DOES NOT OWN: what happens when a message arrives (that is `interactions.js`)
 * or how a post is rendered (`approvalQueue.js`).
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * The process-wide client, or null before `startDiscord` runs.
 * @type {Client|null}
 */
let client = null;

/**
 * Builds a Discord client with the intents this bot needs.
 *
 * WHY THESE INTENTS SPECIFICALLY:
 *   • `DirectMessages`  — the entire approval flow runs in DMs, so without it
 *                         the bot cannot see the messages it is replying to.
 *   • `Guilds`          — required for slash commands to be registered and
 *                         invoked at all.
 *
 * The privileged Message Content intent is deliberately NOT requested. Every
 * interaction here is either a slash command or a button press, both of which
 * arrive through the interaction payload. Requesting content access we do not
 * use would widen the bot's data access for no benefit — and it is a
 * privileged intent that has to be justified in the Discord developer portal.
 *
 * @returns {Client} A client that has not been logged in yet.
 * @sideeffect Registers lifecycle listeners on the client.
 */
export function createDiscordClient() {
  const instance = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages,
    ],
    // DM channels are not cached by default, so a message in one arrives
    // partially constructed without this — and a partial channel cannot be
    // sent to.
    partials: [Partials.Channel],
  });

  // Routed to the redacting logger: a Discord error message can echo the
  // request, which can include the token.
  instance.on('error', (err) => logger.error('Discord client error', err));
  instance.on('warn', (message) => logger.warn(`Discord warn: ${message}`));
  instance.on('shardDisconnect', (event, id) => {
    logger.warn(`Discord shard ${id} disconnected (code ${event?.code ?? '?'})`);
  });

  return instance;
}

/**
 * Returns the live client.
 *
 * @returns {Client} The connected client.
 * @throws {Error} When called before `startDiscord` has completed.
 * @sideeffect none
 */
export function getDiscordClient() {
  if (!client) {
    throw new Error('Discord client has not been started. Call startDiscord() first.');
  }
  return client;
}

/**
 * Reports whether the bot is connected and ready to send.
 *
 * Used by the health endpoint and to skip delivery rather than throw when the
 * gateway is momentarily down.
 *
 * @returns {boolean} True when the client is logged in and ready.
 * @sideeffect none
 */
export function isDiscordReady() {
  return Boolean(client?.isReady());
}

/**
 * Logs the bot in and waits for the gateway to report ready.
 *
 * The ready promise is created BEFORE `login()` is called — see the module
 * note. Rejects if the gateway does not come up within the timeout, so a
 * blocked network surfaces at startup rather than as a silent failure to
 * deliver drafts.
 *
 * ## Why this retries
 *
 * The gateway WebSocket upgrade from this network is **intermittent**. Measured
 * across repeated back-to-back trials, roughly one attempt in four succeeds and
 * the rest return `503 Service Unavailable` on the upgrade — regardless of
 * query parameters, and while plain HTTPS to the same host (and the REST API)
 * works every time.
 *
 * Everything points at a network-level filter on WebSocket upgrades rather than
 * anything in the app or at Discord:
 *   • `GET /users/@me` → `200 OK` on every attempt, so the token is valid.
 *   • `session_start_limit` sits at `992/1000`, so this is not a rate limit.
 *   • Discord's own status feed reports all components operational.
 *   • A bare `ws` connection with no discord.js involved fails the same way.
 *   • It succeeds often enough to prove the path works at all.
 *
 * Retrying is therefore the correct response, not a workaround. Without it, a
 * single unlucky handshake at boot means "discord: no", the scheduler never
 * starts, and every user silently receives no posts until someone restarts the
 * process — which is exactly what happened during the build.
 *
 * The attempt count is set so the odds of total failure are small: at a ~25%
 * success rate per attempt, six tries fail only ~18% of the time.
 *
 * Each attempt builds a **fresh client**. A discord.js client whose login
 * rejected is not reliably reusable — its shard and socket state are left
 * half-initialised, and retrying on the same instance tends to fail the same
 * way regardless of whether the upstream problem has cleared. `destroy()` is
 * called on the failed one so its sockets are not leaked across attempts.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs=10000] - Readiness timeout per attempt.
 *   A refusal arrives immediately, so this only bounds the rarer case of an
 *   accepted connection that never completes.
 * @param {number} [options.attempts=6] - Total attempts before giving up.
 * @param {number} [options.baseDelayMs=3000] - First backoff delay; grows linearly.
 * @returns {Promise<Client>} The connected client.
 * @throws {Error} The last error, once every attempt has failed.
 * @sideeffect Opens gateway connections; may sleep between attempts.
 */
export async function startDiscord({
  timeoutMs = 10_000,
  attempts = 6,
  baseDelayMs = 3000,
} = {}) {
  if (client?.isReady()) return client;

  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A failed client is discarded rather than reused — see the note above.
    client = createDiscordClient();

    // Attach the ready listener FIRST. Awaiting login() before subscribing
    // races the event and waits forever.
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Discord gateway did not become ready within ${timeoutMs}ms`)),
        timeoutMs,
      );

      client.once('clientReady', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    // If login() throws first, nothing awaits `ready` and its rejection would
    // surface later as an unhandled rejection. Mark it handled without changing
    // what the await below sees.
    ready.catch(() => {});

    const login = client.login(env.DISCORD_BOT_TOKEN);
    // If the race below bails on the timeout, `login` may still settle later.
    // Marking it handled stops that surfacing as an unhandled rejection after
    // the attempt has already been abandoned.
    login.catch(() => {});

    try {
      // Race the login against the ready-timeout.
      //
      // Awaiting `login()` on its own is not enough, and this is a real failure
      // mode rather than a hypothetical: when Discord's edge accepts the TCP
      // connection but never completes the WebSocket handshake, `login()`
      // neither resolves nor rejects. Startup then hangs with no output at all,
      // and the retry never fires because the await never returns. Observed
      // lasting over two minutes — long enough that the process looked hung.
      //
      // Racing means the timeout actually applies, whatever login() decides to do.
      await Promise.race([login, ready]);

      // Reached only once the gateway has reported ready. Kept as a second
      // await because the race can settle on `login` resolving first.
      await ready;

      logger.info(`Discord connected as ${client.user.tag} (${client.user.id})`);
      return client;
    } catch (err) {
      lastError = err;

      // Tear the failed client down before the next attempt, so four retries
      // do not leave four sets of sockets behind.
      await client.destroy().catch(() => {});
      client = null;

      if (attempt === attempts) break;

      const delay = baseDelayMs * attempt;
      logger.warn(
        `Discord connect attempt ${attempt}/${attempts} failed (${String(err.message).split('\n')[0]}) ` +
          `— retrying in ${Math.round(delay / 1000)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  logger.error(`Discord could not connect after ${attempts} attempts`);
  throw lastError;
}

/**
 * Closes the gateway connection.
 *
 * Safe to call when not connected, so it can be wired into a shutdown handler
 * without a guard at the call site.
 *
 * @returns {Promise<void>}
 * @sideeffect Closes the websocket.
 */
export async function stopDiscord() {
  if (!client) return;
  await client.destroy();
  client = null;
  logger.info('Discord connection closed');
}

/**
 * Opens (or fetches) the DM channel with a user.
 *
 * @param {string} discordUserId - The recipient's Discord snowflake id.
 * @returns {Promise<import('discord.js').DMChannel>} The DM channel.
 * @throws {Error} When the user cannot be fetched or has DMs closed.
 * @sideeffect Makes a network request; may create a DM channel.
 */
export async function openDirectMessage(discordUserId) {
  const instance = getDiscordClient();
  const user = await instance.users.fetch(discordUserId);
  return user.createDM();
}

export default {
  createDiscordClient,
  getDiscordClient,
  isDiscordReady,
  startDiscord,
  stopDiscord,
  openDirectMessage,
};
