/**
 * Discord interaction router — buttons and modals.
 *
 * RESPONSIBILITY
 *   Turn a button press into approve / reject / edit, and keep the Discord
 *   message in step with the stored post.
 *
 * ## The three-second rule that shapes this whole file
 *
 * Discord requires an interaction to be acknowledged within 3 seconds or it
 * shows the user "This interaction failed". Regeneration takes 5–15 seconds.
 * So every handler acknowledges **first** and does the slow work afterwards,
 * replying through the deferred handle.
 *
 * This is not a nicety. Without the defer, Reject does not fail loudly — it
 * fails silently, and the user is left with a message that looks unchanged.
 *
 * The one exception is **Edit**, which must call `showModal()` *before*
 * deferring: a modal is the acknowledgement itself, and Discord rejects a modal
 * opened after a defer.
 *
 * ## Why approve is guarded on status
 *
 * A fast double-click delivers two interactions. Each would otherwise publish
 * and overwrite the other's message. The status check inside `approvePost`
 * makes the second a no-op, so the button is safe to press twice.
 *
 * ## Why payment buttons are the one thing here with a role check
 *
 * A draft DM goes to exactly one person, so being able to see it *is* the
 * authorisation — that is why the approve and reject handlers never compare
 * `interaction.user.id`. A payment notice is fanned out to every admin, so the
 * same assumption would let any of them act, and it would be the wrong one the
 * day an admin is demoted. `handlePaymentDecision` therefore re-reads the actor
 * and requires the role, the same way `requireAdmin` does for HTTP.
 *
 * DOES NOT OWN: generation or publishing logic — both live in `planService` — or
 * what settling a payment writes (`paymentService`).
 */

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { existsSync } from 'node:fs';

import { Post } from '../../models/Post.js';
import { User } from '../../models/User.js';
import { parseCustomId } from './approvalQueue.js';
import { buildReviewedPayload, parsePaymentCustomId } from './paymentQueue.js';
import { imageFilenameFor, imageFilePathFor } from '../ai/imageGenerator.js';
import { reviewPayment } from '../paymentService.js';
import { approvePost, regeneratePost, rejectPost } from '../planService.js';
import {
  DISCORD_CONTENT_LIMIT,
  DISCORD_EMBED_DESCRIPTION_LIMIT,
  DISCORD_EMBED_FIELD_LIMIT,
  EMBED_COLOR,
  MAX_REGENERATIONS_PER_POST,
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  POST_STATUS,
  USER_ROLE,
} from '../../config/constants.js';
import { buildCopyBlock } from '../../utils/urlBuilder.js';
import { logger } from '../../utils/logger.js';

/**
 * Builds the message shown after a post is approved.
 *
 * The buttons are gone, which is what makes the approval final from the user's
 * side — an actionable button on an approved post would invite a second
 * publish.
 *
 * @param {object} post - The approved post document.
 * @param {object} payload - The publish payload from `services/publishing`.
 * @returns {{content: string, embeds: EmbedBuilder[], components: ActionRowBuilder[],
 *   files: AttachmentBuilder[]}} The message payload.
 * @sideeffect none (pure)
 */
export function buildPublishedPayload(post, payload) {
  const label = PLATFORM_LABELS[post.platform] ?? post.platform;
  const text = post.fullText();

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR.APPROVED)
    .setTitle(`✅ Approved — ${label}`)
    .setDescription(payload.instructions)
    .addFields({ name: 'Day', value: String(post.dayIndex), inline: true });

  if (payload.isThread) {
    embed.addFields({
      name: 'Thread',
      value: `${post.postSegments().length} parts — post part 1, then reply with the rest`,
      inline: true,
    });
  }

  if (payload.warning) {
    embed.addFields({ name: '⚠️ Note', value: payload.warning.slice(0, DISCORD_EMBED_FIELD_LIMIT) });
  }

  // The copy block stays in `content` rather than moving into the embed, so the
  // native Copy button survives. See the note in `approvalQueue.js`.
  const components = [];

  if (payload.composerUrl) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel(payload.linkLabel)
          .setStyle(ButtonStyle.Link)
          .setURL(payload.composerUrl),
      ),
    );
  }

  // `payload.copyBlocks` is what the publisher built — the same per-part blocks
  // the approval message showed, so what was approved is what gets copied.
  const copy = payload.copyBlocks ?? buildCopyBlock(text);

  // The same 2000-character ceiling that stopped the approval DM from being
  // delivered applies here. Without this check an approved LinkedIn post would
  // fail to render with error 50035 and the user would see the buttons go dead
  // with no explanation.
  const fits = copy.length <= DISCORD_CONTENT_LIMIT;

  if (!fits) {
    embed.setDescription(`${payload.instructions}\n\n${text}`.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT));
  }

  // The image travels with the post into its approved state. It is what the user
  // needs for the manual publish, and this edit replaces the approval payload —
  // which would otherwise take the attachment with it, because Discord drops
  // attachments on an edit unless they are re-sent.
  const files = [];

  if (post.imageUrl) {
    const filename = imageFilenameFor(post._id);
    const filePath = imageFilePathFor(post._id);

    if (existsSync(filePath)) files.push(new AttachmentBuilder(filePath, { name: filename }));
    embed.setImage(post.imageUrl);
  }

  return { content: fits ? copy : '', embeds: [embed], components, files };
}

/**
 * Handles Approve — publishes and finalises the message.
 *
 * @param {import('discord.js').ButtonInteraction} interaction - The interaction.
 * @param {string} postId - The post being approved.
 * @returns {Promise<void>}
 * @sideeffect Edits the Discord message and writes the post's status.
 */
async function handleApprove(interaction, postId) {
  const post = await Post.findById(postId);

  if (!post) {
    await interaction.editReply({ content: 'This post no longer exists.', embeds: [], components: [] });
    return;
  }

  let payload;
  try {
    payload = await approvePost({ post });
  } catch (err) {
    // Covers the double-click case, where the second interaction finds the post
    // already approved. Surfaced as a normal message rather than an error.
    await interaction.editReply({ content: `⚠️ ${err.message}`, embeds: [], components: [] });
    return;
  }

  await interaction.editReply(buildPublishedPayload(post, payload));

  logger.info(`Interaction: post ${postId} approved via Discord by ${interaction.user.id}`);
}

/**
 * Handles Reject — records the rejection and rewrites the post if allowed.
 *
 * @param {import('discord.js').ButtonInteraction} interaction - The interaction.
 * @param {object} post - The post being rejected.
 * @param {object} user - The owning user.
 * @returns {Promise<void>}
 * @sideeffect Writes post status, may generate and send a replacement.
 */
async function handleReject(interaction, post, user) {
  try {
    await rejectPost({ post });
  } catch (err) {
    await interaction.editReply({ content: `⚠️ ${err.message}`, embeds: [], components: [] });
    return;
  }

  const remaining = MAX_REGENERATIONS_PER_POST - post.regenerationCount;

  if (!post.canRegenerate(MAX_REGENERATIONS_PER_POST)) {
    // Cap reached. The slot is parked for the next cycle rather than retried
    // forever — otherwise a theme the user simply dislikes would keep spending
    // quota indefinitely.
    await interaction.editReply({
      content:
        `🚫 Rejected — this post has already been rewritten ${MAX_REGENERATIONS_PER_POST} times, ` +
        'so it will not be regenerated again. The slot stays open for the next cycle.',
      embeds: [],
      components: [],
    });

    logger.info(`Interaction: post ${post._id} rejected, regeneration cap reached`);
    return;
  }

  await interaction.editReply({
    content: `🔄 Rejected — writing a different take… (${remaining} rewrite${remaining === 1 ? '' : 's'} left after this)`,
    embeds: [],
    components: [],
  });

  const { post: replacement, reason } = await regeneratePost({ post, user });

  if (!replacement) {
    await interaction.followUp({
      content: `⚠️ Could not rewrite this post (${reason}). It has been parked; try again from the API.`,
    });
    return;
  }

  // A new draft arrives as a NEW message rather than replacing the old one, so
  // the user can compare the rewrite against what they rejected.
  const { queuePostForApproval } = await import('./approvalQueue.js');
  await queuePostForApproval(replacement, user);
}

/**
 * Opens the edit modal for a post.
 *
 * @param {import('discord.js').ButtonInteraction} interaction - The interaction.
 * @param {object} post - The post being edited.
 * @returns {Promise<void>}
 * @sideeffect Shows a modal to the user.
 */
async function handleEdit(interaction, post) {
  const limit = PLATFORM_LIMITS[post.platform];
  const label = PLATFORM_LABELS[post.platform] ?? post.platform;

  // For a thread this modal edits the ROOT only. Discord modals are single-field
  // here, and a field per part would need a dynamic modal the library does not
  // offer — so the label says which part it is rather than leaving the user to
  // discover that editing did not change part 3.
  const parts = typeof post.postSegments === 'function' ? post.postSegments() : [post.content];
  const isThread = parts.length > 1;
  const fieldLabel = isThread
    ? `Part 1 of ${parts.length} (max ${limit})`
    : `Post text (max ${limit} characters)`;

  const modal = new ModalBuilder()
    .setCustomId(`post:edit-submit:${post._id}`)
    .setTitle(`Edit — ${label}`.slice(0, 45));

  const input = new TextInputBuilder()
    .setCustomId('content')
    .setLabel(fieldLabel.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    // Pre-filled with the current text, so an edit is a tweak rather than a
    // rewrite from scratch.
    .setValue(post.content.slice(0, 4000))
    .setRequired(true)
    // Discord's own cap on the field. The real platform limit is enforced
    // afterwards — this only stops an obviously oversized paste.
    .setMaxLength(Math.min(4000, limit));

  modal.addComponents(new ActionRowBuilder().addComponents(input));

  // MUST come before any defer — see the module note.
  await interaction.showModal(modal);
}

/**
 * Applies a submitted edit and re-renders the approval message.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction - The submit.
 * @param {string} postId - The post being edited.
 * @returns {Promise<void>}
 * @sideeffect Writes the post's content and edits the Discord message.
 */
async function handleEditSubmit(interaction, postId) {
  await interaction.deferUpdate();

  const post = await Post.findById(postId);

  if (!post) {
    await interaction.editReply({
      content: 'This post can no longer be edited.',
      embeds: [],
      components: [],
    });
    return;
  }

  const submitted = interaction.fields.getTextInputValue('content').trim();

  try {
    // The guards (actionable, non-empty, within the platform limit) and the
    // message re-render all live in `updatePostContent`, because the dashboard
    // edits the same posts through the same function. Implementing them here as
    // well would be the two-code-paths problem `postRoutes.js` warns about.
    const { updatePostContent } = await import('../planService.js');
    await updatePostContent({ post, content: submitted });
  } catch (err) {
    // `updatePostContent` throws ApiError for the cases the user can fix, so its
    // message is written to be read — surface it rather than a generic failure.
    await interaction.editReply({
      content: `⚠️ ${err.message}`,
      embeds: [],
      components: [],
    });
  }

  logger.info(`Interaction: post ${post._id} edited via Discord`);
}

/**
 * Handles a button press.
 *
 * @param {import('discord.js').ButtonInteraction} interaction - The interaction.
 * @returns {Promise<void>}
 * @sideeffect May generate, publish, and edit messages.
 */
async function handleButtonInteraction(interaction) {
  // Two namespaces, tried in turn. Each parser rejects the other's ids, so a
  // payment button can never be acted on by the draft path, or the reverse.
  const payment = parsePaymentCustomId(interaction.customId);
  if (payment) {
    await handlePaymentDecision(interaction, payment);
    return;
  }

  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return;

  const { action, postId } = parsed;

  // Edit is the exception: it must open a modal before acknowledging.
  if (action === 'edit') {
    const post = await Post.findById(postId);
    if (!post || !post.isActionable()) {
      await interaction.reply({ content: 'This post can no longer be edited.', ephemeral: true });
      return;
    }
    await handleEdit(interaction, post);
    return;
  }

  // Everything else defers first, because the work can exceed 3 seconds.
  await interaction.deferUpdate();

  try {
    const post = await Post.findById(postId);
    if (!post) {
      await interaction.editReply({ content: 'This post no longer exists.', embeds: [], components: [] });
      return;
    }

    const user = await User.findById(post.userId);

    if (action === 'approve') {
      await handleApprove(interaction, postId);
    } else if (action === 'reject') {
      await handleReject(interaction, post, user);
    } else {
      // An unknown action means a stale button from an older message format.
      await interaction.editReply({ content: '⚠️ Unrecognised action.', embeds: [], components: [] });
    }
  } catch (err) {
    logger.error(`Interaction: ${action} failed for post ${postId}`, err);

    // The deferred state means the user is looking at a stale message with no
    // explanation unless we say something. Discord may have already timed the
    // token out, so the reply itself is allowed to fail quietly.
    await interaction
      .editReply({ content: '⚠️ Something went wrong handling that. The post is unchanged.', embeds: [], components: [] })
      .catch(() => {});
  }
}

/**
 * Handles a modal submission.
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction - The submit.
 * @returns {Promise<void>}
 * @sideeffect Writes the post and edits the message.
 */
async function handleModalSubmit(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'edit-submit') return;

  await handleEditSubmit(interaction, parsed.postId);
}

/**
 * Settles a payment claim from the message an admin was sent.
 *
 * ## Why the actor is re-read rather than trusted
 *
 * This message is DM'd to every admin, so seeing it proves nothing about who is
 * pressing. The role is read from the database — not from anything Discord
 * supplies — for the same reason `requireAuth` reloads the user on every request:
 * a demotion must take effect immediately, not at the end of some token's life.
 *
 * ## Why a lost race is not an error
 *
 * Two admins, or one admin in two places, will press the same button. The second
 * press finds the claim settled and gets a 409 saying what it is now. That is the
 * expected outcome of a well-designed concurrency guard, so it is reported as an
 * ordinary message rather than as a failure to be investigated.
 *
 * @param {import('discord.js').ButtonInteraction} interaction - The button press.
 * @param {object} parsed - The parsed custom id.
 * @param {string} parsed.decision - One of `PAYMENT_DECISION`.
 * @param {string} parsed.paymentId - The claim.
 * @returns {Promise<void>}
 * @sideeffect Writes the claim, possibly the customer's account, and edits the message.
 */
async function handlePaymentDecision(interaction, { decision, paymentId }) {
  await interaction.deferUpdate();

  try {
    const actor = await User.findOne({ discordUserId: interaction.user.id });

    if (!actor || actor.role !== USER_ROLE.ADMIN) {
      logger.warn(
        `Interaction: ${interaction.user.id} is not an admin and cannot ${decision} payment ${paymentId}`,
      );
      await interaction.editReply({
        content: '⚠️ Only an administrator can settle a payment.',
        embeds: [],
        components: [],
      });
      return;
    }

    const { payment, user } = await reviewPayment({
      paymentId,
      decision,
      reviewedBy: actor._id,
    });

    await interaction.editReply(
      buildReviewedPayload(payment, `<@${interaction.user.id}>`, user),
    );

    logger.info(
      `Interaction: payment ${paymentId} settled as ${payment.status} via Discord by ${actor.email}`,
    );
  } catch (err) {
    const settledAlready = err?.statusCode === 409;

    if (!settledAlready) {
      logger.error(`Interaction: ${decision} failed for payment ${paymentId}`, err);
    }

    // The deferred state means the operator is looking at a stale message unless
    // we say something. Discord may have timed the token out, so the reply is
    // allowed to fail quietly.
    await interaction
      .editReply({
        content: settledAlready
          ? `⚠️ ${err.message}`
          : '⚠️ Could not settle that payment. It is unchanged.',
        embeds: [],
        components: [],
      })
      .catch(() => {});
  }
}

/**
 * Registers the interaction listener on a client.
 *
 * @param {import('discord.js').Client} client - The connected client.
 * @returns {void}
 * @sideeffect Adds an `interactionCreate` listener.
 */
export function registerInteractionHandlers(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isModalSubmit()) {
        await handleModalSubmit(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
        return;
      }

      // Slash commands are registered separately in `commands.js`.
      if (interaction.isChatInputCommand()) {
        const { handleCommand } = await import('./commands.js');
        await handleCommand(interaction);
      }
    } catch (err) {
      // Last line of defence. An unhandled rejection here would be logged by
      // Node as a warning and the user would see a failed interaction with no
      // explanation — so it is caught even though every handler guards itself.
      logger.error('Interaction: unhandled failure', err);
    }
  });
}

export default { registerInteractionHandlers, buildPublishedPayload };
