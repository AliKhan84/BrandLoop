/**
 * Gemini provider — the active AI implementation.
 *
 * RESPONSIBILITY
 *   Implement the provider interface (`generateStructured`, `generateText`,
 *   `generateImage`, `describeModel`, `describeImageModel`) against Google's
 *   `@google/genai` SDK.
 *
 * WHY GEMINI RATHER THAN OPENAI
 *   The available key is a Gemini key. Gemini's structured-output support was
 *   verified live before this file was written: a nested object schema with an
 *   array of objects returns valid JSON in 2.5–5.5s. See the plan's amendment
 *   A1 for the full reasoning and the measured timings.
 *
 * WHY RETRY IS SELECTIVE
 *   429 and 5xx are transient and worth retrying. A `SAFETY` finish reason is
 *   deterministic — the same prompt will be refused every time — so retrying it
 *   burns quota for the same refusal and delays the user's error by 30 seconds.
 *   The distinction is the whole point of this wrapper.
 *
 * DOES NOT OWN: prompt construction (each generator owns its own), or quota
 * enforcement (that happens before this layer is called).
 */

import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AI_REQUEST_TIMEOUT_MS } from '../../config/constants.js';

/**
 * Finish reasons that mean the model deliberately refused.
 *
 * These are never retried: the input is the problem, not the network. A retry
 * would produce the same refusal and consume another unit of quota.
 */
const TERMINAL_FINISH_REASONS = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'RECITATION',
  'IMAGE_SAFETY',
  'BLOCKLIST',
  'SPII',
  'MALFORMED_FUNCTION_CALL',
]);

/** HTTP statuses worth another attempt. 408 is included because a timeout is
 *  transient — the free tier's latency ranges from 3s to over 90s for the same
 *  request, so a slow response is expected and retrying is the right response. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/** Total attempts, including the first. */
const MAX_ATTEMPTS = 4;

/** Base delay for exponential backoff, in milliseconds. */
const BASE_BACKOFF_MS = 1200;

/**
 * One shared client for the process.
 *
 * Reused rather than constructed per call so the underlying HTTP agent and its
 * connection pool survive between requests — noticeable on the scheduler, which
 * makes several calls in sequence.
 */
const client = new GoogleGenAI({ apiKey: env.AI_API_KEY });

/**
 * Extracts an HTTP status code from an SDK error.
 *
 * ## Why `error.code` cannot be trusted blindly
 *
 * The `code` property is overloaded. On an API error it is the HTTP status; on
 * a transport error it is a DOMException constant, where `20` means `ABORT_ERR`.
 * Reading that as a status made a request timeout look like an unknown 4xx that
 * failed immediately — so a slow free-tier response was never retried, and a
 * perfectly good generation was thrown away. That is the bug this guards
 * against: every value is range-checked before being treated as a status.
 *
 * Returning `0` for anything unrecognised means "not retryable", which is the
 * safe default — retrying a genuinely malformed request only wastes time.
 *
 * @param {unknown} error - The thrown value.
 * @returns {number} An HTTP status, or 0 when none could be determined.
 * @sideeffect none (pure)
 */
function statusOf(error) {
  if (!error || typeof error !== 'object') return 0;

  // An aborted request is semantically a 408. Mapping it here rather than
  // special-casing it in the retry check keeps that decision in one place.
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 408;

  // The SDK's own API error exposes the real HTTP status here.
  const direct = error.status ?? error.response?.status;
  if (typeof direct === 'number' && direct >= 100 && direct <= 599) return direct;

  // Only a value that could actually be an HTTP status is treated as one.
  if (typeof error.code === 'number' && error.code >= 100 && error.code <= 599) {
    return error.code;
  }

  return 0;
}

/**
 * Reports whether an error is worth retrying.
 *
 * @param {unknown} error - The thrown value.
 * @returns {boolean} True for 429 and 5xx responses only.
 * @sideeffect none (pure)
 */
function isRetryable(error) {
  return RETRYABLE_STATUSES.has(statusOf(error));
}

/**
 * Parses the SDK's error message when it carries a JSON response body.
 *
 * WHY THIS IS NECESSARY: the SDK's `ApiError` exposes only `name` and `status`
 * as own properties — `details` and `error` are both `undefined`. The response
 * body, quota violations included, is stuffed into `message` as a JSON string.
 * Verified by inspecting the object directly.
 *
 * @param {unknown} message - The error's message.
 * @returns {object|null} The parsed body, or null when it is not JSON.
 * @sideeffect none (pure)
 */
function parseJsonMessage(message) {
  if (typeof message !== 'string' || !message.startsWith('{')) return null;
  try {
    return JSON.parse(message);
  } catch {
    // A truncated or non-JSON message is not an error worth surfacing — the
    // caller simply falls through to the next detection strategy.
    return null;
  }
}

/**
 * Extracts the quota violation from a Gemini 429, when there is one.
 *
 * The API reports quota failures as a `QuotaFailure` entry naming the exact
 * quota that ran out. That name is what distinguishes a temporary rate limit
 * from a daily allowance that will not recover until tomorrow — a distinction
 * the status code cannot make, because both arrive as 429.
 *
 * Three strategies, in order of precision:
 *   1. Structured access, in case a future SDK release exposes the body.
 *   2. Parse `message` as JSON and read the violations from it — this is the
 *      one that actually fires against the current SDK.
 *   3. A regex over the raw message text, so a further change in body shape
 *      degrades to a slightly less detailed answer rather than missing the
 *      failure entirely.
 *
 * @param {unknown} error - The thrown value.
 * @returns {{quotaId: string, quotaValue: string|null}|null} The violation, or
 *   null when the error is not a quota failure.
 * @sideeffect none (pure)
 */
function quotaFailureOf(error) {
  const parsed = parseJsonMessage(error?.message);

  const containers = [
    error?.details,
    error?.error?.details,
    parsed?.error?.details,
    parsed?.details,
  ];

  for (const container of containers) {
    if (!Array.isArray(container)) continue;

    for (const detail of container) {
      for (const violation of detail?.violations ?? []) {
        if (typeof violation?.quotaId === 'string') {
          return {
            quotaId: violation.quotaId,
            quotaValue: violation.quotaValue ?? null,
          };
        }
      }
    }
  }

  // Last resort. The two fields are matched separately because `quotaValue`
  // sits after a `quotaDimensions` object that itself contains braces, so a
  // single pattern spanning both would be fragile.
  const text = String(error?.message ?? '');
  const idMatch = text.match(/"quotaId"\s*:\s*"([^"]+)"/);
  if (idMatch) {
    const valueMatch = text.match(/"quotaValue"\s*:\s*"([^"]+)"/);
    return { quotaId: idMatch[1], quotaValue: valueMatch?.[1] ?? null };
  }

  return null;
}

/**
 * Reports whether a 429 is a per-day allowance rather than a short-term burst limit.
 *
 * WHY THIS DECISION MATTERS: the free tier allows **20 requests per day per
 * model**. Retrying that four times with backoff spends nine seconds and then
 * fails anyway, and — worse — it hides the real cause behind a generic
 * "request failed" message. Detecting it lets the caller fail immediately with
 * something the operator can act on.
 *
 * Google names daily quotas `...PerDay...`, so the id is the reliable signal.
 *
 * @param {unknown} error - The thrown value.
 * @returns {boolean} True when a daily allowance is exhausted.
 * @sideeffect none (pure)
 */
function isDailyQuotaExhausted(error) {
  return Boolean(quotaFailureOf(error)?.quotaId?.includes('PerDay'));
}

/**
 * Reads the failure detail out of a Gemini response.
 *
 * A response with no usable text is a failure even when the HTTP call
 * succeeded — an empty candidate or a MAX_TOKENS stop both need a clear error
 * rather than a confusing `undefined` three layers up.
 *
 * @param {object} response - The raw SDK response.
 * @returns {{ok: true, text: string} | {ok: false, reason: string, finishReason: string|null}}
 *   Either the extracted text, or why there is none.
 * @sideeffect none (pure)
 */
function extractText(response) {
  const candidate = response?.candidates?.[0];
  const finishReason = candidate?.finishReason ?? null;

  // A prompt-level block means nothing was generated at all.
  if (response?.promptFeedback?.blockReason) {
    return { ok: false, reason: 'prompt_blocked', finishReason: response.promptFeedback.blockReason };
  }

  if (finishReason && TERMINAL_FINISH_REASONS.has(finishReason)) {
    return { ok: false, reason: 'content_blocked', finishReason };
  }

  // Concatenate every text part — a response may be split across several.
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();

  if (!text) {
    return { ok: false, reason: 'empty_response', finishReason };
  }

  return { ok: true, text };
}

/**
 * Calls Gemini, retrying transient failures with exponential backoff.
 *
 * @param {object} params
 * @param {string} params.model - Model id, e.g. `"gemini-3.5-flash"`.
 * @param {object} params.config - The SDK `config` object for this request.
 * @param {string} params.contents - The user-facing prompt.
 * @param {string} [params.label='gemini'] - Call name used in log lines.
 * @returns {Promise<{response: object, attempts: number}>} The SDK response and
 *   how many attempts it took (useful for spotting a provider degrading).
 * @throws {import('../../utils/ApiError.js').ApiError} On a terminal failure.
 * @sideeffect Makes a network request; may sleep between attempts.
 */
async function callWithRetry({
  model,
  config,
  contents,
  label = 'gemini',
  // Callers that already know the call cannot succeed — the probe testing a
  // model with no quota, for instance — pass 1 to skip pointless backoff.
  maxAttempts = MAX_ATTEMPTS,
}) {
  let lastError;
  let lastBlock;
  // Set when a per-day allowance is hit. Retrying cannot help, so the loop
  // stops and this is reported as an actionable error instead.
  let dailyQuotaHit = null;
  // Tracked so a failure reports what actually happened rather than the
  // configured cap — a non-retryable error breaks out on the first attempt.
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attemptsMade = attempt;
    try {
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          ...config,
          // A generation can legitimately take a while, but not forever. The
          // timeout keeps a hung request from stalling the whole scheduler run.
          httpOptions: { timeout: AI_REQUEST_TIMEOUT_MS },
        },
      });

      const extracted = extractText(response);

      if (extracted.ok) {
        return { response, text: extracted.text, attempts: attempt };
      }

      // A refusal is deterministic — record it and stop immediately.
      if (extracted.reason === 'content_blocked' || extracted.reason === 'prompt_blocked') {
        lastBlock = extracted;
        logger.warn(
          `${label}: refused by ${extracted.finishReason} — not retrying (deterministic)`,
          { model },
        );
        break;
      }

      // Empty response with a clean finish is odd but not a block; retry once
      // more by treating it as transient.
      lastError = new Error(`Empty response from ${model} (finishReason=${extracted.finishReason ?? 'none'})`);
    } catch (err) {
      lastError = err;

      // Checked before the generic retryable test: a daily allowance presents
      // as a 429 but will not recover by waiting, so retrying it only delays
      // the error by ~9 seconds of backoff and buries the real cause.
      if (isDailyQuotaExhausted(err)) {
        dailyQuotaHit = quotaFailureOf(err);
        logger.error(
          `${label}: daily quota exhausted for ${model} ` +
            `(${dailyQuotaHit.quotaId}, limit ${dailyQuotaHit.quotaValue ?? '?'}) — not retrying`,
        );
        break;
      }

      if (!isRetryable(err)) {
        logger.error(`${label}: non-retryable failure (status ${statusOf(err)})`, err);
        break;
      }
    }

    if (attempt === maxAttempts) break;

    const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    logger.warn(`${label}: attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  // A block is reported distinctly so callers can show the user a sensible
  // message rather than a generic "generation failed".
  const { ApiError } = await import('../../utils/ApiError.js');

  // A spent daily allowance is an operator problem with a specific fix, so it
  // gets its own message rather than the generic upstream failure.
  if (dailyQuotaHit) {
    throw new ApiError(
      429,
      `The free-tier daily limit for ${model} is used up ` +
        `(${dailyQuotaHit.quotaValue ?? '?'} requests/day, ${dailyQuotaHit.quotaId}). ` +
        'This resets at midnight Pacific. To continue now, point TEXT_MODEL or ' +
        'CHEAP_MODEL at a different model — each has its own daily allowance — ' +
        'or use a paid API key.',
      { details: { model, quotaId: dailyQuotaHit.quotaId, limit: dailyQuotaHit.quotaValue } },
    );
  }

  if (lastBlock) {
    throw new ApiError(422, 'The model declined to generate this content.', {
      details: { finishReason: lastBlock.finishReason },
    });
  }

  throw ApiError.upstream(
    `Gemini request failed after ${attemptsMade} of ${maxAttempts} attempts`,
    lastError,
  );
}

/**
 * Generates a response constrained to a JSON schema.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Role and rules for the model.
 * @param {string} params.userPrompt - The task and its inputs.
 * @param {object} params.schema - An OpenAPI-subset schema from `schemas.js`.
 * @param {string} [params.model] - Model id; defaults to `env.TEXT_MODEL`.
 * @param {string} [params.label='generateStructured'] - Name used in logs.
 * @returns {Promise<{data: object, model: string, usage: object, durationMs: number}>}
 *   The parsed object plus metadata for `GenerationLog`.
 * @throws {import('../../utils/ApiError.js').ApiError} When the call fails, or
 *   when the response is not valid JSON.
 * @sideeffect Makes a network request.
 */
export async function generateStructured({
  systemPrompt,
  userPrompt,
  schema,
  model = env.TEXT_MODEL,
  label = 'generateStructured',
  maxAttempts = MAX_ATTEMPTS,
}) {
  const startedAt = Date.now();

  const { response, text } = await callWithRetry({
    model,
    label,
    contents: userPrompt,
    maxAttempts,
    config: {
      systemInstruction: systemPrompt,
      // Both are required: the MIME type switches the model into JSON mode,
      // and the schema constrains what it may emit within that mode.
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // Happens when the model emits prose around the JSON despite JSON mode.
    // Reported rather than silently repaired, so a recurring case is visible.
    throw new (await import('../../utils/ApiError.js')).ApiError(
      502,
      'The model returned malformed JSON.',
      { details: { preview: text.slice(0, 200) } },
    );
  }

  return {
    data,
    model,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

/**
 * Generates free-form text with no schema constraint.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Role and rules for the model.
 * @param {string} params.userPrompt - The task and its inputs.
 * @param {string} [params.model] - Model id; defaults to `env.TEXT_MODEL`.
 * @param {number} [params.temperature] - Optional sampling temperature.
 * @param {string} [params.label='generateText'] - Name used in logs.
 * @returns {Promise<{text: string, model: string, usage: object, durationMs: number}>}
 *   The text plus metadata for `GenerationLog`.
 * @throws {import('../../utils/ApiError.js').ApiError} When the call fails.
 * @sideeffect Makes a network request.
 */
export async function generateText({
  systemPrompt,
  userPrompt,
  model = env.TEXT_MODEL,
  temperature,
  label = 'generateText',
}) {
  const startedAt = Date.now();

  const { response, text } = await callWithRetry({
    model,
    label,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      ...(temperature === undefined ? {} : { temperature }),
    },
  });

  return {
    text,
    model,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}

/**
 * Generates one image and returns its bytes.
 *
 * ## Why this is not routed through `callWithRetry`
 *
 * `callWithRetry` reads a text part out of the response, and an image response
 * has none — an image would look like an empty response and be retried four
 * times before failing. It also has no retry to offer that is worth having: an
 * image call is the most expensive request in the pipeline, and a refusal or a
 * bad model name is deterministic. The caller degrades the post to text-only
 * instead.
 *
 * ## The shared `size` parameter is unused here
 *
 * `IMAGE_SIZES` exists because OpenAI accepts explicit dimensions. This
 * provider's image models return their own resolution and reject a `size`, so
 * the parameter is accepted by the interface and deliberately not sent.
 *
 * **Not exercised on this key**: the Gemini key has zero image quota
 * (`429 limit: 0` on every image model — the reason Phase 3 was originally
 * deferred). The OpenAI implementation is the one verified live; this branch is
 * written so an `AI_PROVIDER=gemini` switch does not silently lose images.
 *
 * @param {object} params
 * @param {string} params.prompt - The full image prompt.
 * @param {string} [params.model] - Model id; defaults to `env.IMAGE_MODEL`.
 * @param {string} [params.label='generateImage'] - Name used in logs.
 * @returns {Promise<{buffer: Buffer, mimeType: string, model: string,
 *   usage: object, durationMs: number, requestId: null}>} The image bytes.
 * @throws {ApiError} When the call fails or returns no image bytes.
 * @sideeffect Makes a network request.
 */
export async function generateImage({ prompt, model = env.IMAGE_MODEL, label = 'generateImage' }) {
  const startedAt = Date.now();

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      httpOptions: { timeout: AI_REQUEST_TIMEOUT_MS },
    },
  });

  const candidate = response?.candidates?.[0];
  const imagePart = (candidate?.content?.parts ?? []).find((part) => part?.inlineData?.data);

  if (!imagePart) {
    const { ApiError } = await import('../../utils/ApiError.js');

    const finishReason = candidate?.finishReason ?? response?.promptFeedback?.blockReason ?? null;

    if (finishReason) {
      // Set to the same `code` OpenAI uses for a refusal so
      // `imageGenerator.classifyImageError` matches one vocabulary rather than
      // needing a branch per provider. The finish reason itself is carried in
      // the message, which is what gets logged.
      const refusal = new Error(`The image model declined this prompt (${finishReason}).`);
      refusal.code = 'moderation_blocked';

      logger.warn(`${label}: refused by ${finishReason} — not retrying (deterministic)`, { model });
      throw refusal;
    }

    throw ApiError.upstream(`Empty image response from ${model}`);
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType ?? 'image/png',
    model,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
    },
    requestId: null,
  };
}

/**
 * Checks whether a model id is callable with the configured key.
 *
 * Used by `scripts/probe.js` so a bad model name surfaces at setup rather than
 * halfway through a scheduled run. Deliberately makes a real call — listing
 * models would not prove the key is authorised for it.
 *
 * @param {string} model - The model id to test.
 * @param {object} [options]
 * @param {string} [options.schema] - Schema to use; a trivial one by default.
 * @returns {Promise<{ok: boolean, model: string, reason?: string}>} The result.
 * @sideeffect Makes a network request.
 */
export async function describeModel(model, { schema, maxAttempts = 1 } = {}) {
  const probeSchema = schema ?? {
    type: 'object',
    properties: { ok: { type: 'boolean', description: 'Always true.' } },
    required: ['ok'],
  };

  try {
    await generateStructured({
      systemPrompt: 'You are a health check. Respond only with the requested JSON.',
      userPrompt: 'Return {"ok": true}.',
      schema: probeSchema,
      model,
      label: `probe:${model}`,
      // Single attempt: a bad model name or an exhausted quota is deterministic,
      // and four backoff rounds would add ~9s per model per probe run.
      maxAttempts,
    });
    return { ok: true, model };
  } catch (err) {
    return { ok: false, model, reason: err?.message ?? String(err) };
  }
}

/** Identifies this provider in `GenerationLog` rows. */
export const providerName = 'gemini';

/**
 * Checks whether an image model is usable with the configured key.
 *
 * ## Why this cannot reuse `describeModel`
 *
 * `describeModel` calls `generateContent` with a `responseSchema`. Image models
 * on this provider do not answer that shape, so probing one that way reports a
 * failure for a model that may be perfectly usable — and, worse, reports it
 * with a confident-looking reason that has nothing to do with the real cause.
 * Gem is the wrong instrument.
 *
 * ## What this proves, and what it does not
 *
 * A model-lookup confirms the key can see the model and costs nothing. It does
 * **not** prove generation works — `gemini-2.5-flash` was listed and returned
 * 404, which is the lesson that produced the probe's whole design. So the note
 * says "visible" rather than "working", and when Phase 3 is built the real
 * `generateImage` path becomes the proof.
 *
 * @param {string} model - The image model id to check.
 * @returns {Promise<{ok: boolean, model: string, note?: string, reason?: string}>}
 *   Whether the model is visible to this key.
 * @sideeffect Makes a network request. Generates nothing.
 */
export async function describeImageModel(model) {
  try {
    const found = await client.models.get({ model });
    return {
      ok: true,
      model,
      note: `visible to this key (${found?.name ?? model}) — generation not exercised`,
    };
  } catch (err) {
    return {
      ok: false,
      model,
      reason: String(err?.message ?? err).split('\n')[0].slice(0, 160),
    };
  }
}

export default {
  generateStructured,
  generateText,
  generateImage,
  describeModel,
  describeImageModel,
  providerName,
};
