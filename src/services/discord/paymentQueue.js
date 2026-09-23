/**
 * Payment claims in Discord — the reconciliation notice, and the buttons that settle it.
 *
 * RESPONSIBILITY
 *   Render a submitted claim as a DM to every admin, and build the payload the
 *   interaction router edits in place once the claim has been settled.
 *
 * ## Why this is a notice, not an approval request
 *
 *   By default the plan is already live when this message arrives
 *   (`PAYMENT_AUTO_VERIFY`). The work it asks for is reconciliation: match the
 *   reference against the statement, then confirm or revoke. Wording it as
 *   "awaiting approval" would be untrue — nobody is blocked on the answer — and
 *   would teach the operator that the customer is waiting when they are not.
 *
 * ## Why the buttons need a role check somewhere else
 *
 *   This message is fanned out to every admin, so the fact that someone can see
 *   it does not identify them — unlike the draft DM, which only its owner
 *   receives. `interactions.js` therefore re-reads the person pressing and
 *   requires the admin role. Nothing in this file is a guard.
 *
 * ## Why a failed DM never fails the purchase
 *
 *   The customer has already been given what they paid for, and the claim is in
 *   the queue either way, so a closed DM or a gateway outage must not turn a
 *   successful purchase into an error. Every send is attempted, each failure is
 *   reported in the return value, and nothing throws.
 *
 * DOES NOT OWN: whether a decision is allowed, or what it writes
 * (`services/paymentService.js`).
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';

import {
  EMBED_COLOR,
  PAYMENT_DECISION,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  PLANS,
  USER_ROLE,
} from '../../config/constants.js';
import { User } from '../../models/User.js';
import { logger } from '../../utils/logger.js';
import { openDirectMessage } from './client.js';

/** The namespace these buttons live in, so they cannot be confused with drafts'. */
const PAYMENT_ID_PREFIX = 'payment';

/**
 * Builds a button's custom id.
 *
 * @param {string} decision - One of `PAYMENT_DECISION`.
 * @param {string} paymentId - The claim the button acts on.
 * @returns {string} The id, in the same three-part shape the draft buttons use.
 * @sideeffect none (pure)
 */
export function buildPaymentCustomId(decision, paymentId) {
  return `${PAYMENT_ID_PREFIX}:${decision}:${paymentId}`;
}

/**
 * Reads a payment button's custom id.
 *
 * Returns null for anything that is not one of ours, which is how the router
 * keeps its two namespaces apart: the draft parser rejects `payment:` ids and
 * this rejects `post:` ids, so neither can act on the other's message.
 *
 * @param {string} customId - The id Discord sent back.
 * @returns {{decision: string, paymentId: string}|null} The parsed parts, or null.
 * @sideeffect none (pure)
 */
export function parsePaymentCustomId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts.length !== 3 || parts[0] !== PAYMENT_ID_PREFIX) return null;

  const [, decision, paymentId] = parts;
  if (!Object.values(PAYMENT_DECISION).includes(decision)) return null;

  return { decision, paymentId };
}

/**
 * Formats an amount the way it is quoted to the customer.
 *
 * @param {number} amountPkr - Whole rupees.
 * @returns {string} e.g. `Rs 3,000`.
 * @sideeffect none (pure)
 */
function formatPkr(amountPkr) {
  return `Rs ${Number(amountPkr).toLocaleString('en-PK')}`;
}

/**
 * Formats a date as a Discord timestamp, so the operator reads it in their own
 * timezone rather than the server's.
 *
 * @param {Date|string|null} value - The moment to show.
 * @param {'F'|'R'} [style='F'] - Long date, or a relative "in 3 hours".
 * @returns {string} A timestamp, or an em dash when there is no date.
 * @sideeffect none (pure)
 */
function discordTime(value, style = 'F') {
  if (!value) return '—';
  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${style}>`;
}

/**
 * Describes what a claim did to the account.
 *
 * @param {object} payment - The claim.
 * @returns {string} One line for the embed.
 * @sideeffect none (pure)
 */
function describeGrant(payment) {
  if (!payment.grantedAt) return 'Nothing granted yet — this claim is waiting on you.';

  const until = payment.grantedUntil
    ? `until ${discordTime(payment.grantedUntil, 'F')}`
    : 'with no end date';
  const was = payment.previousPlan && payment.previousPlan !== 'free'
    ? ` (was ${PLANS[payment.previousPlan]?.name ?? payment.previousPlan})`
    : '';

  return `${PLANS[payment.grantedPlan]?.name ?? payment.grantedPlan} active ${until}${was}`;
}

/**
 * Builds the notice an admin receives.
 *
 * @param {object} payment - The claim.
 * @param {object|null} [user] - The account, when already loaded.
 * @returns {EmbedBuilder} The embed.
 * @sideeffect none
 */
export function buildPaymentEmbed(payment, user = null) {
  const account = user ?? payment.userId ?? null;
  const granted = Boolean(payment.grantedAt);

  const embed = new EmbedBuilder()
    .setColor(granted ? EMBED_COLOR.APPROVED : EMBED_COLOR.PENDING)
    .setTitle(
      granted
        ? `Payment claim — ${formatPkr(payment.amountPkr)} claimed, plan already active`
        : `Payment claim — ${formatPkr(payment.amountPkr)} to verify`,
    )
    .addFields(
      { name: 'Account', value: account?.email ?? String(payment.userId) },
      {
        name: 'Bought',
        value: `${PLANS[payment.tier]?.name ?? payment.tier} · ${formatPkr(payment.amountPkr)} · ${payment.durationDays} days`,
      },
      {
        name: 'Paid via',
        value: `${PAYMENT_METHOD_LABELS[payment.method] ?? payment.method} — \`${payment.reference}\``,
      },
      { name: 'Effect on the account', value: describeGrant(payment) },
      { name: 'Submitted', value: discordTime(payment.createdAt, 'R') },
    );

  if (payment.note) {
    // The customer's own words, in their own field — it is context, not data.
    embed.addFields({ name: 'Their note', value: payment.note.slice(0, 500) });
  }

  embed.setFooter({
    text: granted
      ? 'Confirm the credit in your statement, or revoke the plan if it is not there.'
      : 'Verify to grant the plan now, or reject if the money is not there.',
  });

  return embed;
}

/**
 * Builds the decision buttons for a claim.
 *
 * The pair offered depends on whether the plan is already active: a granted
 * claim can only be confirmed or revoked, and an ungranted one verified or
 * rejected. Offering all four would present two buttons that cannot work.
 *
 * @param {object} payment - The claim.
 * @returns {ActionRowBuilder} The row.
 * @sideeffect none
 */
export function buildPaymentButtons(payment) {
  const paymentId = String(payment._id);

  const pair = payment.grantedAt
    ? [
      { decision: PAYMENT_DECISION.CONFIRM, label: 'Confirm', style: ButtonStyle.Success },
      { decision: PAYMENT_DECISION.REVOKE, label: 'Revoke', style: ButtonStyle.Danger },
    ]
    : [
      { decision: PAYMENT_DECISION.VERIFY, label: 'Verify', style: ButtonStyle.Success },
      { decision: PAYMENT_DECISION.REJECT, label: 'Reject', style: ButtonStyle.Danger },
    ];

  return new ActionRowBuilder().addComponents(
    pair.map(({ decision, label, style }) =>
      new ButtonBuilder()
        .setCustomId(buildPaymentCustomId(decision, paymentId))
        .setLabel(label)
        .setStyle(style),
    ),
  );
}

/**
 * Builds what the message becomes once a decision has been taken.
 *
 * The buttons are dropped rather than left in place: they would only refuse, and
 * a dead control invites a second press and a support question.
 *
 * @param {object} payment - The settled claim.
 * @param {string} actorTag - Who decided, as a Discord mention.
 * @param {object|null} [account] - The account, when the caller has it loaded —
 *   the settled claim carries only its id, and an operator reading a DM should
 *   see an address rather than an ObjectId.
 * @returns {{content: string, embeds: EmbedBuilder[], components: never[]}} The payload.
 * @sideeffect none
 */
export function buildReviewedPayload(payment, actorTag, account = null) {
  const settled = payment.status === PAYMENT_STATUS.VERIFIED;
  const revoked = payment.status === PAYMENT_STATUS.REVOKED;

  let title = settled ? '✅ Payment confirmed' : '❌ Payment rejected';
  if (revoked) title = '↩️ Payment revoked — plan rolled back';

  const embed = new EmbedBuilder()
    .setColor(settled ? EMBED_COLOR.APPROVED : EMBED_COLOR.REJECTED)
    .setTitle(title)
    .addFields(
      {
        name: 'Account',
        value: account?.email ?? payment.user?.email ?? String(payment.userId),
      },
      { name: 'Amount', value: formatPkr(payment.amountPkr) },
      { name: 'Reference', value: `\`${payment.reference}\`` },
      { name: 'Effect on the account', value: describeGrant(payment) },
      { name: 'Decided by', value: `${actorTag} · ${discordTime(new Date(), 'R')}` },
    );

  if (payment.reviewNote) {
    embed.addFields({ name: 'Note', value: payment.reviewNote });
  }

  return { content: '', embeds: [embed], components: [] };
}

/**
 * DMs every admin about a submitted claim.
 *
 * Admins with no linked Discord account are counted as skipped rather than
 * failed — nothing is broken, they simply have not run `/connect`. Each send is
 * attempted independently, so one closed inbox cannot silence the others.
 *
 * @param {object} payment - The claim.
 * @param {object|null} [user] - The account, for the embed's `Account` field.
 * @returns {Promise<{admins: number, notified: number, failed: number, skipped: number, reason?: string}>}
 *   What happened. Never rejects.
 * @sideeffect Sends DMs and writes nothing.
 */
export async function notifyAdminsOfPayment(payment, user = null) {
  let admins;

  try {
    admins = await User.find({ role: USER_ROLE.ADMIN, isActive: true }).select(
      'email discordUserId',
    );
  } catch (err) {
    logger.error('paymentQueue: could not list admins for a claim notice', err);
    return { admins: 0, notified: 0, failed: 0, skipped: 0, reason: 'lookup-failed' };
  }

  const reachable = admins.filter((admin) => admin.discordUserId);
  const result = {
    admins: admins.length,
    notified: 0,
    failed: 0,
    skipped: admins.length - reachable.length,
  };

  try {
    const payload = {
      embeds: [buildPaymentEmbed(payment, user)],
      components: [buildPaymentButtons(payment)],
    };

    for (const admin of reachable) {
      try {
        const channel = await openDirectMessage(admin.discordUserId);
        await channel.send(payload);
        result.notified += 1;
      } catch (err) {
        result.failed += 1;
        // The usual cause is DMs closed for this server's members, which the log
        // line says because "Missing Permissions" alone is not actionable.
        logger.error(
          `paymentQueue: could not DM ${admin.email} about claim ${payment._id}. ` +
            'Usually the recipient has DMs disabled for this server\'s members.',
          err,
        );
      }
    }
  } catch (err) {
    // Reached when Discord is not connected at all, or the payload is invalid —
    // the claim is already recorded, so this is a notification that did not
    // happen, not a payment that did not work.
    logger.error(`paymentQueue: could not notify admins about claim ${payment._id}`, err);
    return { ...result, reason: 'discord-unavailable' };
  }

  if (reachable.length === 0) {
    logger.warn(
      `paymentQueue: claim ${payment._id} was submitted but no admin has a linked Discord account. ` +
        'It is waiting on /admin/payments.',
    );
  }

  return result;
}

export default {
  buildPaymentCustomId,
  parsePaymentCustomId,
  buildPaymentEmbed,
  buildPaymentButtons,
  buildReviewedPayload,
  notifyAdminsOfPayment,
};
