/**
 * Plan service — the orchestration layer.
 *
 * RESPONSIBILITY
 *   Own the pipeline that turns an approved plan into delivered drafts: build
 *   a plan, pick the next due slot, generate both platforms, deliver to
 *   Discord, and handle approval, rejection and regeneration.
 *
 * ## Why the ordering inside `generateSlot` matters
 *
 *   1. Resolve news ONCE per slot, not once per platform. Both the X and the
 *      LinkedIn post must comment on the *same* story — otherwise a single
 *      posting occasion produces two unrelated posts, and the user pays for
 *      two feed lookups instead of one.
 *   2. Consume the quota BEFORE the work. A crash between the call and the
 *      increment would hand the work out for free, and a run of those is
 *      exactly how a quota stops controlling cost.
 *   3. Persist the `Post` BEFORE sending it. If the DM fails the post still
 *      exists, so it can be re-delivered rather than regenerated — which would
 *      cost another API call for a post that was already written.
 *   4. Generate the image AFTER the text is persisted and BEFORE the DM. The
 *      image is an enhancement, so a failure there must not be able to lose a
 *      draft that is already written; it degrades to text-only with a note.
 *
 * ## Failure posture
 *
 * A generation failure returns `null` and is logged rather than thrown. The
 * scheduler processes every active user in one run; letting one user's failure
 * propagate would abandon everyone queued behind them.
 *
 * DOES NOT OWN: post text (`postGenerator`), rendering (`approvalQueue`), or
 * the platform-specific publish mechanics (`services/publishing`).
 */

import { User } from '../models/User.js';
import { ContentPlan } from '../models/ContentPlan.js';
import { Post } from '../models/Post.js';
import { generateContentPlan } from './ai/planGenerator.js';
import { generatePost, resolveNewsStory } from './ai/postGenerator.js';
import { generateImageForPost, IMAGE_SKIP_NOTES } from './ai/imageGenerator.js';
import { consume, resolveLimit } from './quotaService.js';
import { logGeneration, GENERATION_KIND } from './usageLogger.js';
import { queuePostForApproval, refreshApprovalMessage } from './discord/approvalQueue.js';
import { publishPost } from './publishing/index.js';
import { missingPlatforms, isSlotComplete } from '../utils/slotCoverage.js';
import {
  MAX_REGENERATIONS_PER_POST,
  PLAN_STATUS,
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  PLATFORMS,
  POST_STATUS,
  POST_TYPE,
  QUOTA_KEY,
  SLOT_STATUS,
  VALID_PLAN_DURATIONS,
} from '../config/constants.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { countCharacters } from '../utils/text.js';

/**
 * Creates a themed content plan for a user.
 *
 * Consumes one `planGenerations` unit before the model call.
 *
 * @param {object} params
 * @param {string} params.userId - The owning user.
 * @param {7|30} [params.durationDays] - Plan length; defaults to the user's preference.
 * @returns {Promise<object>} The saved `ContentPlan` document.
 * @throws {ApiError} 404 when the user does not exist; 429 when the quota is spent.
 * @sideeffect Calls the model, consumes quota, writes a plan and a log row.
 */
export async function createPlan({ userId, durationDays }) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found.');

  const duration = durationDays ?? user.defaultPlanDuration;

  if (!VALID_PLAN_DURATIONS.includes(duration)) {
    throw ApiError.badRequest(
      `durationDays must be one of ${VALID_PLAN_DURATIONS.join(', ')}.`,
      { received: duration },
    );
  }

  // Consume before generating — see the module note on ordering.
  // The limit is resolved per user rather than read from the global quotas: a
  // paid tier's allowance is a published number, and an unlimited grant bypasses
  // the check entirely. See `resolveLimit`.
  await consume({
    userId,
    key: QUOTA_KEY.PLAN_GENERATIONS,
    limit: resolveLimit(user, QUOTA_KEY.PLAN_GENERATIONS),
  });

  const started = Date.now();
  let result = null;
  let failure = null;

  try {
    result = await generateContentPlan({ user, durationDays: duration });
  } catch (err) {
    failure = err;
    // Recorded against the quota that was already spent, then rethrown — a plan
    // that could not be generated is a genuine failure, unlike a post.
    await logGeneration({
      kind: GENERATION_KIND.PLAN,
      userId,
      error: err,
      durationMs: Date.now() - started,
      meta: { durationDays: duration },
    });
    throw err;
  }

  await logGeneration({
    kind: GENERATION_KIND.PLAN,
    userId,
    result,
    durationMs: Date.now() - started,
    meta: { durationDays: duration, slots: result.slots.length, usedFallback: result.usedFallback },
  });

  const plan = new ContentPlan({
    userId,
    durationDays: duration,
    postFrequency: user.postFrequency,
    status: PLAN_STATUS.DRAFT,
    summary: result.summary,
    startDate: new Date(),
    days: result.slots,
  });

  plan.refreshEndDate();
  await plan.save();

  logger.info(
    `Created plan ${plan._id} for user ${userId}: ${plan.days.length} slots over ${duration} days`,
  );

  return plan;
}

/**
 * Loads a plan and verifies it belongs to the given user.
 *
 * WHY: every plan route takes a plan id from the client. Without this check,
 * changing the id in a URL would expose another user's plan — the classic
 * broken-object-level-authorisation bug. Ownership is asserted here once rather
 * than trusted at each call site.
 *
 * @param {object} params
 * @param {string} params.planId - The plan id.
 * @param {string} params.userId - The requesting user.
 * @param {boolean} [params.requireApproved=false] - Reject unless status is `approved`.
 * @returns {Promise<object>} The plan document.
 * @throws {ApiError} 404 when missing, 403 when owned by someone else.
 * @sideeffect none
 */
export async function loadOwnedPlan({ planId, userId, requireApproved = false }) {
  const plan = await ContentPlan.findById(planId);
  if (!plan) throw ApiError.notFound('Plan not found.');

  if (plan.userId.toString() !== userId.toString()) {
    // 404 rather than 403: confirming that an id exists but belongs to someone
    // else leaks the existence of other users' data.
    throw ApiError.notFound('Plan not found.');
  }

  if (requireApproved && plan.status !== PLAN_STATUS.APPROVED) {
    throw ApiError.conflict(`Plan must be approved first (currently "${plan.status}").`);
  }

  return plan;
}

/**
 * Generates both platforms for one posting slot and delivers them.
 *
 * @param {object} params
 * @param {object} params.user - The user document.
 * @param {object} params.plan - The plan document.
 * @param {object} params.slot - The slot to generate.
 * @param {boolean} [params.force=false] - Regenerate even if already generated.
 * @returns {Promise<{generated: object[], skipped: string[]}>} The created posts
 *   and any platforms that were skipped, with reasons.
 * @throws {never} Per-platform failures are logged and skipped.
 * @sideeffect Calls the model, consumes quota, writes posts, sends DMs.
 */
export async function generateSlot({ user, plan, slot, force = false }) {
  const platforms = user.platforms?.length ? user.platforms : PLATFORMS;
  const generated = [];
  const skipped = [];

  // Which platforms this slot still needs.
  //
  // Derived from the posts that exist rather than from a flag on the slot: the
  // `Post` collection already records what was produced, and a second copy of
  // that fact could disagree with it. A platform is done iff its post is here.
  const existingPosts = await Post.find({ planId: plan._id, dayIndex: slot.dayIndex });
  const existingPlatforms = new Set(existingPosts.map((post) => post.platform));

  // `force` regenerates everything; otherwise only the gaps are filled. This is
  // what makes a partially-failed slot recoverable — the platform that already
  // succeeded is not regenerated, so the retry costs one model call, not two.
  const missing = force ? platforms : missingPlatforms(platforms, existingPlatforms);

  if (missing.length === 0) {
    return { generated: [], skipped: ['slot already generated'] };
  }

  // Resolve the news story ONCE for the whole slot so both platforms comment on
  // the same story. Doing it per platform would produce two unrelated posts and
  // double the feed cost.
  //
  // Only when a news slot is actually being generated — a retry that fills in
  // just the missing LinkedIn post must not pay for a second feed lookup.
  let news = null;
  if (slot.type === POST_TYPE.NEWS) {
    try {
      await consume({
        userId: user._id,
        key: QUOTA_KEY.NEWS_LOOKUPS,
        limit: resolveLimit(user, QUOTA_KEY.NEWS_LOOKUPS),
      });
    } catch (err) {
      // Out of news lookups is not fatal: the slot degrades to a planned post,
      // which still fills the day. The alternative is a missing post.
      logger.warn(`generateSlot: news quota unavailable for slot ${slot.dayIndex}, writing a planned post instead`);
      skipped.push('news quota exhausted — wrote a planned post');
    }

    if (!skipped.length) {
      news = await resolveNewsStory({ user }).catch((err) => {
        logger.warn(`generateSlot: news lookup failed for slot ${slot.dayIndex}`, err?.message);
        return null;
      });

      if (!news) skipped.push('no usable news story — wrote a planned post');
    }
  }

  for (const platform of missing) {
    const started = Date.now();

    try {
      const draft = await generatePost({ user, slot, platform, existingNews: news });

      await logGeneration({
        kind: draft.sourceNews ? GENERATION_KIND.POST : GENERATION_KIND.POST,
        userId: user._id,
        result: draft,
        durationMs: draft.durationMs,
        meta: { planId: plan._id, dayIndex: slot.dayIndex, platform, truncated: draft.truncated },
      });

      const post = new Post({
        userId: user._id,
        planId: plan._id,
        dayIndex: slot.dayIndex,
        platform,
        // A slot that wanted news but found none is stored as planned, so the
        // post does not claim a provenance it does not have.
        type: draft.sourceNews ? POST_TYPE.NEWS : POST_TYPE.PLANNED,
        content: draft.content,
        thread: draft.thread ?? [],
        hashtags: draft.hashtags,
        theme: slot.theme,
        sourceNewsUrl: draft.sourceNews?.url ?? null,
        sourceNewsTitle: draft.sourceNews?.title ?? null,
        sourceNewsName: draft.sourceNews?.name ?? null,
        needsImage: draft.needsImage,
        imagePrompt: draft.imagePrompt,
        status: POST_STATUS.PENDING_APPROVAL,
        aiModel: draft.model,
        generationMs: Date.now() - started,
      });

      // Persist BEFORE delivering. If the DM fails, the post exists and can be
      // re-sent instead of regenerated — which would cost another API call for
      // text that was already written.
      await post.save();

      // Phase 3 — the image, when the text model asked for one. Deliberately
      // between persistence and delivery: the draft is already safe, so a
      // refused or failed image costs the user the illustration and nothing
      // else, and the note on the post explains it in the message.
      if (post.needsImage && post.imagePrompt) {
        await attachImage({ post, user, skipped });
        await post.save();
      }

      const delivery = await queuePostForApproval(post, user);
      if (!delivery.sent) {
        skipped.push(`${platform}: generated but not delivered (${delivery.reason})`);
      }

      generated.push(post);
    } catch (err) {
      logger.error(`generateSlot: ${platform} generation failed for slot ${slot.dayIndex}`, err);
      skipped.push(`${platform}: ${err.message}`);
    }
  }

  // A slot is done only when every configured platform has a post.
  //
  // This used to flip on `generated.length > 0`, which meant one platform
  // succeeding marked the slot complete and the other was never retried — a
  // slot could be permanently half-delivered while showing as finished. Leaving
  // it pending keeps it recoverable: the next run, or the Generate button, fills
  // exactly the gap.
  const producedPlatforms = new Set([...existingPlatforms, ...generated.map((p) => p.platform)]);
  const isComplete = isSlotComplete(platforms, producedPlatforms);

  if (isComplete) {
    plan.setSlotStatus(slot.dayIndex, SLOT_STATUS.GENERATED);
  }

  const slotDoc = plan.days.find((d) => d.dayIndex === slot.dayIndex);
  if (slotDoc) {
    // Recorded whenever the attempt was not clean, cleared when it was — so the
    // rail can explain a stuck slot long after the toast has gone.
    slotDoc.lastSkipReason = skipped.length > 0 ? skipped.join(' · ') : null;
  }
  await plan.save();

  return { generated, skipped };
}

/**
 * Generates a post's image, degrading to text-only on any failure.
 *
 * ## Why this never throws
 *
 * The draft is already written and saved by the time this runs, so an image
 * failure can only cost the illustration. Every path here ends with the post
 * still queueable: the reason is stored on the post — which is what the
 * approval message renders from — and appended to the slot's skip list, so a
 * slot that keeps missing its image stays explained long after the toast has
 * gone.
 *
 * ## Why there is no retry
 *
 * One image costs ~$0.04 and ~16s, the most expensive call in the pipeline, so
 * a retry loop is exactly the cost risk the weekly quota exists to prevent.
 * See the note in `imageGenerator`.
 *
 * @param {object} params
 * @param {object} params.post - The saved post to illustrate. Mutated with the
 *   image URL or the skip note; the caller owns the `save()`.
 * @param {object} params.user - The owning user, for the niche line.
 * @param {string[]} [params.skipped=[]] - The slot's skip list, appended to in
 *   place when the caller has one. A regenerate has no slot list to update, so
 *   there the note on the post is the only record — which is the surface the
 *   message renders from anyway.
 * @returns {Promise<void>}
 * @sideeffect Calls the image API, writes a file, mutates the post.
 */
async function attachImage({ post, user, skipped = [] }) {
  // Lowercase, matching the other entries in the slot's skip list so the stored
  // reason reads as one sentence rather than two naming conventions.
  const platform = post.platform;

  // Consumed BEFORE the paid call, like every other metered operation — a
  // failure after consuming must not still bill for nothing, and a crash
  // between the call and the increment must not hand out free work. A refusal
  // here means no request was made, so it is noted on the post but not written
  // to `GenerationLog`: there is no AI call to record.
  try {
    await consume({
      userId: user._id,
      key: QUOTA_KEY.IMAGES,
      limit: resolveLimit(user, QUOTA_KEY.IMAGES),
    });
  } catch {
    logger.warn(
      `generateSlot: weekly image quota spent for user ${user._id} — ` +
        `post ${post._id} queued text-only`,
    );
    post.imageSkipReason = IMAGE_SKIP_NOTES.quota;
    skipped.push(`${platform}: image quota exhausted — queued text-only`);
    return;
  }

  const started = Date.now();

  try {
    const image = await generateImageForPost({ post, user });

    await logGeneration({
      kind: GENERATION_KIND.IMAGE,
      userId: user._id,
      result: image,
      durationMs: image.durationMs,
      meta: {
        planId: post.planId,
        dayIndex: post.dayIndex,
        platform: post.platform,
        bytes: image.bytes,
      },
    });

    logger.info(`Generated image for post ${post._id} (${image.bytes} bytes in ${image.durationMs}ms)`);
  } catch (err) {
    // The provider detail — moderation categories, the upstream status — was
    // logged by `imageGenerator`. The user gets the fixed note for the reason.
    const reason = err.details?.reason ?? 'failed';
    post.imageSkipReason = IMAGE_SKIP_NOTES[reason] ?? IMAGE_SKIP_NOTES.failed;

    logger.error(`generateSlot: image ${reason} for post ${post._id} — queued text-only`);
    skipped.push(`${platform}: image ${reason} — queued text-only`);

    // Attempted calls are recorded even when they failed, for the same reason
    // the post path does it: a provider refusing half the requests must not
    // look identical to one that is working.
    await logGeneration({
      kind: GENERATION_KIND.IMAGE,
      userId: user._id,
      error: err,
      durationMs: Date.now() - started,
      meta: {
        planId: post.planId,
        dayIndex: post.dayIndex,
        platform: post.platform,
        reason,
      },
    });
  }
}

/**
 * Finds the next pending slot in a user's approved plan and generates it.
 *
 * @param {object} params
 * @param {string} params.userId - The user to advance.
 * @returns {Promise<{planId: string, dayIndex: number, generated: object[], skipped: string[], exhausted: boolean}|null>}
 *   What was produced, or null when there is nothing to do.
 * @throws {never} Failures are logged and reported as a null result.
 * @sideeffect Generates and delivers posts.
 */
export async function generateNextSlot({ userId }) {
  const user = await User.findById(userId);
  if (!user || !user.isActive) return null;

  if (!user.discordUserId) {
    // Without a linked Discord account there is nowhere to deliver a draft, so
    // generating one would spend quota on a post nobody can approve.
    logger.warn(`generateNextSlot: user ${userId} has no Discord account linked — skipped`);
    return null;
  }

  const plan = await ContentPlan.findOne({
    userId,
    status: PLAN_STATUS.APPROVED,
  }).sort({ createdAt: -1 });

  if (!plan) return null;

  const slot = plan.nextPendingSlot();

  if (!slot) {
    // Plan exhausted. Renew only if the user opted in; otherwise stop and leave
    // the plan as evidence of what was delivered.
    if (user.autoRenewPlan) {
      logger.info(`generateNextSlot: plan ${plan._id} exhausted, auto-renewing for user ${userId}`);
      plan.status = PLAN_STATUS.COMPLETED;
      await plan.save();
      const renewed = await createPlan({ userId, durationDays: plan.durationDays });
      return generateNextSlot({ userId: renewed.userId });
    }

    plan.status = PLAN_STATUS.COMPLETED;
    await plan.save();
    return { planId: plan._id.toString(), dayIndex: 0, generated: [], skipped: [], exhausted: true };
  }

  const { generated, skipped } = await generateSlot({ user, plan, slot });

  return {
    planId: plan._id.toString(),
    dayIndex: slot.dayIndex,
    generated,
    skipped,
    exhausted: false,
  };
}

/**
 * Rewrites a rejected post and re-delivers it.
 *
 * @param {object} params
 * @param {object} params.post - The rejected post document.
 * @param {object} params.user - The owning user.
 * @returns {Promise<{post: object|null, reason?: string}>} The replacement post,
 *   or a reason why it could not be produced.
 * @throws {never} Failures are logged and returned as a null post.
 * @sideeffect Calls the model, writes a post, sends a DM.
 */
export async function regeneratePost({ post, user }) {
  if (!post.canRegenerate(MAX_REGENERATIONS_PER_POST)) {
    return { post: null, reason: 'regeneration_limit_reached' };
  }

  const plan = await ContentPlan.findById(post.planId);
  if (!plan) return { post: null, reason: 'plan_missing' };

  const slot = plan.days.find((s) => s.dayIndex === post.dayIndex);
  if (!slot) return { post: null, reason: 'slot_missing' };

  const started = Date.now();

  try {
    // Reuse the original story where there was one. A rejection is about the
    // writing, not the subject, so re-fetching would pay twice for the same
    // information and risk swapping the topic out from under the user.
    let existingNews = null;
    if (post.type === POST_TYPE.NEWS && post.sourceNewsUrl) {
      existingNews = {
        story: {
          url: post.sourceNewsUrl,
          title: post.sourceNewsTitle,
          name: post.sourceNewsName,
          homepage: '',
          publishedAt: post.createdAt,
          ageDays: 0,
        },
        insight: { summary: '', whyItMatters: '' },
        reason: 'reused from the rejected draft',
      };
    }

    const draft = await generatePost({ user, slot, platform: post.platform, existingNews });

    await logGeneration({
      kind: GENERATION_KIND.POST,
      userId: user._id,
      result: draft,
      durationMs: draft.durationMs,
      meta: {
        planId: plan._id,
        dayIndex: post.dayIndex,
        platform: post.platform,
        regeneration: post.regenerationCount + 1,
      },
    });

    const replacement = new Post({
      userId: user._id,
      planId: plan._id,
      dayIndex: post.dayIndex,
      platform: post.platform,
      type: draft.sourceNews ? POST_TYPE.NEWS : POST_TYPE.PLANNED,
      content: draft.content,
      hashtags: draft.hashtags,
      theme: slot.theme,
      sourceNewsUrl: draft.sourceNews?.url ?? null,
      sourceNewsTitle: draft.sourceNews?.title ?? null,
      sourceNewsName: draft.sourceNews?.name ?? null,
      needsImage: draft.needsImage,
      imagePrompt: draft.imagePrompt,
      status: POST_STATUS.PENDING_APPROVAL,
      // Incremented from the rejected draft, so the cap counts the whole chain
      // rather than resetting on each new document.
      regenerationCount: post.regenerationCount + 1,
      parentPostId: post._id,
      aiModel: draft.model,
      generationMs: Date.now() - started,
    });

    await replacement.save();

    // The replacement gets the same treatment as a first draft: rejecting the
    // writing is not a decision about the artwork. Repeated rejections cannot
    // run away with cost — the weekly image quota is the bound.
    if (replacement.needsImage && replacement.imagePrompt) {
      await attachImage({ post: replacement, user });
      await replacement.save();
    }

    await queuePostForApproval(replacement, user);

    return { post: replacement };
  } catch (err) {
    logger.error(`regeneratePost: failed for post ${post._id}`, err);
    return { post: null, reason: err.message };
  }
}

/**
 * Approves a post and returns its publish instructions.
 *
 * Idempotent: a post that is no longer `pending_approval` is rejected rather
 * than re-published, which is what stops a double-clicked button from
 * producing two publishes.
 *
 * @param {object} params
 * @param {object} params.post - The post to approve.
 * @returns {Promise<object>} The publish payload from `services/publishing`.
 * @throws {ApiError} 409 when the post has already been actioned.
 * @sideeffect Writes the post's new status.
 */
export async function approvePost({ post }) {
  if (!post.isActionable()) {
    throw ApiError.conflict(`This post has already been ${post.status.replace('_', ' ')}.`);
  }

  const payload = publishPost(post);

  post.status = POST_STATUS.APPROVED;
  post.publishedAt = new Date();
  await post.save();

  logger.info(`Approved post ${post._id} (${post.platform}, day ${post.dayIndex})`);

  return payload;
}

/**
 * Rejects a post and records the decision.
 *
 * The caller decides whether to regenerate — see the interaction handler, which
 * enforces the regeneration cap before calling `regeneratePost`.
 *
 * @param {object} params
 * @param {object} params.post - The post to reject.
 * @returns {Promise<void>}
 * @throws {ApiError} 409 when the post has already been actioned.
 * @sideeffect Writes the post's new status.
 */
export async function rejectPost({ post }) {
  if (!post.isActionable()) {
    throw ApiError.conflict(`This post has already been ${post.status.replace('_', ' ')}.`);
  }

  post.status = POST_STATUS.REJECTED;
  await post.save();

  logger.info(`Rejected post ${post._id} (${post.platform}, day ${post.dayIndex})`);
}

/**
 * Replaces a draft's content, keeping the Discord message in step.
 *
 * ## Why this is a service and not two handlers
 *
 * Editing used to be reachable only from the Discord modal. The dashboard now
 * offers the same thing, and `postRoutes.js` is explicit about why that is
 * dangerous: two entry points that each implement their own guards will
 * eventually disagree about what a post is allowed to become. So both callers
 * delegate here, and the guards exist once.
 *
 * The re-render is part of the operation rather than the caller's job for the
 * same reason: a message that still shows the old text would be asking the user
 * to approve something they are not looking at.
 *
 * @param {object} params
 * @param {object} params.post - The post to edit.
 * @param {string} params.content - The new body.
 * @returns {Promise<object>} The saved post.
 * @throws {ApiError} 409 when the post has already been actioned; 400 when the
 *   content is empty or over the platform limit.
 * @sideeffect Writes the post and edits its Discord message.
 */
export async function updatePostContent({ post, content }) {
  if (!post.isActionable()) {
    throw ApiError.conflict(`This post has already been ${post.status.replace('_', ' ')}.`);
  }

  const trimmed = String(content ?? '').trim();
  if (!trimmed) throw ApiError.badRequest('A post cannot be empty.');

  const limit = PLATFORM_LIMITS[post.platform];
  const length = countCharacters(trimmed);
  if (length > limit) {
    throw ApiError.badRequest(
      `That is ${length} characters — ${limit} is the limit for ${PLATFORM_LABELS[post.platform] ?? post.platform}.`,
    );
  }

  post.content = trimmed;
  await post.save();

  const user = await User.findById(post.userId);
  await refreshApprovalMessage(post, user);

  logger.info(`Edited post ${post._id} (${post.platform}, day ${post.dayIndex})`);

  return post;
}

/**
 * Edits the angle a slot will be written against.
 *
 * Only reachable before the slot is generated. Once posts exist the theme has
 * already been consumed, so changing it would look like it worked while having
 * no effect on anything the user can see — a 409 says so instead.
 *
 * Allowed on a `draft` as well as an `approved` plan: refining an angle before
 * its slot runs is the point, and approval is about enabling generation, not
 * about freezing the copy.
 *
 * @param {object} params
 * @param {string} params.planId - The plan to edit.
 * @param {string} params.userId - The owning user.
 * @param {number} params.dayIndex - Which slot.
 * @param {object} params.patch - `theme` and/or `type`.
 * @returns {Promise<object>} The updated plan.
 * @throws {ApiError} 404 when the plan or slot is missing; 409 when the slot is
 *   already generated.
 * @sideeffect Writes the plan.
 */
export async function updateSlot({ planId, userId, dayIndex, patch }) {
  const plan = await loadOwnedPlan({ planId, userId });

  const slot = plan.days.find((s) => s.dayIndex === dayIndex);
  if (!slot) throw ApiError.notFound(`No slot ${dayIndex} in this plan.`);

  if (slot.status === SLOT_STATUS.GENERATED) {
    throw ApiError.conflict(
      'This slot has already been generated. Regenerate its posts instead of editing the angle.',
    );
  }

  if (patch.theme !== undefined) slot.theme = String(patch.theme).trim();
  if (patch.type !== undefined) slot.type = patch.type;

  // An edit invalidates the last failure — the reason belonged to the previous
  // attempt, and leaving it would report a problem against text that is gone.
  slot.lastSkipReason = null;

  await plan.save();

  logger.info(`Slot ${dayIndex} of plan ${plan._id} edited`);

  return plan;
}

export default {
  createPlan,
  loadOwnedPlan,
  generateSlot,
  generateNextSlot,
  regeneratePost,
  approvePost,
  rejectPost,
  updatePostContent,
  updateSlot,
};
