/**
 * News sourcing from Google News RSS.
 *
 * RESPONSIBILITY
 *   Find recent, real news stories for a user's niche, and return them as
 *   verifiable candidates with genuine URLs.
 *
 * ## Why RSS instead of model-driven search (plan amendment A2)
 *
 * The original plan used a web-search tool and then cross-referenced every URL
 * the model produced against the tool's citation list, discarding anything that
 * did not match — an anti-hallucination check that existed solely because the
 * model was allowed to author URLs.
 *
 * Two things changed that:
 *   1. The Gemini key's Search-grounding quota is exhausted (`429`), so the
 *      tool is unavailable.
 *   2. RSS is strictly better *anyway*. Every URL comes from the feed, so the
 *      model has no opportunity to invent one. The anti-hallucination check is
 *      not worked around — it is deleted, because the failure it guarded
 *      against is now structurally impossible.
 *
 * ## The link constraint, established by testing
 *
 * Google News RSS `<link>` values are `news.google.com/rss/articles/…`
 * redirects, and they do **not** resolve server-side — a HEAD/GET with redirect
 * following stays on news.google.com, because the resolution happens in
 * client-side JavaScript. Verified against three live items.
 *
 * A Google News link IS real and clickable in a browser, so it is stored as the
 * citation. But because it does not reveal the publisher, the feed's
 * `<source url="…">` homepage is captured alongside it, and the publisher *name*
 * is what gets shown to the user. That way the source is legible without
 * following the link.
 *
 * DOES NOT OWN: deciding which story is used (that is `postGenerator`'s model
 * call) or summarising it.
 */

import { XMLParser } from 'fast-xml-parser';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import {
  NEWS_BLOCKED_DOMAINS,
  NEWS_CANDIDATE_LIMIT,
  NEWS_FETCH_TIMEOUT_MS,
} from '../../config/constants.js';

/**
 * Google News RSS endpoint.
 * `hl`/`gl`/`ceid` pin the edition; without them the feed is localised by IP,
 * which makes results non-deterministic between machines.
 */
const FEED_BASE = 'https://news.google.com/rss/search';

/**
 * Some publishers reject requests with a default Node user-agent.
 * A plain browser string is enough to get the feed.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; BrandLoop/1.0; +https://github.com/brandloop)';

/**
 * Parser configured for Google's feed dialect.
 *
 * `ignoreAttributes: false` is required — the `<source url="…">` attribute is
 * the only place the publisher's real homepage appears.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

/**
 * Extracts a bare domain from a URL, for blocklist comparison.
 *
 * @param {string} url - Any URL, possibly malformed.
 * @returns {string} The lowercase hostname without `www.`, or `''`.
 * @sideeffect none (pure)
 */
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    // A malformed homepage URL is not worth discarding the story over; an
    // empty domain simply never matches the blocklist.
    return '';
  }
}

/**
 * Reports whether a publisher is on the blocklist.
 *
 * Matches on suffix so `news.crunchbase.com` blocks when `crunchbase.com` is
 * listed, without needing every subdomain enumerated.
 *
 * @param {string} domain - Hostname, from `domainOf`.
 * @returns {boolean} True when the publisher should be skipped.
 * @sideeffect none (pure)
 */
function isBlockedPublisher(domain) {
  if (!domain) return false;
  return NEWS_BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

/**
 * Removes the ` - Publisher` suffix Google appends to every headline.
 *
 * WHY: the publisher is already shown separately, so leaving the suffix makes
 * every title read as redundant, and it inflates the character count when the
 * headline is passed to the model as context.
 *
 * @param {string} title - The raw feed title.
 * @param {string} [sourceName=''] - Publisher name to strip when present.
 * @returns {string} The cleaned headline.
 * @sideeffect none (pure)
 */
function stripPublisherSuffix(title, sourceName = '') {
  const clean = String(title).trim();
  if (!sourceName) {
    // No known publisher — strip any trailing " - Something" only when it looks
    // like a short publisher tag rather than part of the headline.
    return clean.replace(/\s+-\s+[^-]{2,40}$/, '').trim() || clean;
  }

  const suffix = ` - ${sourceName}`;
  return clean.endsWith(suffix) ? clean.slice(0, -suffix.length).trim() : clean;
}

/**
 * Normalises a headline for de-duplication.
 *
 * Different feeds carry the same story with different punctuation and casing.
 * Comparing a stripped, lowercased form collapses those into one candidate.
 *
 * @param {string} title - The headline.
 * @returns {string} A comparison key.
 * @sideeffect none (pure)
 */
function dedupeKey(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes whole days between a date and now.
 *
 * @param {Date} date - The earlier date.
 * @param {Date} [now=new Date()] - Reference point, injectable for tests.
 * @returns {number} Age in whole days; `Infinity` for an invalid date.
 * @sideeffect none (pure)
 */
function ageInDays(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return Infinity;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

/**
 * Flattens a parsed feed's items into an array.
 *
 * WHY: fast-xml-parser returns a bare object rather than a one-element array
 * when a feed happens to contain a single item. Normalising here means every
 * downstream step can assume an array.
 *
 * @param {object} parsed - The parser output.
 * @returns {object[]} The item nodes, always an array.
 * @sideeffect none (pure)
 */
function extractItems(parsed) {
  const raw = parsed?.rss?.channel?.item;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Builds the search query from the user's niche.
 *
 * ## Why the query is just the niche (measured, not assumed)
 *
 * An earlier version appended the user's `inputPoints` to the query, on the
 * theory that it would personalise the results. It does the opposite. Those
 * points are full sentences, so the query became:
 *
 *   "AI in healthcare I spent three years deploying clinical decision
 *    support in NHS trusts. Most hospital AI projects fail at integration
 *    and procurement, not model accuracy."
 *
 * Measured against the live feed, that returns **0 candidates**. `"AI in
 * healthcare"` alone returns **25**. Google News treats a long query as a
 * conjunction of every term, so each extra word narrows the result set toward
 * nothing.
 *
 * Personalisation therefore happens where it actually works: in
 * `selectStory`, where the model ranks the real candidates using the user's
 * input points as context. Broad fetch, personalised *selection* — which also
 * means two users in the same niche get different posts without the feed ever
 * being narrowed.
 *
 * @param {object} params
 * @param {string} params.niche - The user's field, e.g. "AI in healthcare".
 * @param {string} [params.extraQuery=''] - Optional caller-supplied refinement.
 *   Keep it short — the same narrowing rule applies.
 * @returns {string} A short search query.
 * @sideeffect none (pure)
 */
function buildQuery({ niche, extraQuery = '' }) {
  // Deliberately at most two short terms. Everything beyond that measured as a
  // reduction in results rather than a refinement of them.
  return [niche, extraQuery]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Fetches and normalises recent news for a user's niche.
 *
 * Never throws. A feed outage, a timeout or an empty result all return
 * `{ ok: false }` with a reason, so the pipeline can degrade to a `planned`
 * post rather than dead-ending. A news slot that cannot find news is a smaller
 * problem than a day with no post at all.
 *
 * @param {object} params
 * @param {string} params.niche - The user's field.
 * @param {string} [params.extraQuery=''] - Extra query terms. Keep it short.
 * @param {number} [params.maxAgeDays] - Override the configured freshness window.
 * @param {number} [params.limit] - Maximum candidates to return.
 * @returns {Promise<{ok: boolean, reason?: string, query: string, candidates: object[]}>}
 *   Candidates are ordered newest first and each carries
 *   `{ title, url, sourceName, sourceHomepage, publishedAt, ageDays }`.
 * @sideeffect Makes an outbound HTTP request.
 */
export async function fetchNicheNews({
  niche,
  extraQuery = '',
  maxAgeDays = env.NEWS_MAX_AGE_DAYS,
  limit = NEWS_CANDIDATE_LIMIT,
} = {}) {
  const query = buildQuery({ niche, extraQuery });

  if (!query.trim()) {
    return { ok: false, reason: 'no_query', query, candidates: [] };
  }

  const url = `${FEED_BASE}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

  let xml;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
      // An unbounded fetch would stall the scheduler run behind a hung socket.
      signal: AbortSignal.timeout(NEWS_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(`news: feed returned HTTP ${response.status} for "${query}"`);
      return { ok: false, reason: `http_${response.status}`, query, candidates: [] };
    }

    xml = await response.text();
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : 'network_error';
    logger.warn(`news: fetch failed (${reason}) for "${query}"`, err?.message);
    return { ok: false, reason, query, candidates: [] };
  }

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    logger.warn('news: could not parse the feed XML', err?.message);
    return { ok: false, reason: 'parse_error', query, candidates: [] };
  }

  const now = new Date();
  const seen = new Set();
  const candidates = [];
  let blockedCount = 0;
  let staleCount = 0;

  for (const item of extractItems(parsed)) {
    const sourceName = typeof item.source === 'object' ? item.source?.['#text'] : item.source;
    const sourceHomepage = typeof item.source === 'object' ? item.source?.['@_url'] : '';
    const domain = domainOf(sourceHomepage);

    if (isBlockedPublisher(domain)) {
      blockedCount += 1;
      continue;
    }

    const title = stripPublisherSuffix(item.title, sourceName);
    if (!title) continue;

    const key = dedupeKey(title);
    if (!key || seen.has(key)) continue;

    const publishedAt = new Date(item.pubDate);
    const ageDays = ageInDays(publishedAt, now);

    // A story with no usable date cannot be shown as "recent", so it is dropped
    // rather than presented as current.
    if (ageDays > maxAgeDays) {
      staleCount += 1;
      continue;
    }

    seen.add(key);
    candidates.push({
      title,
      // The Google News redirect. Real and clickable in a browser; see the
      // module note on why it is not resolved server-side.
      url: String(item.link ?? '').trim(),
      sourceName: String(sourceName ?? '').trim() || domain || 'Unknown source',
      sourceHomepage: String(sourceHomepage ?? '').trim(),
      publishedAt,
      ageDays,
    });
  }

  // Newest first: a news post about a week-old story reads as stale.
  candidates.sort((a, b) => a.ageDays - b.ageDays);

  logger.debug(
    `news: "${query}" → ${candidates.length} usable ` +
      `(${blockedCount} blocked, ${staleCount} too old)`,
  );

  return {
    ok: candidates.length > 0,
    reason: candidates.length > 0 ? undefined : 'no_candidates',
    query,
    candidates: candidates.slice(0, limit),
  };
}

export default { fetchNicheNews };
