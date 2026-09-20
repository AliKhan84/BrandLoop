/**
 * AI provider selector.
 *
 * RESPONSIBILITY
 *   Load the implementation named by `AI_PROVIDER` and hand it to the rest of
 *   the app behind a single interface.
 *
 * ## Why this abstraction exists
 *
 * The provider changed once already — the plan was written for OpenAI and the
 * available key turned out to be Gemini. That cost a rewrite of every call
 * site because the SDK shapes leak into whatever module uses them. Keeping the
 * surface to three functions means the next switch touches one file.
 *
 * ## The entire provider contract
 *
 *   generateStructured({ systemPrompt, userPrompt, schema, model, label })
 *     → { data, model, usage, durationMs }
 *   generateText({ systemPrompt, userPrompt, model, temperature, label })
 *     → { text, model, usage, durationMs }
 *   generateImage({ prompt, size, model, label })
 *     → { buffer, mimeType, model, usage, durationMs, requestId }
 *   describeModel(model)
 *     → { ok, model, reason? }
 *   describeImageModel(model)
 *     → { ok, model, note?, reason? }
 *   providerName → string
 *
 * Anything a generator needs beyond this belongs in the generator, not here.
 * `imageGenerator` is the only caller of `generateImage`; the probe is the only
 * caller of the two `describe*` checks.
 *
 * DOES NOT OWN: prompt construction, quota checks, or logging of results.
 */

import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

/**
 * Lazy loaders, keyed by the `AI_PROVIDER` value.
 *
 * WHY LAZY: importing the OpenAI SDK when the provider is Gemini would load a
 * sizeable dependency and construct a second client that is never used. The
 * loader runs only for the selected provider.
 */
const LOADERS = {
  gemini: () => import('./gemini.js'),
  openai: () => import('./openai.js'),
};

/**
 * Cached module reference, so the loader runs at most once per process.
 * @type {object|null}
 */
let cachedProvider = null;

/**
 * Resolves the configured provider implementation.
 *
 * Safe to call on every request — the module is imported once and reused.
 *
 * @returns {Promise<object>} The provider module implementing the contract above.
 * @throws {Error} When `AI_PROVIDER` names an implementation that does not exist.
 * @sideeffect Imports a module on first call.
 */
export async function getProvider() {
  if (cachedProvider) return cachedProvider;

  const name = env.AI_PROVIDER;
  const loader = LOADERS[name];

  if (!loader) {
    // Only reachable if AI_PROVIDER bypassed env validation, but a clear error
    // here beats a confusing "cannot read property of undefined" later.
    throw new Error(
      `Unknown AI_PROVIDER "${name}". Expected one of: ${Object.keys(LOADERS).join(', ')}.`,
    );
  }

  cachedProvider = await loader();
  logger.info(`AI provider loaded: ${name} (model ${env.TEXT_MODEL})`);

  return cachedProvider;
}

/**
 * Generates a response constrained to a JSON schema.
 *
 * Thin pass-through so callers import from one module regardless of provider.
 *
 * @param {object} params - See the provider contract above.
 * @returns {Promise<{data: object, model: string, usage: object, durationMs: number}>}
 * @throws {import('../../utils/ApiError.js').ApiError} When generation fails.
 * @sideeffect Makes a network request.
 */
export async function generateStructured(params) {
  const provider = await getProvider();
  return provider.generateStructured(params);
}

/**
 * Generates free-form text.
 *
 * @param {object} params - See the provider contract above.
 * @returns {Promise<{text: string, model: string, usage: object, durationMs: number}>}
 * @throws {import('../../utils/ApiError.js').ApiError} When generation fails.
 * @sideeffect Makes a network request.
 */
export async function generateText(params) {
  const provider = await getProvider();
  return provider.generateText(params);
}

/**
 * Generates one image and returns its bytes.
 *
 * Phase 3. The bytes are not written anywhere here — `imageGenerator` owns the
 * prompt and the file layout; this is only the provider hop.
 *
 * @param {object} params - See the provider contract above.
 * @returns {Promise<{buffer: Buffer, mimeType: string, model: string,
 *   usage: object, durationMs: number, requestId: string|null}>} The image.
 * @throws {import('../../utils/ApiError.js').ApiError} When the call fails.
 * @sideeffect Makes a network request.
 */
export async function generateImage(params) {
  const provider = await getProvider();
  return provider.generateImage(params);
}

/**
 * Checks whether a model id is usable with the configured key.
 *
 * @param {string} model - The model id to test.
 * @returns {Promise<{ok: boolean, model: string, reason?: string}>} The result.
 * @sideeffect Makes a network request.
 */
export async function describeModel(model) {
  const provider = await getProvider();
  return provider.describeModel(model);
}

/**
 * Checks whether an image model is visible to the configured key.
 *
 * Separate from `describeModel` because image models are not served by the same
 * endpoint as text models — probing one through the text path returns a 400
 * that looks like the model is unavailable when it is not. See the provider
 * implementations for the detail.
 *
 * @param {string} model - The image model id to check.
 * @returns {Promise<{ok: boolean, model: string, note?: string, reason?: string}>}
 *   Whether the model is visible, and what that does and does not prove.
 * @sideeffect Makes a network request. Generates nothing.
 */
export async function describeImageModel(model) {
  const provider = await getProvider();
  return provider.describeImageModel(model);
}

/**
 * The name of the active provider, for `GenerationLog` rows.
 *
 * @returns {Promise<string>} e.g. `"gemini"`.
 * @sideeffect none
 */
export async function getProviderName() {
  const provider = await getProvider();
  return provider.providerName ?? env.AI_PROVIDER;
}

export default {
  getProvider,
  generateStructured,
  generateText,
  generateImage,
  describeModel,
  describeImageModel,
  getProviderName,
};
