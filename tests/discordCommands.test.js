/**
 * Tests for `services/discord/commands.js` registration.
 *
 * WHY THESE
 *   Guild registration used to iterate `client.guilds.fetch()`, which returns
 *   `OAuth2Guild` objects — a partial shape with no `commands` manager. Every
 *   guild therefore threw "Cannot read properties of undefined (reading 'set')",
 *   the per-guild catch swallowed it, and the run still logged
 *   "global + 1 guild(s)". Nothing was registered in any guild, and the only
 *   visible trace was a warning that reads like a permissions problem.
 *
 *   The consequence is not just a missing feature: guild registration is what
 *   makes `/connect`, `/status` and `/plan` work immediately, while global
 *   registration can take up to an hour to propagate. Silently losing it means a
 *   demo shows "the application did not respond" with no explanation.
 *
 *   The client double below reproduces the exact distinction the bug turned on:
 *   `fetch()` returns credential-less OAuth2Guild shapes, the cache holds
 *   complete ones. A registration that reads from the wrong place fails here
 *   instead of in a log nobody reads.
 *
 * Run with: npm test
 */

// Before `config/env.js` is imported, so the info line about registered commands
// does not print during the run.
process.env.LOG_LEVEL = 'silent';

const { test, describe } = await import('node:test');
const assert = await import('node:assert/strict');

const { registerCommands } = await import('../src/services/discord/commands.js');

/**
 * Builds a Discord client double with both guild representations.
 *
 * @param {string[]} guildIds - Guilds the bot is in.
 * @param {string[]} [failingGuildIds] - Guilds whose registration should reject.
 * @returns {{client: object, registered: object, handlers: object}} The double,
 *   what it recorded, and the listeners the function attached.
 * @sideeffect none
 */
function fakeClient(guildIds, failingGuildIds = []) {
  const registered = { global: [], guild: [], fetchCalls: 0 };
  const handlers = {};
  const cache = new Map();

  for (const id of guildIds) {
    cache.set(id, {
      id,
      commands: {
        set: async (commands) => {
          if (failingGuildIds.includes(id)) throw new Error('Missing Access');
          registered.guild.push({ id, commands });
        },
      },
    });
  }

  return {
    registered,
    handlers,
    client: {
      application: { commands: { set: async (commands) => registered.global.push(commands) } },
      guilds: {
        cache,
        // The trap: OAuth2Guild objects, exactly what discord.js resolves here.
        fetch: async () => {
          registered.fetchCalls += 1;
          return new Map(guildIds.map((id) => [id, { id }]));
        },
      },
      on: (event, handler) => {
        handlers[event] = handler;
      },
    },
  };
}

describe('registerCommands', () => {
  test('registers the full command set globally', async () => {
    const { client, registered } = fakeClient(['111']);

    const result = await registerCommands(client);

    assert.equal(registered.global.length, 1);
    assert.equal(registered.global[0].length, 3, 'connect, status and plan');
    assert.equal(result.global, 3);
  });

  test('registers the commands in every guild from the cache', async () => {
    const { client, registered } = fakeClient(['111', '222']);

    const result = await registerCommands(client);

    assert.deepEqual(
      registered.guild.map((entry) => entry.id).sort(),
      ['111', '222'],
      'both guilds must be registered',
    );
    assert.equal(
      registered.fetchCalls,
      0,
      'guilds.fetch() resolves OAuth2Guild objects, which have no commands manager',
    );
    assert.equal(result.guilds, 2);
  });

  test('sends the command definitions, not an empty or partial list', async () => {
    const { client, registered } = fakeClient(['111']);

    await registerCommands(client);

    const names = registered.guild[0].commands.map((command) => command.name).sort();
    assert.deepEqual(names, ['connect', 'plan', 'status']);
  });

  test('a guild that rejects does not stop the others', async () => {
    // What the per-guild catch exists for: the bot can be in a guild it lacks
    // the applications.commands scope in, and that must not cost the rest.
    const { client, registered } = fakeClient(['111', '222'], ['111']);

    const result = await registerCommands(client);

    assert.deepEqual(
      registered.guild.map((entry) => entry.id),
      ['222'],
      'the healthy guild still registers',
    );
    assert.equal(result.guilds, 2, 'the count reports guilds attempted');
  });

  test('a guild joined after start-up is registered immediately', async () => {
    // Without this handler a server that installs the bot while it is running
    // gets no commands at all, which looks identical to "the bot is broken".
    const { client, registered, handlers } = fakeClient([]);

    await registerCommands(client);
    assert.equal(typeof handlers.guildCreate, 'function', 'a guildCreate handler must be attached');

    // discord.js hands this a real Guild, which carries a commands manager.
    handlers.guildCreate({
      id: '333',
      commands: { set: async (commands) => registered.guild.push({ id: '333', commands }) },
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(registered.guild.length, 1);
    assert.equal(registered.guild[0].id, '333');
  });

  test('a client with no guilds still registers globally', async () => {
    const { client, registered } = fakeClient([]);

    const result = await registerCommands(client);

    assert.equal(registered.global.length, 1);
    assert.equal(result.guilds, 0);
  });
});
