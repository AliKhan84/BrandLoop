/**
 * Usage logging — writes the `GenerationLog` audit rows.
 *
 * RESPONSIBILITY
 *   Turn the result of an AI call into a persisted record of what was spent.
 *
 * WHY THIS IS A SEPARATE MODULE
 *   Every generator needs to log, and none of them should care how. Centralising
 *   it means the cost-report shape is defined in exactly one place, and a
 *   generator cannot forget to log by simply not thinking about it — the
 *   wrapper below is a single call at the end of each generation.
 *
 * WHY A FAILED LOG NEVER THROWS
 *   Observability must not be able to break the thing it observes. A failure to
 *   write an audit row is reported to the console and then ignored, because the
 *   user's post has already been generated and losing it over a logging error
 *   would be a strictly worse outcome.
 *
 * DOES NOT OWN: enforcing limits (`quotaService`) or the counters those limits
 * read from (`Usage`).
 */

import { GenerationLog, GENERATION_KIND } from '../models/GenerationLog.js';
import { getProviderName } from './ai/index.js';
import { logger } from '../utils/logger.js';

/**
 * Approximate USD price per one million tokens, by model.
 *
 * WHY THESE ARE ESTIMATES: providers change prices without notice and a stored
 * figure computed from a stale rate card is quietly wrong. These exist to make
 * the *relative* cost of models visible in the PRD §7 report — which model
 * dominates spend — rather than to produce an invoice. An unknown model records
 * `null` rather than guessing, so a gap is visible instead of invented.
 *
 * Update these when a provider's pricing changes; nothing else needs to move.
 */
const RATE_CARD = Object.freeze({
  'gemini-3.5-flash': { input: 0.30, output: 2.50 },
  'gemini-3.6-flash': { input: 0.30, output: 2.50 },
  'gemini-3.1-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-3.5-flash-lite': { input: 0.10, output: 0.40 },
  // Image models bill per token like any other, and the output tokens *are* the
  // image (measured on gpt-image-1: 31 input tokens against 1,056 output for
  // one 1024x1024 medium image). Input tokens can be priced differently by type
  // — text vs image — which this two-rate shape cannot express, so the estimate
  // is deliberately approximate. gpt-image-1 has since left the provider's
  // pricing page, so re-check the figure before relying on it; the point of
  // this entry is to show that images dominate spend, not to bill anyone.
  'gpt-image-1': { input: 5, output: 40 },
});

/**
 * Estimates the cost of one call in USD.
 *
 * @param {object} params
 * @param {string} params.model - The model id used.
 * @param {number|null} [params.inputTokens] - Prompt tokens billed.
 * @param {number|null} [params.outputTokens] - Completion tokens billed.
 * @returns {number|null} Estimated USD, or null when the model has no rate.
 * @sideeffect none (pure)
 */
export function estimateCostUsd({ model, inputTokens, outputTokens }) {
  const rates = RATE_CARD[model];
  if (!rates) return null;

  // Providers report tokens as null when they omit the usage block; treating
  // that as zero would understate cost, so it is surfaced as "unknown" instead.
  if (inputTokens === null || inputTokens === undefined) return null;
  if (outputTokens === null || outputTokens === undefined) return null;

  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

/**
 * Records one AI call, successful or not.
 *
 * Typical use, wrapping a provider call:
 *
 *   const started = Date.now();
 *   let result, error;
 *   try {
 *     result = await generateStructured({ ... });
 *   } catch (err) {
 *     error = err;
 *     throw err;                       // rethrown AFTER logging below
 *   } finally {
 *     await logGeneration({ kind, userId, result, error, durationMs: Date.now() - started });
 *   }
 *
 * Never throws. See the module note on why.
 *
 * @param {object} params
 * @param {string} params.kind - One of `GENERATION_KIND`.
 * @param {string|import('mongoose').Types.ObjectId} [params.userId] - Owning user.
 * @param {object} [params.result] - A successful provider result, carrying
 *   `{ model, usage: { inputTokens, outputTokens } }`.
 * @param {Error} [params.error] - The failure, when the call did not succeed.
 * @param {number} [params.durationMs] - Wall-clock duration, if not in `result`.
 * @param {string} [params.requestId] - Provider request id, when available.
 * @param {object} [params.meta] - Extra context, e.g. `{ planId, dayIndex }`.
 * @returns {Promise<object|null>} The saved row, or null when the write failed.
 * @sideeffect Writes to the database.
 */
export async function logGeneration({
  kind,
  userId = null,
  result = null,
  error = null,
  durationMs = null,
  requestId = null,
  meta = {},
} = {}) {
  if (!Object.values(GENERATION_KIND).includes(kind)) {
    logger.warn(`usageLogger: unknown kind "${kind}" — row not written`);
    return null;
  }

  // Resolve the provider name defensively: this runs on the error path too,
  // where a provider-loading failure should not mask the original error.
  let provider = null;
  try {
    provider = await getProviderName();
  } catch {
    provider = null;
  }

  const model = result?.model ?? meta.model ?? null;
  const inputTokens = result?.usage?.inputTokens ?? null;
  const outputTokens = result?.usage?.outputTokens ?? null;

  return GenerationLog.record({
    kind,
    userId,
    model,
    provider,
    usage: { inputTokens, outputTokens },
    estimatedCostUsd: error ? null : estimateCostUsd({ model, inputTokens, outputTokens }),
    durationMs: durationMs ?? result?.durationMs ?? null,
    requestId,
    error,
    meta,
  });
}

/**
 * Produces the per-user spend report.
 *
 * This is the query behind PRD §7's cost table — the evidence that quotas are
 * actually controlling spend rather than merely existing.
 *
 * @param {object} [options]
 * @param {number} [options.days=7] - How far back to look.
 * @returns {Promise<object[]>} One row per user, most expensive first.
 * @sideeffect none (read-only)
 */
export async function getCostReport({ days = 7 } = {}) {
  const since = new Date(Date.now() - days * 86_400_000);
  return GenerationLog.costByUser({ since });
}

export { GENERATION_KIND };
export default { logGeneration, getCostReport, estimateCostUsd, GENERATION_KIND };
