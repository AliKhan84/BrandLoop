/**
 * ContentPlan model — a scheduled sequence of posting slots.
 *
 * RESPONSIBILITY
 *   Persist the plan a user approves, and the per-slot state that tells the
 *   scheduler what still needs generating.
 *
 * ## The PRD ambiguity this model resolves
 *
 * PRD §5 defines `days[]` as one entry per **calendar day** (7 or 30 of them),
 * but `User.postFrequency` is **posts per week** (2–4). These contradict: a
 * 7-day plan at 3 posts/week should contain 3 posting slots, not 7 entries.
 *
 * **Resolution adopted here:** `days[]` holds one entry per **posting slot**,
 * not per calendar day. `dayIndex` is the 1-based slot ordinal; `dayOfPlan` is
 * the calendar-day offset the slot falls on, which is what the scheduler uses
 * to decide when a slot is due. `buildPlanSlots` in `services/ai/planGenerator`
 * owns that maths and is unit-tested against it.
 *
 * DOES NOT OWN: the generated posts themselves (see `Post`).
 */

import mongoose from 'mongoose';
import {
  CONTENT_MIX,
  PLAN_STATUS,
  POST_TYPE,
  SLOT_STATUS,
  VALID_PLAN_DURATIONS,
  VALID_POST_FREQUENCIES,
} from '../config/constants.js';

const { Schema } = mongoose;

/**
 * One posting slot inside a plan.
 *
 * Slot status is tracked separately from any `Post` because a slot can hold a
 * rejected post and still count as generated — otherwise a rejected post would
 * cause the slot to be re-generated forever.
 */
const planSlotSchema = new Schema(
  {
    /** 1-based position in the plan. Stable across regenerations. */
    dayIndex: { type: Number, required: true, min: 1 },

    /**
     * Calendar-day offset from the plan start (0-based).
     * The scheduler compares this against elapsed days to decide what is due.
     */
    dayOfPlan: { type: Number, required: true, min: 0 },

    /** The angle this post takes. Authored by the model at plan time. */
    theme: { type: String, default: '' },

    /** Whether the post is from the user's own themes, or current news. */
    type: {
      type: String,
      enum: Object.values(POST_TYPE),
      default: POST_TYPE.PLANNED,
    },

    /** Whether this slot has been generated yet. */
    status: {
      type: String,
      enum: Object.values(SLOT_STATUS),
      default: SLOT_STATUS.PENDING,
    },

    // ── News fields (populated when the slot is generated as type 'news') ────
    /** Headline of the story this slot used, for display in the Discord embed. */
    newsHeadline: { type: String, default: null },
    /** The story's URL. Always taken from the RSS feed — never model-authored. */
    newsUrl: { type: String, default: null },
    /** Publisher name, e.g. "The New York Times". */
    newsSourceName: { type: String, default: null },

    /** When this slot was last generated, for diagnostics and retry logic. */
    generatedAt: { type: Date, default: null },

    /**
     * Why the last generation attempt left this slot incomplete.
     *
     * Set when a platform failed while another succeeded — the case that
     * previously vanished into a toast. Null means the last attempt was clean.
     *
     * WHY STORED RATHER THAN DERIVED: which platforms are missing is derivable
     * from the `Post` collection, but the *reason* is not — nothing else records
     * why an attempt failed. Without it a slot that keeps failing is an
     * unexplained stuck slot, which is indistinguishable from a bug.
     */
    lastSkipReason: { type: String, default: null },
  },
  { _id: false },
);

const contentPlanSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** Plan window in calendar days. 7 or 30 per PRD §5. */
    durationDays: {
      type: Number,
      required: true,
      enum: VALID_PLAN_DURATIONS,
    },

    /**
     * Posts per week the plan was built for, captured at creation time.
     * Snapshotted rather than read from the user on demand, so changing the
     * user's preference later does not retroactively reshape an approved plan.
     */
    postFrequency: {
      type: Number,
      required: true,
      enum: VALID_POST_FREQUENCIES,
    },

    /** Only an `approved` plan is picked up by the scheduler. */
    status: {
      type: String,
      enum: Object.values(PLAN_STATUS),
      default: PLAN_STATUS.DRAFT,
      index: true,
    },

    /** The posting slots. See the module note about the PRD contradiction. */
    days: {
      type: [planSlotSchema],
      default: [],
    },

    /** Human-readable summary shown when the user is asked to approve. */
    summary: { type: String, default: '' },

    /** When the plan starts. Slot offsets are measured from here. */
    startDate: { type: Date, default: () => new Date() },

    /** Derived: startDate + durationDays. Stored for easy range queries. */
    endDate: { type: Date, default: null },

    /** When the user approved it. Null while still a draft. */
    approvedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * Finds the next slot still needing generation.
 *
 * `days` is ordered by construction, but sorting explicitly means a plan edited
 * by hand cannot produce an out-of-order generation sequence.
 *
 * @returns {{dayIndex: number, dayOfPlan: number, theme: string, type: string}|null}
 *   The lowest pending slot, or null when the plan is exhausted.
 * @sideeffect none (pure — operates on the in-memory document)
 */
contentPlanSchema.methods.nextPendingSlot = function nextPendingSlot() {
  const pending = this.days
    .filter((slot) => slot.status === SLOT_STATUS.PENDING)
    .sort((a, b) => a.dayIndex - b.dayIndex);

  return pending[0] ?? null;
};

/**
 * Marks a slot's status by its `dayIndex`.
 *
 * @param {number} dayIndex - The 1-based slot ordinal to update.
 * @param {string} status - One of the `SLOT_STATUS` values.
 * @returns {boolean} True when a matching slot was found and updated.
 * @sideeffect Mutates the in-memory document; caller must `save()`.
 */
contentPlanSchema.methods.setSlotStatus = function setSlotStatus(dayIndex, status) {
  const slot = this.days.find((s) => s.dayIndex === dayIndex);
  if (!slot) return false;

  slot.status = status;
  if (status === SLOT_STATUS.GENERATED) slot.generatedAt = new Date();
  return true;
};

/**
 * Counts slots by status, for progress reporting.
 *
 * @returns {{total: number, pending: number, generated: number, skipped: number}}
 *   Totals across the plan.
 * @sideeffect none (pure)
 */
contentPlanSchema.methods.progress = function progress() {
  const count = (status) => this.days.filter((s) => s.status === status).length;
  return {
    total: this.days.length,
    pending: count(SLOT_STATUS.PENDING),
    generated: count(SLOT_STATUS.GENERATED),
    skipped: count(SLOT_STATUS.SKIPPED),
  };
};

/**
 * The public shape of a plan, safe to return from the API.
 *
 * @returns {object} Whitelisted fields plus computed progress.
 * @sideeffect none
 */
contentPlanSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    durationDays: this.durationDays,
    postFrequency: this.postFrequency,
    status: this.status,
    summary: this.summary,
    startDate: this.startDate,
    endDate: this.endDate,
    approvedAt: this.approvedAt,
    progress: this.progress(),
    days: this.days.map((slot) => ({
      dayIndex: slot.dayIndex,
      dayOfPlan: slot.dayOfPlan,
      theme: slot.theme,
      type: slot.type,
      status: slot.status,
      newsHeadline: slot.newsHeadline,
      newsUrl: slot.newsUrl,
      newsSourceName: slot.newsSourceName,
      lastSkipReason: slot.lastSkipReason,
    })),
    createdAt: this.createdAt,
  };
};

/**
 * Recomputes `endDate` from `startDate` and `durationDays`.
 *
 * Called before save so the stored range always matches the other two fields
 * rather than drifting if one is edited independently.
 *
 * @returns {void}
 * @sideeffect Sets `this.endDate`.
 */
contentPlanSchema.methods.refreshEndDate = function refreshEndDate() {
  const end = new Date(this.startDate);
  end.setUTCDate(end.getUTCDate() + this.durationDays);
  this.endDate = end;
};

/**
 * Number of news slots a plan should contain.
 *
 * Derived from the fixed PRD §4 ratio rather than stored, so it cannot fall out
 * of sync with the slot list.
 *
 * @returns {number} Expected count of `type: 'news'` slots.
 * @sideeffect none (pure)
 */
contentPlanSchema.methods.expectedNewsSlots = function expectedNewsSlots() {
  return Math.floor((this.durationDays / 7) * CONTENT_MIX.NEWS_POSTS_PER_WEEK);
};

export const ContentPlan = mongoose.model('ContentPlan', contentPlanSchema);
export default ContentPlan;
