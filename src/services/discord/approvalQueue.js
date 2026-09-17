/**
 * Approval queue — renders a draft and delivers it as a Discord DM.
 *
 * RESPONSIBILITY
 *   Turn a `Post` document into the message the user approves, rejects or edits.
 *
 * ## How "one action" actually works
 *
 * A Discord bot cannot write to the user's OS clipboard — there is no API for
 * it, and every workaround is malware-shaped. What Discord *does* provide is a
 * native **Copy** button on fenced code blocks.
 *
 * That is why the post text is delivered as a code block in the message
 * **content**, not in the embed description. Content is the guaranteed surface
 * for that button; putting it in the embed would look tidier and risk losing
 * the one feature the whole flow depends on. The embed carries the metadata
 * instead, so the two do not compete.
 *
 * Content and embeds can be sent together in one message, which is what keeps
 * this to a single delivery.
 *
 * DOES NOT OWN: what happens when a button is pressed (`interactions.js`).
 */

import { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { openDirectMessage } from './client.js';
import {
  EMBED_COLOR,
  PLATFORM,
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  POST_TYPE,
} from '../../config/constants.js';
import { buildCopyBlock, buildThreadCopyBlocks } from '../../utils/urlBuilder.js';
import { describeLength } from '../../utils/text.js';
import { DISCORD_CONTENT_LIMIT, DISCORD_EMBED_DESCRIPTION_LIMIT, POST_STATUS } from '../../config/constants.js';

/**
 * Builds the `customId` for an approval button.
 *
 * Format: `post:<action>:<postId>`. Parsed back apart in `interactions.js`.
 *
 * WHY A COMPOSITE ID: Discord gives the handler only this string, so it has to
 * carry both what to do and which post to do it to. Discord caps `customId` at
 * 100 characters; an ObjectId is 24, leaving ample room.
 *
 * @param {'approve'|'reject'|'edit'} action - The action to perform.
 * @param {string} postId - The post's id.
 * @returns {string} The button's custom id.
 * @sideeffect none (pure)
 */
export function buildCustomId(action, postId) {
  return `post:${action}:${postId}`;
}

/**
 * Parses a button `customId` back into its parts.
 *
 * @param {string} customId - The id from the interaction.
 * @returns {{action: string, postId: string}|null} The parts, or null when the
 *   id is not one of ours — which happens for stale buttons from an older
 *   message format, and must not throw.
 * @sideeffect none (pure)
 */
export function parseCustomId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts.length !== 3 || parts[0] !== 'post') return null;
  return { action: parts[1], postId: parts[2] };
}

/**
 * Builds the embed carrying the draft's metadata.
 *
 * @param {object} post - The `Post` document.
 * @param {object|null} [user] - The owning user, for the niche line.
 * @param {string|null} [overflowText] - The full post text, when it was too long
 *   to sit in the message content. Placed in the embed description, which allows
 *   4096 characters, so the post arrives whole rather than not at all.
 * @returns {EmbedBuilder} The embed.
 * @sideeffect none (pure)
 */
export function buildApprovalEmbed(post, user = null, overflowText = null) {
  const isNews = post.type === POST_TYPE.NEWS;

  const embed = new EmbedBuilder()
    // Yellow for news, blue for planned — a visual cue that survives a glance
    // at the notification preview.
    .setColor(isNews ? EMBED_COLOR.NEWS : EMBED_COLOR.PENDING)
    .setTitle(`Day ${post.dayIndex} — ${post.theme || 'Untitled theme'}`)
    .setFooter({ text: 'Approve to publish · Reject to rewrite · Edit to change the text' });

  if (overflowText) {
    // No code fence: Discord renders it as a wall of monospace and it is long
    // enough to dominate the message. The description is selectable, so the text
    // can still be copied — it just does not get the one-click button.
    embed.setDescription(overflowText.slice(0, DISCORD_EMBED_DESCRIPTION_LIMIT));
  }

  embed.addFields({
    name: 'Platform',
    value: PLATFORM_LABELS[post.platform] ?? post.platform,
    inline: true,
  });

  embed.addFields({
    name: 'Type',
    value: isNews ? 'From current news' : 'Planned',
    inline: true,
  });

  embed.addFields({
    name: 'Length',
    value: describeLength(post.fullText(), post.platform),
    inline: true,
  });

  // The part count belongs next to the length, because "280/280" on a thread
  // root would otherwise read as a post that only just fits rather than one with
  // three more parts behind it.
  const segments = typeof post.postSegments === 'function' ? post.postSegments() : null;
  if (segments && segments.length > 1) {
    embed.addFields({
      name: 'Thread',
      value: `${segments.length} parts — reply with 2-${segments.length} in order`,
      inline: true,
    });
  }

  if (isNews && post.sourceNewsUrl) {
    // The publisher name is shown as the link text because the URL itself is a
    // news.google.com redirect — see the note in `services/news/rssNews.js`.
    // Without the name, the source would be unreadable at a glance.
    embed.addFields({
      name: 'Source',
      value: `[${post.sourceNewsName ?? 'Original report'}](${post.sourceNewsUrl})`,
    });
  }

  if (user?.niche) {
    embed.addFields({ name: 'Niche', value: user.niche });
  }

  if (post.imageUrl) {
    // Phase 3 — unreachable in this build, kept so enabling it needs no change.
    embed.setImage(post.imageUrl);
  }

  return embed;
}

/**
 * Builds the three approval buttons.
 *
 * @param {string} postId - The post's id.
 * @returns {ActionRowBuilder} The button row.
 * @sideeffect none (pure)
 */
export function buildApprovalButtons(postId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId('approve', postId))
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId('reject', postId))
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildCustomId('edit', postId))
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary),
  );

  return row;
}

/**
 * Builds the full message payload for a draft.
 *
 * Exported so a regenerate can rebuild the same payload to re-render a message
 * in place without sending a new one.
 *
 * @param {object} post - The `Post` document.
 * @param {object|null} [user] - The owning user.
 * @returns {{content: string, embeds: EmbedBuilder[], components: ActionRowBuilder[], files: AttachmentBuilder[]}}
 *   The message payload.
 * @sideeffect none (pure)
 */
export function buildApprovalPayload(post, user = null) {
  const isActionable = post.status === POST_STATUS.PENDING_APPROVAL;
  const fullText = post.fullText();

  // Every part, root first. For a single post this is just `fullText`.
  //
  // WHY A THREAD IS ONE MESSAGE AND NOT SEVERAL: the user has to be able to see
  // the whole thing before deciding. One message with a block per part is
  // readable and gives each part its own Discord Copy button; separate messages
  // would push the Approve button below the thread on a four-part post and could
  // interleave with anything else in the DM.
  //
  // A full thread is ~1120 characters at the X limit against Discord's 2000, so
  // it fits — but the fallback below exists because "fits" depends on a limit
  // that is configuration, not a constant.
  const segments = typeof post.postSegments === 'function' ? post.postSegments() : null;
  const isThread = Boolean(segments && segments.length > 1);

  // The root carries the hashtags, since that is what `fullText` appends.
  const parts = isThread ? [fullText, ...segments.slice(1)] : null;
  const threadedBlocks = isThread ? buildThreadCopyBlocks(parts) : null;
  const bodyBlock = threadedBlocks ?? buildCopyBlock(fullText);

  // WHEN THE POST IS TOO LONG FOR ONE MESSAGE
  //
  // Discord caps message content at 2000 characters. A LinkedIn post can be
  // 3000, so sending it as a code block failed with error 50035 ("Invalid Form
  // Body") and the DM was never delivered at all — for every LinkedIn post over
  // ~1992 characters. X never hit it because 280 fits, which is exactly why the
  // fault looked like "X works, LinkedIn doesn't" rather than a length problem.
  //
  // Chunking the copy block is NOT the fix: splitting one post's text across two
  // Copy buttons would make the user reassemble it by hand, and reassembling
  // wrong is worse than a slightly less convenient copy.
  //
  // So the text moves into the embed description, which allows 4096 characters —
  // comfortably above the 3000 LinkedIn ceiling. It stays whole, and it stays
  // selectable. The trade is losing Discord's one-click Copy button on exactly
  // the posts that cannot have it.
  const fitsInContent = bodyBlock.length <= DISCORD_CONTENT_LIMIT;

  const payload = {
    // The copy block. This is the feature — see the module note on why it sits
    // in content rather than in the embed.
    content: fitsInContent ? bodyBlock : '',
    embeds: [buildApprovalEmbed(post, user, fitsInContent ? null : fullText)],
    // Buttons are omitted once the post has been actioned, so an old message
    // cannot be approved a second time.
    components: isActionable ? [buildApprovalButtons(post._id.toString())] : [],
    files: [],
  };

  if (post.imageUrl) {
    const filename = `${post._id.toString()}.jpg`;
    const downloadUrl = `${env.PUBLIC_BASE_URL}/media/${filename}`;
    payload.embeds[0].addFields({ name: 'Image', value: `[Download](${downloadUrl})` });
  }

  return payload;
}

/**
 * Sends a draft to its owner as a DM.
 *
 * @param {object} post - The `Post` document. Mutated with the message and
 *   channel ids so the message can be edited later.
 * @param {object|null} [user] - The owning user. Fetched by `discordUserId`
 *   when not supplied.
 * @returns {Promise<{sent: boolean, reason?: string, messageId?: string}>}
 *   `sent: false` with a reason when delivery was not possible — the caller
 *   should not treat that as a crash.
 * @throws {never} Delivery problems are reported, not thrown, because a failed
 *   DM must not abort a scheduler run that is processing other users.
 * @sideeffect Sends a Discord message and writes the message id onto the post.
 */
export async function queuePostForApproval(post, user = null) {
  if (!post) return { sent: false, reason: 'no_post' };

  // The recipient: either passed in, or read off the post's owner.
  const discordUserId = user?.discordUserId ?? post.discordUserId ?? null;

  if (!discordUserId) {
    logger.warn(`queuePostForApproval: post ${post._id} has no linked Discord user — not delivered`);
    return { sent: false, reason: 'no_discord_user' };
  }

  try {
    const channel = await openDirectMessage(discordUserId);
    const payload = buildApprovalPayload(post, user);

    // Guarded before sending rather than after a rejection, because Discord
    // rejects the WHOLE message with 50035 when any part is over its limit and
    // `channel.send` gives no clue which part was at fault. This is the check
    // that would have caught the LinkedIn delivery failure at the source.
    if (payload.content.length > DISCORD_CONTENT_LIMIT) {
      logger.error(
        `queuePostForApproval: message content for post ${post._id} is ${payload.content.length} ` +
          `characters against Discord's ${DISCORD_CONTENT_LIMIT} limit — refusing to send`,
      );
      return { sent: false, reason: 'content_too_long' };
    }

    const message = await channel.send(payload);

    post.discordMessageId = message.id;
    post.discordChannelId = channel.id;
    await post.save();

    logger.info(`Delivered post ${post._id} (day ${post.dayIndex}, ${post.platform}) to ${discordUserId}`);

    return { sent: true, messageId: message.id };
  } catch (err) {
    // The most common cause by far is the user having DMs closed for this
    // server's members. The message says so, because "Missing Permissions" on
    // its own is not actionable.
    logger.error(
      `queuePostForApproval: could not DM ${discordUserId} for post ${post._id}. ` +
        'Usually the recipient has DMs disabled for this server\'s members.',
      err,
    );
    return { sent: false, reason: err?.code ?? 'send_failed' };
  }
}

/**
 * Re-renders an existing approval message in place.
 *
 * Used after an edit so the message and the stored post do not diverge, and
 * after approval to strip the buttons.
 *
 * @param {object} post - The `Post` document, already saved.
 * @param {object|null} [user] - The owning user.
 * @returns {Promise<boolean>} True when the message was updated.
 * @throws {never} A missing or deleted message is reported, not thrown — the
 *   user may have cleared the DM, which is not an error.
 * @sideeffect Edits a Discord message.
 */
export async function refreshApprovalMessage(post, user = null) {
  if (!post?.discordMessageId || !post?.discordChannelId) return false;

  try {
    const { getDiscordClient } = await import('./client.js');
    const channel = await getDiscordClient().channels.fetch(post.discordChannelId);
    const message = await channel.messages.fetch(post.discordMessageId);

    await message.edit(buildApprovalPayload(post, user));
    return true;
  } catch (err) {
    logger.warn(`refreshApprovalMessage: could not update message for post ${post._id}`, err?.message);
    return false;
  }
}

export default {
  queuePostForApproval,
  refreshApprovalMessage,
  buildApprovalPayload,
  buildApprovalEmbed,
  buildApprovalButtons,
  buildCustomId,
  parseCustomId,
};
