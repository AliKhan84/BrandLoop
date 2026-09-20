/**
 * Post model — one generated draft for one platform.
 *
 * RESPONSIBILITY
 *   Persist the text a user is asked to approve, its provenance (which theme
 *   or which news story), and where it sits in the approval lifecycle.
 *
 * WHY BOTH PLATFORMS GET THEIR OWN DOCUMENT
 *   An X draft and a LinkedIn draft for the same slot are different texts with
 *   different lengths and voices, approved independently. One document holding
 *   both would need two copies of every state field and would make "approve"
 *   ambiguous.
 *
 * WHY THE IMAGE FIELDS WERE ADDED BEFORE THEY WERE USED
 *   `needsImage`, `imagePrompt`, `imageUrl` and `imageGeneratedAt` were created
 *   while image generation was still deferred (plan amendment A3), so that
 *   enabling Phase 3 later would be additive rather than a migration. That is
 *   exactly how it landed: `imageGenerator` populates them and no data change
 *   was needed. `imageSkipReason` was added with the feature, to explain a
 *   missing image after a message re-render.
 *
 * DOES NOT OWN: scheduling (that is the slot's job) or delivery to Discord.
 */

import mongoose from 'mongoose';
import {
  PLATFORM,
  POST_STATUS,
  POST_TYPE,
  PUBLISH_METHOD,
} from '../config/constants.js';

const { Schema } = mongoose;

const postSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** The plan this post belongs to. */
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'ContentPlan',
      required: true,
      index: true,
    },

    /**
     * Which posting slot produced this post. Combined with `platform` this
     * identifies the post uniquely within a plan, which is what lets a
     * regenerate create a sibling rather than a duplicate.
     */
    dayIndex: { type: Number, required: true, min: 1 },

    /** Target platform. Determines the character limit and composer link. */
    platform: {
      type: String,
      required: true,
      enum: Object.values(PLATFORM),
    },

    /** Whether the post came from the user's themes or from a news story. */
    type: {
      type: String,
      enum: Object.values(POST_TYPE),
      default: POST_TYPE.PLANNED,
    },

    /** The post body, already fitted to the platform limit. */
    content: { type: String, required: true },

    /**
     * Continuation parts, posted as replies to `content`.
     *
     * Empty for a single post, which is the common case. `content` is always
     * part 1, so everything that reads a post without knowing about threads —
     * the length check, the composer link, the copy button — keeps working
     * unchanged on the root.
     *
     * X only. LinkedIn has 3000 characters and a different continuation
     * mechanic, so it never sets this.
     */
    thread: { type: [String], default: [] },

    /** Hashtags, stored separately so the body length stays meaningful. */
    hashtags: { type: [String], default: [] },

    /** The theme this post was written against, copied from the slot. */
    theme: { type: String, default: '' },

    // ── News provenance ─────────────────────────────────────────────────────
    /**
     * Source URL for a `news` post.
     *
     * ALWAYS taken from the RSS feed, never from the model. That is what makes
     * a fabricated citation structurally impossible rather than merely
     * unlikely — the model has no opportunity to author this field.
     */
    sourceNewsUrl: { type: String, default: null },
    /** Headline of the source story. */
    sourceNewsTitle: { type: String, default: null },
    /** Publisher name, e.g. "The New York Times". Shows in the Discord embed. */
    sourceNewsName: { type: String, default: null },

    // ── Image fields (Phase 3 — inert in this build) ────────────────────────
    /** Whether the model judged this post to warrant an image. */
    needsImage: { type: Boolean, default: false },
    /** The art direction the model proposed, used as the image prompt. */
    imagePrompt: { type: String, default: null },
    /** Public URL of the generated image, once one exists. */
    imageUrl: { type: String, default: null },
    /** When the image was generated. Null when there is none. */
    imageGeneratedAt: { type: Date, default: null },
    /**
     * Why a requested image is missing, when one was wanted but not produced.
     *
     * Null when no image was requested, or when one was generated. Stored
     * rather than merely logged because the approval message is rebuilt from
     * this document every time it is refreshed — a note held only in memory
     * would disappear on the next edit, leaving a draft that asked for an image
     * and shows none with no explanation.
     */
    imageSkipReason: { type: String, default: null },

    // ── Lifecycle ───────────────────────────────────────────────────────────
    /**
     * Current state. The Discord buttons only act on `pending_approval`, which
     * is what makes Approve idempotent against a double click.
     */
    status: {
      type: String,
      enum: Object.values(POST_STATUS),
      default: POST_STATUS.PENDING_APPROVAL,
      index: true,
    },

    /** How the post reaches the platform. `assisted` in this build. */
    publishMethod: {
      type: String,
      enum: Object.values(PUBLISH_METHOD),
      default: PUBLISH_METHOD.ASSISTED,
    },

    /**
     * How many times this post has been rejected and rewritten.
     * Capped by `MAX_REGENERATIONS_PER_POST` so a post the user keeps rejecting
     * cannot spend the quota indefinitely.
     */
    regenerationCount: { type: Number, default: 0, min: 0 },

    /**
     * The post this one replaced, when produced by a regenerate.
     * Kept so a rejection chain is traceable rather than a set of orphans.
     */
    parentPostId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      default: null,
    },

    // ── Delivery ────────────────────────────────────────────────────────────
    /** The Discord message carrying the approval buttons, for in-place edits. */
    discordMessageId: { type: String, default: null },
    /** The DM channel the message was sent to. */
    discordChannelId: { type: String, default: null },
    /** When approval was given. Null until then. */
    publishedAt: { type: Date, default: null },

    // ── Generation metadata ─────────────────────────────────────────────────
    /** Model that produced the text, for the cost report in PRD §7. */
    aiModel: { type: String, default: null },
    /** Wall-clock generation time, for diagnosing slow runs. */
    generationMs: { type: Number, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * Serves the "what still needs approving for this plan" query.
 * Ordered so the oldest slot is listed first, matching generation order.
 */
postSchema.index({ planId: 1, dayIndex: 1, platform: 1 });

/** Serves the API's `GET /api/posts?status=` filter. */
postSchema.index({ userId: 1, status: 1, createdAt: -1 });

/**
 * Reports whether this post can still be actioned from Discord.
 *
 * Guarding on this before acting is what stops a fast double-click from
 * approving twice, and stops an old message from being actioned after the
 * post has already moved on.
 *
 * @returns {boolean} True when the post is awaiting approval.
 * @sideeffect none
 */
postSchema.methods.isActionable = function isActionable() {
  return this.status === POST_STATUS.PENDING_APPROVAL;
};

/**
 * Reports whether this post may be regenerated after a rejection.
 *
 * @param {number} maxRegenerations - The configured cap.
 * @returns {boolean} True when another attempt is allowed.
 * @sideeffect none
 */
postSchema.methods.canRegenerate = function canRegenerate(maxRegenerations) {
  return this.regenerationCount < maxRegenerations;
};

/**
 * The full text that will actually be posted, body plus hashtags.
 *
 * Kept as a method rather than a stored field so `content` and `hashtags`
 * cannot drift out of sync with what the user copies. This is the exact string
 * handed to the composer link and the copy block.
 *
 * @returns {string} Post body with a single trailing hashtag block.
 * @sideeffect none
 */
postSchema.methods.fullText = function fullText() {
  if (!this.hashtags?.length) return this.content;
  return `${this.content}\n\n${this.hashtags.join(' ')}`;
};

/**
 * Every part of the post, in posting order.
 *
 * WHY THIS EXISTS
 *   Threading introduced a second place that can be wrong about "what are the
 *   parts of this post" — and the composer link, the Discord copy blocks and
 *   the length check all need the same answer. Defining it once here means a
 *   renderer cannot show a different set of parts from the one that gets
 *   published.
 *
 * `fullText` is deliberately unchanged: it is the **root only** (plus hashtags),
 * because that is what the composer link can prefill and what a single-post
 * reader expects. A thread's replies are separate messages and are never part
 * of it.
 *
 * @returns {string[]} One entry for a single post; more for a thread. Never empty.
 * @sideeffect none
 */
postSchema.methods.postSegments = function postSegments() {
  const replies = (this.thread ?? []).map((part) => String(part).trim()).filter(Boolean);
  return [this.content, ...replies];
};

/**
 * Whether this post is a thread rather than a single message.
 *
 * @returns {boolean} True when there is at least one continuation part.
 * @sideeffect none
 */
postSchema.methods.isThread = function isThread() {
  return this.postSegments().length > 1;
};

/**
 * The public shape of a post, safe to return from the API.
 *
 * @returns {object} Whitelisted fields plus the composed full text.
 * @sideeffect none
 */
postSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    planId: this.planId.toString(),
    dayIndex: this.dayIndex,
    platform: this.platform,
    type: this.type,
    theme: this.theme,
    content: this.content,
    thread: this.thread ?? [],
    hashtags: this.hashtags,
    fullText: this.fullText(),
    status: this.status,
    publishMethod: this.publishMethod,
    sourceNewsUrl: this.sourceNewsUrl,
    sourceNewsTitle: this.sourceNewsTitle,
    sourceNewsName: this.sourceNewsName,
    // Phase 3 fields are exposed now so the API shape does not change later.
    needsImage: this.needsImage,
    imageUrl: this.imageUrl,
    imageSkipReason: this.imageSkipReason,
    regenerationCount: this.regenerationCount,
    publishedAt: this.publishedAt,
    createdAt: this.createdAt,
  };
};

export const Post = mongoose.model('Post', postSchema);
export default Post;
