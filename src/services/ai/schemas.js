/**
 * Structured-output schemas for the AI provider.
 *
 * RESPONSIBILITY
 *   Define the exact JSON shape each generation call must return.
 *
 * ## Why these are hand-written object literals and not Zod
 *
 * The original plan passed Zod schemas through `zodTextFormat`. That works for
 * OpenAI, whose structured-output endpoint accepts full JSON Schema. Gemini
 * does not: its `responseSchema` field accepts only the **OpenAPI subset**,
 * which rejects `additionalProperties`, `$ref`, `allOf`, and — critically —
 * the constructs Zod emits for `.nullable()` and `.optional()`.
 *
 * Converting a Zod schema would therefore produce a schema Gemini silently
 * ignores or rejects, and the failure mode is a 400 at runtime rather than a
 * type error at build time. Writing the objects directly makes every keyword
 * visible and removes the conversion step entirely.
 *
 * CONSEQUENCES TO REMEMBER WHEN EDITING:
 *   • Optional fields are impossible — list a field in `required` or omit it.
 *   • Nullable values must be modelled as a string the caller treats as absent,
 *     or as an empty array.
 *   • `additionalProperties` must never appear.
 *
 * DOES NOT OWN: prompt text (that lives with each generator) or validation of
 * the parsed result — the provider layer re-checks that required keys exist.
 */

/**
 * Themes for a content plan.
 *
 * The model fills in a `theme` for each slot index the caller supplies. It does
 * not choose how many slots there are or which are news — `buildPlanSlots`
 * owns that arithmetic, and this schema only names the angles.
 */
export const ContentPlanSchema = Object.freeze({
  type: 'object',
  properties: {
    days: {
      type: 'array',
      description:
        'One entry per supplied slot, in the same order. Return exactly as many entries as were requested.',
      items: {
        type: 'object',
        properties: {
          dayIndex: {
            type: 'integer',
            description: 'The 1-based slot number this entry is for. Must match the requested slot.',
          },
          theme: {
            type: 'string',
            description:
              'A specific, concrete angle for this post — not a category. ' +
              'Good: "Why most hospital AI pilots fail at the integration layer". ' +
              'Bad: "AI in healthcare".',
          },
        },
        required: ['dayIndex', 'theme'],
      },
    },
  },
  required: ['days'],
});

/**
 * A finished post draft for one platform.
 *
 * `imageIdea` is always present because Gemini cannot express an optional
 * field. The caller passes an empty string to mean "no image warranted",
 * which keeps the provider contract simple at the cost of one small check in
 * `postGenerator`.
 */
export const PostDraftSchema = Object.freeze({
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description:
        'The complete post body, ready to publish. Plain text only — no markdown ' +
        'headings, no surrounding quotes, and no hashtags (those go in their own field). ' +
        'Line breaks are allowed and encouraged for readability. For a thread this is ' +
        'PART 1, and it must stand on its own as the hook.',
    },
    thread: {
      type: 'array',
      description:
        'Continuation parts, posted as replies to the first. Use an EMPTY ARRAY for a ' +
        'single post, which is the right answer most of the time. Only continue when the ' +
        'argument genuinely needs more room than one post allows — never pad to fill a ' +
        'thread. Maximum 3 entries, and each entry must be under the platform limit on ' +
        'its own, because each is posted as a separate message.',
      items: { type: 'string' },
    },
    hashtags: {
      type: 'array',
      description:
        'Between 1 and 5 hashtags, each starting with #. Return an empty array if none fit naturally.',
      items: { type: 'string' },
    },
    imageIdea: {
      type: 'string',
      description:
        'If an accompanying image would add value, a one-sentence art direction for it. ' +
        'Otherwise an empty string. Never describe text to render inside the image.',
    },
  },
  required: ['content', 'thread', 'hashtags', 'imageIdea'],
});

/**
 * The model's pick from a list of real news candidates, plus its reading of it.
 *
 * WHY SELECTION AND ANALYSIS ARE ONE CALL
 *   They were two: pick a story, then summarise it. Against the free tier's
 *   hard limit of **20 requests per day per model**, that is a meaningful cost —
 *   every news slot spent two requests before the post itself was written.
 *
 *   Merging them is safe because the second call depended entirely on the first:
 *   it summarised whichever story the first call chose, so no information is
 *   lost by asking both questions at once. Both halves also need the same
 *   context — the candidate list and the user's input points — which was being
 *   sent twice.
 *
 * The stories come from the RSS feed, so every option is real and has a genuine
 * URL. The model only chooses and interprets — it never invents a headline or a
 * link, which is what makes a fabricated citation impossible rather than merely
 * discouraged.
 */
export const NewsBriefSchema = Object.freeze({
  type: 'object',
  properties: {
    selectedIndex: {
      type: 'integer',
      description: 'The zero-based index of the most relevant candidate from the supplied list.',
    },
    reason: {
      type: 'string',
      description: 'One sentence on why this story suits the user\'s niche and audience.',
    },
    summary: {
      type: 'string',
      description:
        'Two or three sentences describing what happened, in plain language. Work only from ' +
        'the headline — do not add statistics, quotes or dates that are not in it.',
    },
    whyItMatters: {
      type: 'string',
      description: 'One or two sentences on why this matters specifically to the user\'s audience.',
    },
  },
  required: ['selectedIndex', 'reason', 'summary', 'whyItMatters'],
});

export default {
  ContentPlanSchema,
  PostDraftSchema,
  NewsBriefSchema,
};
