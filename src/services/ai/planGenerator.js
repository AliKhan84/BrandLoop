/**
 * Plan generation — turns a duration and a posting frequency into a themed
 * sequence of posting slots.
 *
 * RESPONSIBILITY
 *   Own the slot arithmetic (pure, unit-tested) and the one model call that
 *   names a theme for each slot.
 *
 * ## The PRD contradiction this module resolves
 *
 * PRD §5 stores `days[]` as one entry per **calendar day** (7 or 30), while
 * `User.postFrequency` is **posts per week** (2–4). A 7-day plan at 3/week
 * should hold 3 posting slots, not 7 day-entries.
 *
 * This module treats `days[]` as one entry per **posting slot**:
 *   • `dayIndex`  — 1-based slot ordinal. Stable; used as the post's identity.
 *   • `dayOfPlan` — 0-based calendar offset from the plan start. This is what
 *                   tells the scheduler when the slot is due.
 *
 * `buildPlanSlots` is where that is decided, and it is deliberately pure so the
 * whole matrix (7/30 days × 2/3/4 per week) can be tested without a database or
 * a network call. The model is only ever asked to supply theme *names* — never
 * to decide how many slots exist, or which of them are news. Letting a model
 * own structural arithmetic is how a plan ends up with the wrong length.
 *
 * DOES NOT OWN: post text (`postGenerator`), or persistence (`planService`).
 */

import { generateStructured } from './index.js';
import { ContentPlanSchema } from './schemas.js';
import { CONTENT_MIX, POST_TYPE, SLOT_STATUS } from '../../config/constants.js';
import { logger } from '../../utils/logger.js';

/**
 * Builds the posting-slot sequence for a content plan.
 *
 * ALGORITHM
 *   1. Slot count  = round(postFrequency × durationDays / 7).
 *   2. News count  = round(newsPostsPerWeek × durationDays / 7), capped at the slot count.
 *   3. Slots are spread with `floor(i × durationDays / slotCount)`. Because
 *      slotCount ≤ durationDays, this is strictly increasing, which guarantees
 *      every `dayIndex` maps to a distinct calendar day.
 *   4. Slots are bucketed into 7-day blocks by `floor(dayOfPlan / 7)`, and the
 *      **last** slot in each block is marked `news` — which is what "pinned
 *      near the end of each week" means in practice (PRD §4).
 *
 * Worked example — 30 days at 3/week, 1 news/week:
 *   slots = 13, news = 4
 *   dayOfPlan = 0, 2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27
 *   week blocks = [0,2,4,6] [9,11,13] [16,18,20] [23,25] [27]
 *   news lands on 6, 13, 20 and 27 — one per calendar week, at the end of it.
 *
 * @param {object} params
 * @param {7|30} params.durationDays - Plan window in calendar days.
 * @param {2|3|4} params.postFrequency - Posts per week.
 * @param {number} [params.newsPostsPerWeek=1] - PRD §4 fixed ratio.
 * @returns {Array<{dayIndex: number, dayOfPlan: number, theme: null, type: string, status: string}>}
 *   Slots in order, with `theme` left null for the model to fill.
 * @sideeffect none (pure)
 */
export function buildPlanSlots({ durationDays, postFrequency, newsPostsPerWeek = CONTENT_MIX.NEWS_POSTS_PER_WEEK }) {
  // Guard the divisor: a zero frequency would otherwise produce Infinity slots.
  const safeFrequency = Math.max(1, Math.floor(postFrequency));
  const safeDuration = Math.max(1, Math.floor(durationDays));

  const slotCount = Math.max(1, Math.round((safeFrequency * safeDuration) / 7));
  const newsCount = Math.min(
    slotCount,
    Math.max(0, Math.round((newsPostsPerWeek * safeDuration) / 7)),
  );

  // Step 1 — spread the slots evenly across the window.
  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    slots.push({
      dayIndex: index + 1,
      dayOfPlan: Math.floor((index * safeDuration) / slotCount),
      theme: null,
      type: POST_TYPE.PLANNED,
      status: SLOT_STATUS.PENDING,
    });
  }

  // Step 2 — bucket into 7-day blocks so news can be pinned to the end of each.
  const blocksByWeek = new Map();
  for (const slot of slots) {
    const week = Math.floor(slot.dayOfPlan / 7);
    if (!blocksByWeek.has(week)) blocksByWeek.set(week, []);
    blocksByWeek.get(week).push(slot);
  }

  // Step 3 — walk weeks in order, marking the tail slots as news until the
  // budget is spent. Walking in order means earlier weeks get their news first,
  // which keeps the ratio even rather than front- or back-loading it.
  let assigned = 0;
  for (const week of [...blocksByWeek.keys()].sort((a, b) => a - b)) {
    if (assigned >= newsCount) break;

    const block = blocksByWeek.get(week);
    for (let offset = 0; offset < newsPostsPerWeek && offset < block.length; offset += 1) {
      if (assigned >= newsCount) break;
      // Last slot of the block, then the one before it, and so on.
      block[block.length - 1 - offset].type = POST_TYPE.NEWS;
      assigned += 1;
    }
  }

  logger.debug(
    `buildPlanSlots: ${safeDuration}d @ ${safeFrequency}/week → ` +
      `${slotCount} slots, ${assigned} news`,
  );

  return slots;
}

/**
 * Describes the slot sequence for the model, so it fills in the right count.
 *
 * WHY THIS IS BUILT BY US, NOT THE MODEL: the model is told exactly which slot
 * numbers exist and which are news. It only has to supply an angle for each.
 * Any slot it omits is filled by the caller, so a partial response degrades
 * rather than producing a short plan.
 *
 * @param {Array<{dayIndex: number, dayOfPlan: number, type: string}>} slots - From `buildPlanSlots`.
 * @returns {string} A numbered list for the prompt.
 * @sideeffect none (pure)
 */
function describeSlots(slots) {
  return slots
    .map((slot) => {
      const kind = slot.type === POST_TYPE.NEWS
        ? 'NEWS — tie this to a current development in the field'
        : 'PLANNED — evergreen insight from the author\'s own experience';
      return `  ${slot.dayIndex}. (day ${slot.dayOfPlan}) ${kind}`;
    })
    .join('\n');
}

/**
 * Renders a user's personal input points for the prompt.
 *
 * @param {string[]} [inputPoints=[]] - The user's own opinions and anecdotes.
 * @returns {string} A bulleted list, or a note that none were supplied.
 * @sideeffect none (pure)
 */
function describeInputPoints(inputPoints = []) {
  const points = inputPoints.map((p) => String(p).trim()).filter(Boolean);
  if (points.length === 0) {
    return '(none supplied — keep themes broad but still specific and opinionated)';
  }
  return points.map((point) => `  • ${point}`).join('\n');
}

/**
 * Builds the system prompt for theme generation.
 *
 * @param {object} params
 * @param {string} params.niche - The user's field.
 * @param {number} params.durationDays - Plan length, for context.
 * @returns {string} The system prompt.
 * @sideeffect none (pure)
 */
function buildSystemPrompt({ niche, durationDays }) {
  return [
    `You are a content strategist planning ${durationDays} days of social posts for a professional whose niche is: "${niche}".`,
    '',
    'For each numbered slot, write ONE specific angle for a post.',
    '',
    'RULES',
    '1. Every theme must be distinct. No two slots may cover the same idea.',
    '2. Be specific and concrete, not a category. A reader should be able to predict the argument.',
    '   GOOD: "Why most hospital AI pilots stall at the integration layer, not the model layer"',
    '   BAD:  "AI in healthcare"',
    '3. Write in the professional\'s voice — an insider sharing judgement, not a journalist summarising.',
    '4. Slots marked NEWS must anticipate a current development in this field. Phrase the angle so it still works once the specific story is known, because the real headline is supplied separately.',
    '5. Do not number the themes, and do not restate the slot number inside the theme text.',
    '6. Return exactly one entry per slot, in the same order, using the same slot numbers.',
  ].join('\n');
}

/**
 * Builds the user prompt for theme generation.
 *
 * @param {object} params
 * @param {string} params.niche - The user's field.
 * @param {string[]} params.inputPoints - The user's own topics.
 * @param {Array} params.slots - The slot list from `buildPlanSlots`.
 * @returns {string} The user prompt.
 * @sideeffect none (pure)
 */
function buildUserPrompt({ niche, inputPoints, slots }) {
  return [
    `Niche: ${niche}`,
    '',
    'The author\'s own opinions and experiences (draw on these for the PLANNED slots):',
    describeInputPoints(inputPoints),
    '',
    'Slots to fill:',
    describeSlots(slots),
    '',
    'Return one theme per slot.',
  ].join('\n');
}

/**
 * Assigns generated themes onto a slot list.
 *
 * WHY SEPARATE AND DEFENSIVE: models occasionally return the wrong count, reuse
 * a `dayIndex`, or answer out of order. This matches by `dayIndex` and falls
 * back to positional order, then to a placeholder — so a malformed response
 * produces a plan that still works rather than one with null themes that would
 * later render as "Day 3 — null".
 *
 * @param {Array} slots - The slot list from `buildPlanSlots`.
 * @param {Array<{dayIndex: number, theme: string}>} generated - The model output.
 * @returns {Array} New slot objects with `theme` populated.
 * @sideeffect none (pure)
 */
export function mergeThemes(slots, generated = []) {
  const byIndex = new Map();
  for (const entry of generated) {
    const index = Number(entry?.dayIndex);
    const theme = String(entry?.theme ?? '').trim();
    // First write wins, so a duplicated dayIndex does not overwrite a good theme.
    if (Number.isFinite(index) && theme && !byIndex.has(index)) {
      byIndex.set(index, theme);
    }
  }

  return slots.map((slot, position) => {
    // Prefer the explicit dayIndex match; fall back to positional order for a
    // response that omitted or mangled the numbers.
    const positional = String(generated[position]?.theme ?? '').trim();
    const theme = byIndex.get(slot.dayIndex) || positional || `${slot.type === POST_TYPE.NEWS ? 'Current developments in' : 'Practical notes on'} this field`;

    return { ...slot, theme };
  });
}

/**
 * Generates a complete, themed slot list for a content plan.
 *
 * Makes exactly one model call. If the call fails the plan is still returned
 * with placeholder themes, because a plan with generic themes the user can edit
 * is more useful than no plan at all — and the caller can surface the failure.
 *
 * @param {object} params
 * @param {object} params.user - The user document (uses `niche`, `inputPoints`).
 * @param {7|30} params.durationDays - Plan window in calendar days.
 * @param {number} [params.postFrequency] - Overrides `user.postFrequency`.
 * @returns {Promise<{slots: Array, summary: string, model: string|null, usage: object|null, durationMs: number|null, usedFallback: boolean}>}
 *   The themed slots plus metadata for `GenerationLog`.
 * @throws {never} A model failure is absorbed; check `usedFallback`.
 * @sideeffect Makes a network request.
 */
export async function generateContentPlan({ user, durationDays, postFrequency = user?.postFrequency }) {
  // Structure first — this is ours, and it cannot fail.
  const slots = buildPlanSlots({ durationDays, postFrequency });

  const niche = user?.niche?.trim() || 'professional development';

  try {
    const result = await generateStructured({
      systemPrompt: buildSystemPrompt({ niche, durationDays }),
      userPrompt: buildUserPrompt({ niche, inputPoints: user?.inputPoints ?? [], slots }),
      schema: ContentPlanSchema,
      label: 'generateContentPlan',
    });

    const themed = mergeThemes(slots, result.data?.days ?? []);
    const newsCount = themed.filter((slot) => slot.type === POST_TYPE.NEWS).length;

    return {
      slots: themed,
      summary: `${themed.length} posts over ${durationDays} days — ${themed.length - newsCount} planned, ${newsCount} from current news.`,
      model: result.model,
      usage: result.usage,
      durationMs: result.durationMs,
      usedFallback: false,
    };
  } catch (err) {
    logger.error('generateContentPlan: theme generation failed, using placeholders', err);

    // Still return a usable plan. The caller records the failure against the
    // quota spend that already happened, and the user sees generic themes they
    // can regenerate rather than an empty screen.
    const themed = mergeThemes(slots, []);

    return {
      slots: themed,
      summary: `${themed.length} posts over ${durationDays} days (themes unavailable — regenerate for specific angles).`,
      model: null,
      usage: null,
      durationMs: null,
      usedFallback: true,
    };
  }
}

export default { buildPlanSlots, generateContentPlan, mergeThemes };
