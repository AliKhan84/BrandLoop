/**
 * OpenAI provider — the deferred swap target.
 *
 * ## STATUS: implemented against current documentation, NOT yet verified
 *
 * There is no OpenAI key on this machine, so this file has never been executed.
 * It is written now so the switch is a config change rather than a rewrite, and
 * it is deliberately kept to the same three functions as the Gemini provider.
 *
 * **Before switching `AI_PROVIDER=openai`, run `npm run probe`.** The probe
 * calls `describeModel` against the real API, which is what validates this
 * file. Do not assume it works because it looks plausible — that is exactly the
 * failure mode this note exists to prevent.
 *
 * ## Shape differences from Gemini (why this is not a copy-paste)
 *
 * | Concern        | Gemini                          | OpenAI                              |
 * |----------------|---------------------------------|-------------------------------------|
 * | Structured out | `responseSchema` (OpenAPI subset)| `text.format.json_schema` (full)   |
 * | System prompt  | `systemInstruction`             | `instructions`                      |
 * | Retry signal   | 429 / 5xx                       | 429 / 5xx, plus `insufficient_quota`|
 * | Safety refusal | `finishReason` on the candidate | `refusal` on the message content    |
 *
 * OpenAI accepts full JSON Schema, so it would tolerate a Zod-generated schema —
 * but this file consumes the same hand-written schemas as Gemini, which is what
 * keeps the two implementations interchangeable.
 *
 * DOES NOT OWN: prompt construction or quota enforcement.
 */

import OpenAI from 'openai';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { AI_REQUEST_TIMEOUT_MS } from '../../config/constants.js';

/**
 * Rewrites a shared schema into what OpenAI's strict structured output demands.
 *
 * ## The incompatibility this resolves
 *
 * `schemas.js` is written for Gemini's OpenAPI subset, which **rejects**
 * `additionalProperties`. OpenAI's `strict: true` mode **requires** it, and
 * requires it on *every* object at *every* depth — not just the root:
 *
 *   400 Invalid schema for response_format 'brandloop_output':
 *   In context=(), 'additionalProperties' is required to be supplied and to be false.
 *
 * So the same schema cannot be sent verbatim to both. Rather than fork the
 * schemas and maintain two near-identical copies that drift, the shared
 * definition stays provider-neutral and each provider adapts it on the way out.
 * The requirement belongs to the provider, so the transformation lives here.
 *
 * Recursion is the point: OpenAI validates nested objects too, which is why
 * adding the key at the top level is not enough. `items` is descended into as
 * well, since our schemas nest objects inside arrays.
 *
 * @param {unknown} schema - A JSON Schema fragment from `schemas.js`.
 * @returns {unknown} A structurally identical schema with `additionalProperties: false`
 *   on every object.
 * @sideeffect none (pure — returns a new tree, never mutates the input)
 */
function toStrictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'items') {
      // Array element definitions can themselves be objects.
      out.items = toStrictSchema(value);
    } else if (key === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, toStrictSchema(sub)]),
      );
    } else {
      out[key] = value;
    }
  }

  if (out.type === 'object') out.additionalProperties = false;

  return out;
}

/** HTTP statuses worth another attempt. */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

/** Total attempts, including the first. */
const MAX_ATTEMPTS = 4;

/** Base delay for exponential backoff, in milliseconds. */
const BASE_BACKOFF_MS = 1200;

/** One shared client for the process. */
const client = new OpenAI({ apiKey: env.AI_API_KEY });

/**
 * Extracts an HTTP status code from an SDK error.
 *
 * @param {unknown} error - The thrown value.
 * @returns {number} The status code, or 0 when unknown.
 * @sideeffect none (pure)
 */
function statusOf(error) {
  return error?.status ?? error?.response?.status ?? 0;
}

/**
 * Reports whether an error is worth retrying.
 *
 * `insufficient_quota` arrives as a 429 but is not transient — the account is
 * out of credit and every retry will fail the same way. It is therefore
 * excluded explicitly, since retrying it only delays the real error.
 *
 * @param {unknown} error - The thrown value.
 * @returns {boolean} True when another attempt could plausibly succeed.
 * @sideeffect none (pure)
 */
function isRetryable(error) {
  if (error?.code === 'insufficient_quota') return false;
  return RETRYABLE_STATUSES.has(statusOf(error));
}

/**
 * Calls the Responses API, retrying transient failures.
 *
 * @param {object} params
 * @param {object} params.body - The request body for `responses.create`.
 * @param {string} params.label - Call name used in log lines.
 * @returns {Promise<{response: object, attempts: number}>} The SDK response.
 * @throws {Error} On a terminal failure.
 * @sideeffect Makes a network request; may sleep between attempts.
 */
async function callWithRetry({ body, label }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await client.responses.create(body, {
        timeout: AI_REQUEST_TIMEOUT_MS,
      });
      return { response, attempts: attempt };
    } catch (err) {
      lastError = err;

      if (!isRetryable(err)) {
        logger.error(`${label}: non-retryable failure (status ${statusOf(err)})`, err);
        break;
      }

      if (attempt === MAX_ATTEMPTS) break;

      const delay = BASE_BACKOFF_MS * 2 ** (attempt - 1);
      logger.warn(`${label}: attempt ${attempt}/${MAX_ATTEMPTS} failed, retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Generates a response constrained to a JSON schema.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Role and rules for the model.
 * @param {string} params.userPrompt - The task and its inputs.
 * @param {object} params.schema - A JSON Schema object.
 * @param {string} [params.model] - Model id; defaults to `env.TEXT_MODEL`.
 * @param {string} [params.label='generateStructured'] - Name used in logs.
 * @returns {Promise<{data: object, model: string, usage: object, durationMs: number}>}
 * @throws {import('../../utils/ApiError.js').ApiError} On failure or bad JSON.
 * @sideeffect Makes a network request.
 */
export async function generateStructured({
  systemPrompt,
  userPrompt,
  schema,
  model = env.TEXT_MODEL,
  label = 'generateStructured',
}) {
  const startedAt = Date.now();

  const { response } = await callWithRetry({
    label,
    body: {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      text: {
        format: {
          type: 'json_schema',
          name: 'brandloop_output',
          // Adapted rather than passed through — strict mode requires
          // `additionalProperties: false` at every level, which the shared
          // schema cannot carry because Gemini rejects it. See `toStrictSchema`.
          schema: toStrictSchema(schema),
          // Without strict mode the model may omit required fields, which
          // would surface as an undefined property deep in a generator.
          strict: true,
        },
      },
    },
  });

  // A refusal arrives as a normal response with no output text, so it has to
  // be checked before parsing rather than caught as an exception.
  const refusal = response.output?.find((item) => item.type === 'message')?.content
    ?.find((part) => part.type === 'refusal');
  if (refusal) {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw new ApiError(422, 'The model declined to generate this content.', {
      details: { refusal: refusal.refusal },
    });
  }

  const text = response.output_text;

  if (!text) {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw ApiError.upstream(`Empty response from ${model}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw new ApiError(502, 'The model returned malformed JSON.', {
      details: { preview: text.slice(0, 200) },
    });
  }

  return {
    data,
    model,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    },
  };
}

/**
 * Generates free-form text.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - Role and rules for the model.
 * @param {string} params.userPrompt - The task and its inputs.
 * @param {string} [params.model] - Model id; defaults to `env.TEXT_MODEL`.
 * @param {number} [params.temperature] - Optional sampling temperature.
 * @param {string} [params.label='generateText'] - Name used in logs.
 * @returns {Promise<{text: string, model: string, usage: object, durationMs: number}>}
 * @throws {import('../../utils/ApiError.js').ApiError} On failure.
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

  const { response } = await callWithRetry({
    label,
    body: {
      model,
      instructions: systemPrompt,
      input: userPrompt,
      ...(temperature === undefined ? {} : { temperature }),
    },
  });

  const text = response.output_text;
  if (!text) {
    const { ApiError } = await import('../../utils/ApiError.js');
    throw ApiError.upstream(`Empty response from ${model}`);
  }

  return {
    text,
    model,
    durationMs: Date.now() - startedAt,
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    },
  };
}

/**
 * Checks whether a model id is callable with the configured key.
 *
 * @param {string} model - The model id to test.
 * @returns {Promise<{ok: boolean, model: string, reason?: string}>} The result.
 * @sideeffect Makes a network request.
 */
export async function describeModel(model) {
  try {
    await generateStructured({
      systemPrompt: 'You are a health check. Respond only with the requested JSON.',
      userPrompt: 'Return {"ok": true}.',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      model,
      label: `probe:${model}`,
    });
    return { ok: true, model };
  } catch (err) {
    return { ok: false, model, reason: err?.message ?? String(err) };
  }
}

/** Identifies this provider in `GenerationLog` rows. */
export const providerName = 'openai';

/**
 * Checks whether an image model is usable with the configured key.
 *
 * ## Why this is a separate function from `describeModel`
 *
 * Image models do **not** support the Responses API. Passing one to
 * `describeModel` returns:
 *
 *   `400 The requested model 'gpt-image-1' is not supported with the
 *    Responses API.`
 *
 * That is a 400, so the probe reported it as a failure and the run looked like
 * the model was unavailable — when in fact `images.generate` works fine with
 * it. Testing a model through the wrong endpoint produces a confident wrong
 * answer, which is worse than not testing it.
 *
 * ## What this does and does not prove
 *
 * `models.retrieve` confirms the key can see the model, and costs nothing. It
 * does **not** prove generation will succeed — a model can be listed and still
 * refuse, which is exactly what happened with `gemini-2.5-flash`.
 *
 * So the result is reported as `visible` rather than `working`, and the note
 * says so. When Phase 3 is built, `generateImage` will exercise the real path
 * and that becomes the proof.
 *
 * @param {string} model - The image model id to check.
 * @returns {Promise<{ok: boolean, model: string, note?: string, reason?: string}>}
 *   Whether the model is visible to this key.
 * @sideeffect Makes a network request. Generates nothing.
 */
export async function describeImageModel(model) {
  try {
    const found = await client.models.retrieve(model);
    return {
      ok: true,
      model,
      note: `visible to this key (${found.id}) — generation not exercised`,
    };
  } catch (err) {
    return {
      ok: false,
      model,
      reason: err?.status === 404
        ? 'not available to this key'
        : `${err?.status ?? ''} ${String(err?.message ?? err).slice(0, 160)}`.trim(),
    };
  }
}

export default { generateStructured, generateText, describeModel, describeImageModel, providerName };
