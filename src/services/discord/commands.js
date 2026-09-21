/**
 * Discord slash commands — `/connect`, `/status`, `/plan`.
 *
 * RESPONSIBILITY
 *   Register the command set with Discord, and handle invocations.
 *
 * ## Why linking uses a code and not a password
 *
 * `/connect <code>` pairs a Discord account with a BrandLoop account. The code
 * is generated over authenticated HTTP (`POST /api/auth/discord/link-code`) and
 * typed into Discord.
 *
 * The obvious alternative — asking for an email and password in a chat message —
 * would mean credentials passing through Discord's servers and sitting in a
 * message history. It also trains users to type passwords into chat, which is
 * the habit phishing depends on. A short-lived code that is useless once
 * redeemed avoids both.
 *
 * ## Why commands are registered twice
 *
 * Global registration can take up to an hour to propagate, which is unusable
 * when demonstrating the loop. Guild registration is instant. Registering both
 * means the commands work immediately in the test server and remain available
 * everywhere afterwards.
 *
 * DOES NOT OWN: buttons or modals (`interactions.js`).
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { User } from '../../models/User.js';
import { ContentPlan } from '../../models/ContentPlan.js';
import { Post } from '../../models/Post.js';
import { getUsageSummary } from '../quotaService.js';
import { PLAN_STATUS, POST_STATUS, QUOTA_KEY } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

/**
 * The command definitions, in registration order.
 * @type {SlashCommandBuilder[]}
 */
const COMMANDS = [
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Link your Discord account to BrandLoop using a code from the web app')
    .addStringOption((option) =>
      option
        .setName('code')
        .setDescription('The 6-digit code from POST /api/auth/discord/link-code')
        .setRequired(true)
        .setMinLength(6)
        .setMaxLength(6),
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show your linked account, remaining quota, and plan progress')
    .toJSON(),

  new SlashCommandBuilder()
    .setName('plan')
    .setDescription('List the posts in your current plan and their status')
    .toJSON(),
];

/**
 * Registers every command in one guild, without throwing.
 *
 * Extracted so the startup loop and the `guildCreate` handler cannot drift
 * apart, and so a guild the bot lacks permissions in cannot stop the others.
 *
 * @param {import('discord.js').Guild} guild - The guild to register in.
 * @returns {Promise<boolean>} True when registration succeeded.
 * @sideeffect Makes a network request to Discord.
 */
async function registerCommandsInGuild(guild) {
  try {
    await guild.commands.set(COMMANDS);
    return true;
  } catch (err) {
    // Missing permissions on one guild should not stop the others.
    logger.warn(`Could not register commands on guild ${guild.id}`, err?.message);
    return false;
  }
}

/**
 * Registers the commands globally and on every guild the bot has joined.
 *
 * @param {import('discord.js').Client} client - The connected client.
 * @returns {Promise<{global: number, guilds: number}>} How many were registered.
 * @sideeffect Makes network requests to Discord.
 */
export async function registerCommands(client) {
  try {
    // Global: available everywhere, but may take up to an hour to appear.
    await client.application.commands.set(COMMANDS);

    // Guild-scoped: instant. This is what makes the commands usable in a demo
    // without waiting for global propagation.
    //
    // Iterated from the CACHE rather than `client.guilds.fetch()`. That call
    // returns `OAuth2Guild` objects — a partial representation built from
    // `GET /users/@me/guilds` — and those have no `commands` manager, so
    // `guild.commands.set` threw "Cannot read properties of undefined (reading
    // 'set')" for every guild. The throw was swallowed by the per-guild catch in
    // `registerCommandsInGuild`, so the run still logged "global + 1 guild(s)"
    // while no guild had a single command registered. The cache holds real
    // `Guild` objects and is complete by the time `clientReady` fires, which is
    // the only caller of this function.
    const guilds = client.guilds.cache;
    for (const guild of guilds.values()) {
      await registerCommandsInGuild(guild);
    }

    // Register on guilds joined AFTER this runs.
    //
    // Without this, installing the bot into a server while it is already
    // running leaves that server with no commands at all. The bot is in the
    // guild, the install appeared to work, and nothing else happens — which is
    // indistinguishable from "the bot is broken" to whoever just installed it.
    // Global propagation is not a rescue here either: it is only a fallback
    // after up to an hour, and it is not a dependable answer to "I just added
    // the bot, why is there no /connect".
    //
    // `guild.commands.set` is scoped to this guild only, so this cannot
    // disturb the other guilds' registrations.
    client.on('guildCreate', (guild) => {
      registerCommandsInGuild(guild).then((ok) => {
        if (ok) logger.info(`Registered ${COMMANDS.length} slash commands in new guild ${guild.id}`);
      });
    });

    logger.info(`Registered ${COMMANDS.length} slash commands (global + ${guilds.size} guild(s))`);
    return { global: COMMANDS.length, guilds: guilds.size };
  } catch (err) {
    logger.error('Failed to register slash commands', err);
    return { global: 0, guilds: 0 };
  }
}

/**
 * Finds the user linked to a Discord account.
 *
 * @param {string} discordUserId - The Discord snowflake id.
 * @returns {Promise<object|null>} The user, or null when not linked.
 * @sideeffect none
 */
async function findLinkedUser(discordUserId) {
  return User.findOne({ discordUserId });
}

/**
 * Handles `/connect` — redeems a link code.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The command.
 * @returns {Promise<void>}
 * @sideeffect Writes the Discord link onto the user.
 */
async function handleConnect(interaction) {
  const code = interaction.options.getString('code', true).trim();

  // The code fields are `select: false` on the schema, so they must be asked
  // for explicitly — otherwise they come back undefined and every redemption
  // looks like an invalid code.
  const user = await User.findOne({ discordLinkCode: code })
    .select('+discordLinkCode +discordLinkCodeExpiresAt');

  if (!user) {
    await interaction.reply({
      content: '❌ That code is not valid. Generate a fresh one from the web app and try again.',
      ephemeral: true,
    });
    return;
  }

  if (user.discordLinkCodeExpiresAt && user.discordLinkCodeExpiresAt < new Date()) {
    await interaction.reply({
      content: '❌ That code has expired. Generate a new one and try again.',
      ephemeral: true,
    });
    return;
  }

  // One Discord account per BrandLoop account. Without this, the same person
  // could link twice and receive every draft in duplicate.
  const alreadyLinked = await User.findOne({
    discordUserId: interaction.user.id,
    _id: { $ne: user._id },
  });

  if (alreadyLinked) {
    await interaction.reply({
      content: '❌ This Discord account is already linked to a different BrandLoop account.',
      ephemeral: true,
    });
    return;
  }

  user.discordUserId = interaction.user.id;
  // Single-use: clearing the code means a leaked code cannot be replayed.
  user.discordLinkCode = null;
  user.discordLinkCodeExpiresAt = null;
  await user.save();

  logger.info(`Discord account ${interaction.user.id} linked to user ${user._id}`);

  await interaction.reply({
    content:
      '✅ Linked. Your drafts will arrive here as direct messages.\n\n' +
      'Generate a plan at the API (`POST /api/plans`), then approve it to start receiving posts.',
    ephemeral: true,
  });
}

/**
 * Handles `/status` — account, quota and plan progress at a glance.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The command.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
async function handleStatus(interaction) {
  const user = await findLinkedUser(interaction.user.id);

  if (!user) {
    await interaction.reply({
      content: 'You have not linked an account yet. Use `/connect <code>` first.',
      ephemeral: true,
    });
    return;
  }

  const [usage, plan, pendingCount] = await Promise.all([
    getUsageSummary({ userId: user._id, user }),
    ContentPlan.findOne({ userId: user._id, status: PLAN_STATUS.APPROVED }).sort({ createdAt: -1 }),
    Post.countDocuments({ userId: user._id, status: POST_STATUS.PENDING_APPROVAL }),
  ]);

  /**
   * Formats a quota entry as "used/limit period".
   *
   * An unlimited account reports a null limit — a ceiling that does not exist
   * cannot be printed as a number, and "3/null" would read as a bug.
   */
  const quotaLine = (key, label) => {
    const entry = usage[key];
    if (!entry) return `${label}: —`;
    if (entry.unlimited) return `${label}: **${entry.used}** this ${entry.period} (unlimited)`;
    return `${label}: **${entry.used}/${entry.limit}** this ${entry.period}`;
  };

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('BrandLoop status')
    .addFields(
      { name: 'Niche', value: user.niche || '(not set)', inline: true },
      { name: 'Frequency', value: `${user.postFrequency} posts/week`, inline: true },
      { name: 'Awaiting approval', value: String(pendingCount), inline: true },
      { name: 'Plan generations', value: quotaLine(QUOTA_KEY.PLAN_GENERATIONS, 'Used'), inline: true },
      { name: 'News lookups', value: quotaLine(QUOTA_KEY.NEWS_LOOKUPS, 'Used'), inline: true },
      { name: 'Images', value: quotaLine(QUOTA_KEY.IMAGES, 'Used'), inline: true },
    );

  if (plan) {
    const progress = plan.progress();
    embed.addFields({
      name: 'Current plan',
      value: `${progress.generated}/${progress.total} slots generated · ${progress.pending} pending`,
    });
  } else {
    embed.addFields({ name: 'Current plan', value: 'None approved yet.' });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Handles `/plan` — lists the slots in the current plan.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The command.
 * @returns {Promise<void>}
 * @sideeffect none (read-only)
 */
async function handlePlan(interaction) {
  const user = await findLinkedUser(interaction.user.id);

  if (!user) {
    await interaction.reply({
      content: 'You have not linked an account yet. Use `/connect <code>` first.',
      ephemeral: true,
    });
    return;
  }

  const plan = await ContentPlan.findOne({ userId: user._id }).sort({ createdAt: -1 });

  if (!plan) {
    await interaction.reply({ content: 'You do not have a plan yet.', ephemeral: true });
    return;
  }

  /** Marks a slot with a symbol matching its state. */
  const mark = (status) => {
    if (status === 'generated') return '✅';
    if (status === 'skipped') return '⏭️';
    return '⬜';
  };

  const lines = plan.days.map((slot) => {
    const kind = slot.type === 'news' ? '📰' : '📝';
    return `${mark(slot.status)} \`${String(slot.dayIndex).padStart(2, '0')}\` ${kind} ${slot.theme}`;
  });

  // Discord caps an embed description at 4096 characters. A 30-day plan at
  // 4/week is 17 slots, so this only truncates on a long plan with long themes.
  const body = lines.join('\n').slice(0, 4000);

  const embed = new EmbedBuilder()
    .setColor(plan.status === PLAN_STATUS.APPROVED ? 0x57f287 : 0x5865f2)
    .setTitle(`Plan — ${plan.status} (${plan.durationDays} days)`)
    .setDescription(body)
    .setFooter({ text: '✅ generated · ⬜ pending · 📰 news · 📝 planned' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

/**
 * Routes an incoming slash command.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction - The command.
 * @returns {Promise<void>}
 * @sideeffect Depends on the command.
 */
export async function handleCommand(interaction) {
  // These commands are read-only or write a single field, so they finish well
  // inside the 3-second window and do not need a defer.
  try {
    switch (interaction.commandName) {
      case 'connect':
        await handleConnect(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
      case 'plan':
        await handlePlan(interaction);
        break;
      default:
        logger.warn(`Unhandled command "${interaction.commandName}"`);
    }
  } catch (err) {
    logger.error(`Command "${interaction.commandName}" failed`, err);

    // A reply may already have been sent, in which case the fallback must be a
    // follow-up. Both are attempted quietly — the user seeing an explanation
    // matters more than which channel it arrives in.
    const message = '⚠️ Something went wrong running that command.';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
    }
  }
}

export default { registerCommands, handleCommand, COMMANDS };
