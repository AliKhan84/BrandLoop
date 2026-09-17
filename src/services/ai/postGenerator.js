/**
 * Post generation — produces the text for one slot on one platform.
 *
 * RESPONSIBILITY
 *   Turn a plan slot (plus, for news slots, a real news story) into a finished
 *   draft that fits the target platform.
 *
 * ## Two modes
 *
 *   planned — write from the user's niche, their own input points, and the
 *             slot's theme.
 *   news    — pick a real story from the RSS feed, understand it, then write a
 *             post that comments on it.
 *
 * ## Why news works the way it does
 *
 * The model never authors a URL. It receives a numbered list of real candidates
 * from `rssNews`, picks one by index, and explains why. The headline and link
 * come from the feed and are copied through untouched. This is what makes a
 * fabricated citation structurally impossible rather than merely discouraged —
 * the original plan needed an anti-hallucination pass precisely because the
 * model was allowed to write URLs. See plan amendment A2.
 *
 * ## Length is enforced here, not asked for politely
 *
 * The prompt states the limit, but `enforcePlatformLimit` is what actually
 * guarantees it. Models overshoot on long themes, and a platform silently
 * truncates an over-long post with no ellipsis, which reads as broken.
 *
 * DOES NOT OWN: persistence, quotas (checked by the caller before this runs),
 * or delivery to Discord.
 */

import { generateStructured } from './index.js';
import { PostDraftSchema, NewsBriefSchema } from './schemas.js';
import { fetchNicheNews } from '../news/rssNews.js';
import { env } from '../../config/env.js';
import {
  HASHTAG_GUIDANCE,
  MAX_THREAD_REPLIES,
  PLATFORM,
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  POST_TYPE,
} from '../../config/constants.js';
import { enforcePlatformLimit, excerpt, countCharacters } from '../../utils/text.js';
import { logger } from '../../utils/logger.js';

/**
 * Voice guidance per platform.
 *
 * WHY THIS IS NOT ONE GENERIC INSTRUCTION: an X post and a LinkedIn post about
 * the same theme are different pieces of writing. X rewards a sharp opening
 * line because the first line is all that survives the fold; LinkedIn rewards
 * a first-person account because its feed readers are there for professional
 * narrative. Generating one text and trimming it for the other produces
 * something that reads as second-hand on both.
 */
const VOICE_GUIDANCE = Object.freeze({
  [PLATFORM.X]: [
    'Write for X.',
    '- Open with the sharpest claim or observation. No warm-up sentence.',
    '- Short sentences. Fragments are fine.',
    '- No throat-clearing ("I\'ve been thinking about..."). Start with the point.',
    '- Plain text only. No markdown, no bullet characters, no numbered lists.',
  ].join('\n'),

  [PLATFORM.LINKEDIN]: [
    'Write for LinkedIn.',
    '- Open with a specific, concrete first line. It is the only line shown before "see more".',
    '- Write in the first person, drawing on the author\'s own experience where the inputs allow.',
    '- Short paragraphs separated by blank lines. Long walls of text are not read.',
    // Bullets are allowed here but not on X, and the instruction says so
    // rather than banning them outright. A flat "no bullet characters" was
    // being ignored by the model on LinkedIn — correctly, because a short
    // dashed list is genuinely easier to scan than the same content in prose,
    // which is what the instruction above already asks for. An instruction the
    // model keeps defying is usually the instruction that is wrong.
    '- A short dashed list is fine when you are enumerating things: symptoms, steps, examples. Keep it to 3-5 items and do not nest them.',
    '- No markdown syntax: no #, ##, **, or backticks. A plain "-" or "1." at the start of a line is enough.',
    '- End with a question or a clear takeaway that invites a reply.',
  ].join('\n'),
});

/**
 * Renders a news story for the prompt.
 *
 * @param {object} story - A candidate from `rssNews.fetchNicheNews`.
 * @param {object} [insight] - The model's summary, when one has been produced.
 * @returns {string} A description of the story for the prompt.
 * @sideeffect none (pure)
 */
function describeStory(story, insight) {
  const lines = [
    `Headline: ${story.title}`,
    `Publisher: ${story.sourceName}`,
    `Published: ${story.ageDays === 0 ? 'today' : `${story.ageDays} day(s) ago`}`,
  ];

  if (insight?.summary) {
    lines.push('', `What happened: ${insight.summary}`);
  }
  if (insight?.whyItMatters) {
    lines.push(`Why it matters to this audience: ${insight.whyItMatters}`);
  }

  return lines.join('\n');
}

/**
 * Picks a story from the real candidates and explains what it signals.
 *
 * Selection and analysis are deliberately one call rather than two — see
 * `NewsBriefSchema` for the quota reasoning behind that.
 *
 * The candidates come from the RSS feed, so every option is real and has a
 * genuine URL. The model only ranks and interprets; it never authors a headline
 * or a link.
 *
 * @param {object} params
 * @param {object[]} params.candidates - Real stories from the RSS feed.
 * @param {string} params.niche - The user's field.
 * @param {string[]} params.inputPoints - The user's own topics, used to rank.
 * @returns {Promise<{story: object, reason: string, insight: {summary: string,
 *   whyItMatters: string}}|null>} The chosen story and reading, or null when the
 *   model's index was unusable.
 * @throws {import('../../utils/ApiError.js').ApiError} When the call itself fails.
 * @sideeffect Makes a network request.
 */
async function buildNewsBrief({ candidates, niche, inputPoints = [] }) {
  const list = candidates
    .map((story, index) => `  ${index}. ${story.title} — ${story.sourceName} (${story.ageDays}d old)`)
    .join('\n');

  const result = await generateStructured({
    systemPrompt: [
      `You brief a professional whose niche is "${niche}" on the day's news.`,
      '',
      'STEP 1 — Choose the story that:',
      '  • is most substantive — a development, finding, decision or shift, not a listicle or opinion piece',
      '  • the professional can add genuine insight to, from their own experience',
      '  • is most recent, when two options are otherwise equal',
      '',
      'STEP 2 — Explain the story you chose.',
      '',
      'You are given headlines and publishers only — you do NOT have the article bodies.',
      'Work from what each headline actually supports. Do NOT invent statistics, quotes,',
      'dates or specifics that are not in it. If a headline is vague, say what it signals',
      'rather than inventing detail.',
    ].join('\n'),
    userPrompt: [
      `Candidates:\n${list}`,
      '',
      inputPoints.length ? `The professional's own perspective:\n${inputPoints.map((p) => `  • ${p}`).join('\n')}` : '',
      '',
      'Which story should they write about, and what does it signal for their audience?',
    ].filter(Boolean).join('\n'),
    schema: NewsBriefSchema,
    // The cheap model is the right instrument for a ranking-and-reading task,
    // and it draws on a separate daily quota from the writing model — see the
    // note on quota in `usageLogger` / the plan's free-tier section.
    model: env.CHEAP_MODEL,
    label: 'buildNewsBrief',
  });

  const index = Number(result.data?.selectedIndex);

  // Validate rather than trust: an out-of-range index would otherwise select
  // the wrong story, or crash on an undefined one.
  if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
    logger.warn(`buildNewsBrief: model returned index ${index} outside 0..${candidates.length - 1}`);
    return null;
  }

  return {
    story: candidates[index],
    reason: String(result.data?.reason ?? '').trim(),
    insight: {
      summary: String(result.data?.summary ?? '').trim(),
      whyItMatters: String(result.data?.whyItMatters ?? '').trim(),
    },
  };
}

/**
 * Builds the system prompt for post writing.
 *
 * @param {object} params
 * @param {string} params.platform - Target platform.
 * @param {string} params.niche - The user's field.
 * @param {number} params.limit - Character ceiling for the platform.
 * @returns {string} The system prompt.
 * @sideeffect none (pure)
 */
function buildPostSystemPrompt({ platform, niche, limit }) {
  const label = PLATFORM_LABELS[platform] ?? platform;
  const isX = platform === PLATFORM.X;

  return [
    `You write ${label} posts for a professional whose niche is "${niche}".`,
    '',
    VOICE_GUIDANCE[platform] ?? '',
    '',
    'HARD CONSTRAINTS',
    `1. The post body must be under ${limit} characters. Aim for roughly ${Math.floor(limit * 0.85)}.`,
    `2. Use ${HASHTAG_GUIDANCE[platform] ?? '1 to 3'} hashtags, in the hashtags field only — never inside the body.`,
    '3. Never invent facts, figures, quotes, dates or statistics. If you are unsure of a specific, write around it.',
    '4. Never include a URL in the body — any link is supplied separately.',
    '5. Write as the professional, in the first person. No "as an AI" framing, no meta-commentary.',
    '6. Do not wrap the post in quotation marks.',
    '7. Set imageIdea only if a visual would genuinely add something; otherwise use an empty string.',
    // The thread instruction is X-only. LinkedIn has 3000 characters, so the
    // pressure that makes threading useful does not exist there, and its
    // continuations are comments rather than replies.
    ...(isX
      ? [
          '',
          'THREADS',
          `A thread is available when one post cannot carry the argument. Each part is posted as a separate reply, so every part must be under ${limit} characters on its own.`,
          `Write "content" first as the hook — it must make sense alone, because many readers never expand the rest. Put any continuation in the "thread" array, in posting order, and keep the whole thing to ${MAX_THREAD_REPLIES} continuations at most.`,
          'MOST POSTS SHOULD NOT BE THREADS. Return an empty "thread" array unless the argument genuinely needs the room. Do not pad a complete thought across parts to seem substantial, and do not split a post that already fits.',
          'Do not number the parts, and do not write "1/4" or "thread 🧵" — the reply chain already shows the structure.',
        ]
      : ['', 'Return an empty "thread" array — threads are X-only.']),
  ].join('\n');
}

/**
 * Builds the user prompt for post writing.
 *
 * @param {object} params
 * @param {object} params.slot - The plan slot being written.
 * @param {string} params.niche - The user's field.
 * @param {string[]} params.inputPoints - The user's own topics.
 * @param {object|null} params.story - The news story, for news slots.
 * @param {object|null} params.insight - The story summary, for news slots.
 * @returns {string} The user prompt.
 * @sideeffect none (pure)
 */
function buildPostUserPrompt({ slot, niche, inputPoints = [], story = null, insight = null }) {
  const lines = [];

  if (slot.type === POST_TYPE.NEWS && story) {
    lines.push(
      'This post is about a real news story. Use ONLY the information below — do not',
      'add details about the story from your own knowledge, because you have not read',
      'the article and the headline may not reflect it fully.',
      '',
      describeStory(story, insight),
      '',
      'Write a post that comments on this story from the author\'s professional perspective.',
      'Do not simply report it — add the interpretation only they could offer.',
    );
  } else {
    lines.push(
      `Theme for this post: "${slot.theme}"`,
      '',
      'Write a post on exactly this theme.',
    );
  }

  if (inputPoints.length) {
    lines.push(
      '',
      'The author\'s own opinions and experiences — draw on these for credibility, and',
      'prefer them over generic industry commentary:',
      ...inputPoints.map((point) => `  • ${point}`),
    );
  }

  if (niche) lines.push('', `Their niche: ${niche}`);

  return lines.join('\n');
}

/**
 * Fetches and chooses a news story for a slot.
 *
 * Returns null rather than throwing when no story is available, so the caller
 * can degrade the slot to a planned post instead of losing the day.
 *
 * @param {object} params
 * @param {object} params.user - The user document.
 * @param {string} [params.niche] - Overrides `user.niche`.
 * @returns {Promise<{story: object, insight: object, reason: string}|null>}
 *   The chosen story, its insight, and why it was chosen.
 * @sideeffect Makes network requests.
 */
export async function resolveNewsStory({ user, niche = user?.niche }) {
  const inputPoints = user?.inputPoints ?? [];

  // The query is the niche alone. `inputPoints` feed the *selection* below, not
  // the search — appending them to the query returned zero candidates. See the
  // note on `buildQuery` in `rssNews.js`.
  const feed = await fetchNicheNews({ niche });

  if (!feed.ok || feed.candidates.length === 0) {
    logger.warn(`resolveNewsStory: no candidates (${feed.reason}) for query "${feed.query}"`);
    return null;
  }

  let brief;
  try {
    // One call picks the story and reads it. See `NewsBriefSchema` for why
    // these are no longer two.
    brief = await buildNewsBrief({ candidates: feed.candidates, niche, inputPoints });
  } catch (err) {
    logger.warn('resolveNewsStory: briefing call failed, falling back to the newest story', err?.message);
    // The feed already sorts newest-first, so the first candidate is a sensible
    // default when the model is unavailable — better than losing the slot.
    brief = null;
  }

  // Unparseable or out-of-range selection also falls back rather than failing:
  // a post about the newest story beats no post at all.
  const story = brief?.story ?? feed.candidates[0];
  const reason = brief?.reason ?? 'fallback: newest candidate';
  const insight = brief?.insight ?? { summary: '', whyItMatters: '' };

  return { story, insight, reason };
}

/**
 * Generates one post for a slot and platform.
 *
 * @param {object} params
 * @param {object} params.user - The user document.
 * @param {object} params.slot - The plan slot, with `theme` and `type`.
 * @param {string} params.platform - One of the `PLATFORM` values.
 * @param {{story: object, insight: object, reason: string}|null} [params.existingNews]
 *   A previously resolved story. Passed on a regenerate so a rejection does not
 *   re-fetch the feed or re-pay for the summary.
 * @returns {Promise<object>} The draft: `{ content, hashtags, needsImage,
 *   imagePrompt, sourceNews, model, usage, durationMs, truncated }`.
 * @throws {import('../../utils/ApiError.js').ApiError} When generation fails.
 * @sideeffect Makes network requests.
 */
export async function generatePost({ user, slot, platform, existingNews = null }) {
  const niche = user?.niche ?? '';
  const inputPoints = user?.inputPoints ?? [];
  const limit = PLATFORM_LIMITS[platform];

  let news = null;

  if (slot.type === POST_TYPE.NEWS) {
    // Reuse the resolved story on a regenerate; only fetch when there is none.
    news = existingNews ?? (await resolveNewsStory({ user, niche }));

    if (!news) {
      logger.warn(
        `generatePost: slot ${slot.dayIndex} wanted news but none was available — ` +
          'writing a planned post instead so the slot is not lost',
      );
    }
  }

  const story = news?.story ?? null;
  const insight = news?.insight ?? null;

  const result = await generateStructured({
    systemPrompt: buildPostSystemPrompt({ platform, niche, limit }),
    userPrompt: buildPostUserPrompt({ slot, niche, inputPoints, story, insight }),
    schema: PostDraftSchema,
    label: `generatePost:${platform}:slot${slot.dayIndex}`,
  });

  // Hashtags are computed BEFORE the length check, because they count against
  // the platform's ceiling. Measuring the body alone let an assembled X post
  // reach 305 characters against a 280 limit — the body fitted, then the tags
  // pushed it over. The suffix length is reserved below so the whole post fits.
  const hashtags = (result.data?.hashtags ?? [])
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    // Normalise to a single leading '#' so a model that returns "#AI" and "AI"
    // does not produce "##AI" or a bare "AI".
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .slice(0, 5);

  // `\n\n` + the tags joined by single spaces — matching `Post.fullText()` and
  // `appendHashtags`, so the reservation cannot drift from what is appended.
  const tagSuffixLength = hashtags.length > 0 ? hashtags.join(' ').length + 2 : 0;

  // The model's own length claim is not trusted — this is the guarantee.
  const fitted = enforcePlatformLimit(result.data?.content ?? '', platform, {
    reserve: tagSuffixLength,
  });

  if (fitted.truncated) {
    logger.warn(
      `generatePost: body of ${fitted.originalLength} chars exceeded the ` +
        `${fitted.bodyLimit}-char body budget (${fitted.limit} total, ` +
        `${fitted.reserved} reserved for hashtags) for ${platform} — cut on a sentence boundary`,
    );
  }

  // Thread parts, each fitted independently.
  //
  // WHY PER PART AND NOT AS ONE BLOCK: every part is posted as its own message,
  // so each is subject to the platform limit on its own. Measuring the thread's
  // total would allow a 900-character part that X truncates with no ellipsis.
  //
  // No hashtag reserve here — tags are appended to the root only, matching
  // `fullText()`.
  //
  // X ONLY. LinkedIn has a 3000-character ceiling and its continuations are
  // comments with different semantics; a thread there is a separate design, not
  // an oversight.
  const rawThread = platform === PLATFORM.X ? (result.data?.thread ?? []) : [];

  const threadParts = rawThread
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    // The schema asks for at most 3 continuations; enforced here because a
    // model that ignores it would produce a thread the user has to trim by hand.
    .slice(0, MAX_THREAD_REPLIES)
    .map((part) => {
      const partFit = enforcePlatformLimit(part, platform);
      if (partFit.truncated) {
        logger.warn(
          `generatePost: thread part of ${partFit.originalLength} chars exceeded the ` +
            `${partFit.limit}-char limit for ${platform} — cut on a sentence boundary`,
        );
      }
      return partFit.text;
    })
    // A part that truncation reduced to nothing is dropped rather than stored as
    // an empty reply.
    .filter(Boolean);

  if (platform === PLATFORM.X && rawThread.length > MAX_THREAD_REPLIES) {
    logger.warn(
      `generatePost: model returned ${rawThread.length} thread parts, kept the first ` +
        `${MAX_THREAD_REPLIES}`,
    );
  }

  const imageIdea = String(result.data?.imageIdea ?? '').trim();

  // Verified here rather than assumed: this is the number the platform sees,
  // and getting it wrong is silent — the platform truncates with no ellipsis.
  const decodedLength = countCharacters(fitted.text) + tagSuffixLength;
  if (decodedLength > limit) {
    logger.error(
      `generatePost: assembled post is ${decodedLength} chars against the ${limit} limit ` +
        `for ${platform} — the reservation is wrong and the platform would truncate it`,
    );
  }

  return {
    content: fitted.text,
    thread: threadParts,
    hashtags,
    // Phase 3 is deferred; these fields are populated now so enabling it later
    // needs no change to this function.
    needsImage: imageIdea.length > 0,
    imagePrompt: imageIdea || null,
    sourceNews: story
      ? {
          url: story.url,
          title: story.title,
          name: story.sourceName,
          homepage: story.sourceHomepage,
          publishedAt: story.publishedAt,
          whyThis: news.reason,
        }
      : null,
    model: result.model,
    usage: result.usage,
    durationMs: result.durationMs,
    // True when anything was cut — the root or any thread part.
    truncated: fitted.truncated || threadParts.length < rawThread.filter(Boolean).length,
    preview: excerpt(fitted.text),
  };
}

export default { generatePost, resolveNewsStory };
