/**
 * GenerationLog model — an append-only audit trail of every paid AI call.
 *
 * RESPONSIBILITY
 *   Record what was generated, with which model, at what token cost.
 *
 * WHY THIS IS WORTH THE WRITE
 *   PRD §7 requires a spend-cap story, and quotas alone only count calls — they
 *   cannot answer "what is this actually costing per user". This collection
 *   turns that into a single aggregation, and doubles as the evidence table for
 *   the project write-up. One extra insert per generation is cheap next to the
 *   API call it records.
 *
 * WHY FAILURES ARE LOGGED TOO
 *   A row is written for failed calls with an `error` value. Without them, a
 *   provider that is rejecting half your requests looks identical to one that
 *   is working — you would only see the successful half.
 *
 * DOES NOT OWN: enforcing limits (`Usage` and `quotaService`) or retry logic.
 */

import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * The kinds of work that cost money or quota.
 * Kept broad enough to cover Phase 3 without a schema change when it lands.
 */
export const GENERATION_KIND = Object.freeze({
  PLAN: 'plan',
  POST: 'post',
  NEWS: 'news',
  IMAGE: 'image',
});

const generationLogSchema = new Schema(
  {
    /** Owning user. Null for work not tied to an account (e.g. the probe). */
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    /** What kind of generation this was. */
    kind: {
      type: String,
      required: true,
      enum: Object.values(GENERATION_KIND),
    },

    /** The model name actually used, e.g. "gemini-3.5-flash". */
    model: { type: String, default: null },

    /** The provider that served it, e.g. "gemini". */
    provider: { type: String, default: null },

    // ── Token accounting ────────────────────────────────────────────────────
    /** Prompt tokens billed. Null when the provider did not report usage. */
    inputTokens: { type: Number, default: null },
    /** Completion tokens billed. */
    outputTokens: { type: Number, default: null },

    /**
     * Estimated cost in USD.
     *
     * WHY "ESTIMATED": providers change prices without notice, and a stored
     * figure computed from a stale rate card would be quietly wrong. This is a
     * working estimate for trend-spotting, not an invoice.
     */
    estimatedCostUsd: { type: Number, default: null },

    /** Wall-clock duration of the call, for spotting slow models. */
    durationMs: { type: Number, default: null },

    /** Provider request id, for correlating with provider-side logs. */
    requestId: { type: String, default: null },

    /** Populated when the call failed. Success rows leave this null. */
    error: { type: String, default: null },

    /** Free-form context: post id, plan id, quota key consumed. */
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/**
 * Serves the per-user cost report: newest rows first, filtered by user.
 * The `createdAt: -1` sort direction is part of the index so the query is
 * satisfied without an in-memory sort.
 */
generationLogSchema.index({ userId: 1, createdAt: -1 });

/** Serves "show me everything that failed in the last day". */
generationLogSchema.index({ error: 1, createdAt: -1 });

/**
 * Records one AI call.
 *
 * Never throws. A failure to write an audit row must not fail the generation
 * that produced it — logging is observability, not correctness. The error is
 * swallowed and reported through the caller's logger instead.
 *
 * @param {object} entry - The row to write.
 * @param {string} entry.kind - One of `GENERATION_KIND`.
 * @param {string} [entry.userId] - Owning user, when there is one.
 * @param {string} [entry.model] - Model name used.
 * @param {object} [entry.usage] - Provider usage object, if reported.
 * @param {number} [entry.usage.inputTokens] - Prompt tokens.
 * @param {number} [entry.usage.outputTokens] - Completion tokens.
 * @param {number} [entry.durationMs] - Wall-clock duration.
 * @param {Error|string} [entry.error] - Failure, when the call did not succeed.
 * @param {object} [entry.meta] - Extra context.
 * @returns {Promise<object|null>} The saved document, or null if the write failed.
 * @sideeffect Writes to the database.
 */
generationLogSchema.statics.record = async function record({
  kind,
  userId = null,
  model = null,
  provider = null,
  usage = null,
  durationMs = null,
  requestId = null,
  error = null,
  meta = {},
} = {}) {
  try {
    return await this.create({
      kind,
      userId,
      model,
      provider,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      durationMs,
      requestId,
      // Normalise an Error to its message so a row stays queryable text.
      error: error ? String(error.message ?? error).slice(0, 500) : null,
      meta,
    });
  } catch {
    // Deliberately swallowed: see the method note above.
    return null;
  }
};

/**
 * Aggregates spend per user over a time window.
 *
 * This is the query behind the PRD §7 cost table. Grouping in the database
 * rather than in JavaScript keeps it usable as the collection grows.
 *
 * @param {object} [options]
 * @param {Date} [options.since] - Only include rows created at or after this time.
 * @returns {Promise<Array<{userId: string, calls: number, inputTokens: number,
 *   outputTokens: number, estimatedCostUsd: number}>>} One entry per user.
 * @sideeffect none (read-only)
 */
generationLogSchema.statics.costByUser = async function costByUser({ since } = {}) {
  const match = since ? { createdAt: { $gte: since } } : {};

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$userId',
        calls: { $sum: 1 },
        inputTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
        estimatedCostUsd: { $sum: { $ifNull: ['$estimatedCostUsd', 0] } },
        failures: { $sum: { $cond: [{ $ne: ['$error', null] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        userId: { $toString: '$_id' },
        calls: 1,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 1,
        failures: 1,
      },
    },
    { $sort: { estimatedCostUsd: -1 } },
  ]);
};

export const GenerationLog = mongoose.model('GenerationLog', generationLogSchema);
export default GenerationLog;
