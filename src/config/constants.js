/**
 * Application constants — the fixed vocabulary of the domain.
 *
 * RESPONSIBILITY
 *   Hold every value that is structural rather than configurable: status
 *   strings, platform limits, the content-mix ratio, and the prompt fragments
 *   that keep generated posts on-brand.
 *
 * WHY CONSTANTS FOR STATUS STRINGS
 *   These strings are written into MongoDB documents and compared in the
 *   Discord interaction router. A single typo in one comparison produces a
 *   button that silently does nothing. Exporting them means a typo is a
 *   ReferenceError at startup instead of a dead button in production.
 *
 * WHERE VALUES COME FROM
 *   Anything an operator might want to change without editing code lives in
 *   `env.js` and is re-exported here under a domain name. Anything the code
 *   depends on structurally is hard-coded here.
 *
 * DOES NOT OWN: secrets, model names, or quota *values* — it only names them.
 */

import { env } from './env.js';

// ─────────────────────────────────────────────────────────────────────────────
// Enumerations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The social platforms a post can target.
 * Used as a MongoDB enum and as the dispatch key in `services/publishing`.
 */
export const PLATFORM = Object.freeze({
  X: 'x',
  LINKEDIN: 'linkedin',
});

/** Every platform, in the order drafts should be generated and delivered. */
export const PLATFORMS = Object.freeze([PLATFORM.X, PLATFORM.LINKEDIN]);

/**
 * How many continuation parts a thread may have, beyond the root.
 *
 * Four posts is the most most people read before the point has landed, and the
 * whole thread still fits inside one Discord message (~1120 characters at the
 * X limit, against Discord's 2000) so the user can see all of it at once before
 * approving. A model that returns more is trimmed rather than trusted.
 */
export const MAX_THREAD_REPLIES = 3;

/**
 * Lifecycle of a single content plan.
 * `draft` → awaiting user approval; `approved` → the scheduler may generate it.
 */
export const PLAN_STATUS = Object.freeze({
  DRAFT: 'draft',
  APPROVED: 'approved',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
});

/**
 * Lifecycle of one posting slot inside a plan.
 * Independent of the posts generated from it — a slot can hold a rejected
 * post and still be `generated`.
 */
export const SLOT_STATUS = Object.freeze({
  PENDING: 'pending',
  GENERATED: 'generated',
  SKIPPED: 'skipped',
});

/**
 * Lifecycle of a single platform post.
 * `pending_approval` is the only state in which the Discord buttons act —
 * this is what makes Approve idempotent against double clicks.
 */
export const POST_STATUS = Object.freeze({
  PENDING_APPROVAL: 'pending_approval',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  FAILED: 'failed',
});

/**
 * What the post is based on.
 * PRD §4 fixes the mix at one `news` post per week; everything else is
 * `planned` from the user's theme list.
 */
export const POST_TYPE = Object.freeze({
  PLANNED: 'planned',
  NEWS: 'news',
});

/**
 * How the post reaches the platform.
 * Only `assisted` exists today — the user posts it themselves via a prefilled
 * composer link. `api` is reserved for the deferred Phase 2 groundwork.
 */
export const PUBLISH_METHOD = Object.freeze({
  ASSISTED: 'assisted',
  API: 'api',
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform limits
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hard character ceilings per platform.
 *
 * These are enforced by `utils/text.js#enforcePlatformLimit`, which truncates
 * on a sentence boundary. The model is *asked* to stay under the limit, but
 * this is the last word — several models still overshoot on long themes.
 */
export const PLATFORM_LIMITS = Object.freeze({
  [PLATFORM.X]: env.X_CHAR_LIMIT,
  [PLATFORM.LINKEDIN]: env.LINKEDIN_CHAR_LIMIT,
});

/**
 * Human-readable platform names, for Discord embeds and composer labels.
 * Kept separate from `PLATFORM` so the stored value stays stable while the
 * display name can change freely.
 */
export const PLATFORM_LABELS = Object.freeze({
  [PLATFORM.X]: 'X (Twitter)',
  [PLATFORM.LINKEDIN]: 'LinkedIn',
});

/**
 * Recommended hashtag counts per platform.
 * X posts with many tags read as spam; LinkedIn tolerates more. Used as a
 * prompt hint only — never enforced as a hard cap.
 */
export const HASHTAG_GUIDANCE = Object.freeze({
  [PLATFORM.X]: '1 to 2',
  [PLATFORM.LINKEDIN]: '3 to 5',
});

// ─────────────────────────────────────────────────────────────────────────────
// Content mix (PRD §4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Security of the weekly content mix.
 *
 * `NEWS_POSTS_PER_WEEK` is fixed at 1 by PRD §4. It is deliberately a
 * constant rather than an env var so the ratio cannot drift silently — the
 * PRD treats it as a product decision, not a deployment setting.
 */
export const CONTENT_MIX = Object.freeze({
  NEWS_POSTS_PER_WEEK: 1,
});

/** Plan durations the API accepts, in calendar days (PRD §5). */
export const VALID_PLAN_DURATIONS = Object.freeze([7, 30]);

/** Posting frequencies the API accepts, in posts per week (PRD §5). */
export const VALID_POST_FREQUENCIES = Object.freeze([2, 3, 4]);

// ─────────────────────────────────────────────────────────────────────────────
// Quotas (PRD §7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quota bucket names.
 *
 * Used as the `key` in the `Usage` collection, so these strings appear in
 * stored data — rename one and existing counters stop matching. `images`
 * exists now even though Phase 3 is deferred, so enabling it later needs no
 * data change.
 */
export const QUOTA_KEY = Object.freeze({
  PLAN_GENERATIONS: 'planGenerations',
  NEWS_LOOKUPS: 'newsLookups',
  IMAGES: 'images',
  // Feedback is metered for a different reason to the others: nothing is paid
  // for, but an unbounded writer is an inbox nobody will read.
  FEEDBACK: 'feedback',
});

/**
 * The rolling window each quota is measured over.
 * Daily buckets reset at UTC midnight; the weekly image bucket resets on
 * Monday, matching the PRD's "per week" phrasing.
 */
export const QUOTA_PERIOD = Object.freeze({
  DAY: 'day',
  WEEK: 'week',
});

/** Per-user limits, resolved from env so they can be tuned per deployment. */
export const QUOTAS = Object.freeze({
  [QUOTA_KEY.PLAN_GENERATIONS]: Object.freeze({
    limit: env.QUOTA_PLAN_GENERATIONS_PER_DAY,
    period: QUOTA_PERIOD.DAY,
  }),
  [QUOTA_KEY.NEWS_LOOKUPS]: Object.freeze({
    limit: env.QUOTA_NEWS_LOOKUPS_PER_DAY,
    period: QUOTA_PERIOD.DAY,
  }),
  [QUOTA_KEY.IMAGES]: Object.freeze({
    limit: env.QUOTA_IMAGES_PER_WEEK,
    period: QUOTA_PERIOD.WEEK,
  }),
  [QUOTA_KEY.FEEDBACK]: Object.freeze({
    limit: env.QUOTA_FEEDBACK_PER_DAY,
    period: QUOTA_PERIOD.DAY,
  }),
});

/** Reject attempts allowed per post before the slot is parked for the cycle. */
export const MAX_REGENERATIONS_PER_POST = env.MAX_REGENERATIONS_PER_POST;

// ─────────────────────────────────────────────────────────────────────────────
// Plans, roles and coupons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Account roles.
 *
 * A string on the user document rather than a roles collection: there are two
 * values and they change by hand. The JWT never carries a role — `requireAuth`
 * re-reads the user on every request, so `requireAdmin` sees the current value
 * and a demotion takes effect immediately rather than at token expiry.
 */
export const USER_ROLE = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
});

/** Subscription tiers. Stored on the user as `plan`. */
export const PLAN_TIER = Object.freeze({
  FREE: 'free',
  CREATOR: 'creator',
  PRO: 'pro',
});

/** What redeeming a coupon grants. */
export const COUPON_KIND = Object.freeze({
  /** A period of the Pro tier — the same thing the $10 plan buys. */
  PRO: 'pro',
  /** Every metered quota bypassed, for a period or forever. */
  UNLIMITED: 'unlimited',
});

/**
 * Lifecycle of a purchase claim.
 *
 * `pending` carries the interesting distinction: without `grantedAt` nothing has
 * been given to the customer and an operator still has to verify; with it, the
 * plan is already live and the operator's only job is to reconcile the money.
 * Two states in one status, because they are the same point in the workflow —
 * "not yet settled" — and splitting them would mean two ways to ask "what still
 * needs attention".
 */
export const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  /** The money was found. Nothing changes for the customer. */
  VERIFIED: 'verified',
  /** No money was found, and nothing had been granted. */
  REJECTED: 'rejected',
  /** The grant was taken back because the money never arrived. */
  REVOKED: 'revoked',
});

/**
 * How a customer can pay.
 *
 * Deliberately the three that need no merchant account: a bank transfer or Raast
 * to an account number, or a transfer from either wallet. Every one of them is
 * confirmed by a human reading their own statement, which is the honest limit of
 * what can be automated without a processor contract.
 */
export const PAYMENT_METHOD = Object.freeze({
  BANK: 'bank',
  JAZZCASH: 'jazzcash',
  EASYPAISA: 'easypaisa',
});

/** Display names for the payment methods, on the pay page and in the admin DM. */
export const PAYMENT_METHOD_LABELS = Object.freeze({
  [PAYMENT_METHOD.BANK]: 'Bank transfer / Raast',
  [PAYMENT_METHOD.JAZZCASH]: 'JazzCash',
  [PAYMENT_METHOD.EASYPAISA]: 'Easypaisa',
});

/**
 * Where a claim came from.
 *
 * `manual` is the only value this build produces. `gateway` exists so that the
 * day a processor is integrated, its webhook can write the same record and call
 * the same grant path instead of introducing a second one — one field now, in
 * place of a migration later.
 */
export const PAYMENT_SOURCE = Object.freeze({
  MANUAL: 'manual',
  GATEWAY: 'gateway',
});

/**
 * The four things an operator can decide about a claim.
 *
 * Two pairs, because a claim has two shapes and the decision has to match it. A
 * claim that granted a plan can be confirmed or revoked; one that granted
 * nothing can be verified or rejected. `verify` and `confirm` both end at
 * `verified`, which is why the decisions cannot simply be the statuses — one of
 * them grants, the other only records what already happened.
 */
export const PAYMENT_DECISION = Object.freeze({
  /** Grant now. Only valid while nothing has been granted. */
  VERIFY: 'verify',
  /** No money found, nothing was granted. The claim closes. */
  REJECT: 'reject',
  /** The money was found. Nothing changes for the customer. */
  CONFIRM: 'confirm',
  /** No money found after a grant — take the plan back. */
  REVOKE: 'revoke',
});

/**
 * The plan catalog.
 *
 * ## Why the free tier reads env
 *
 * Free keeps the existing `QUOTA_*` values, so nothing about a current account's
 * allowance changes when plans arrive. Creator and Pro are fixed here, because a
 * published price has to mean a fixed quantity — a tier whose limits moved with
 * a deployment's env would make the billing page a guess.
 *
 * These are the numbers the dashboard shows. It reads them from the API rather
 * than repeating them, so a price and its limits cannot drift apart.
 *
 * ## Why there are two prices
 *
 * `price` is the catalog's original USD figure and stays frozen, so nothing that
 * already quoted it changes meaning. `pricePkr` is what this deployment actually
 * charges, because the local payment methods are in rupees — and it is what the
 * pay page and the claim record use. `durationDays` is null for free (nothing is
 * sold) and the purchased term for the paid tiers.
 */
export const PLANS = Object.freeze({
  [PLAN_TIER.FREE]: Object.freeze({
    tier: PLAN_TIER.FREE,
    name: 'Free',
    price: 0,
    pricePkr: 0,
    durationDays: null,
    limits: Object.freeze({
      [QUOTA_KEY.PLAN_GENERATIONS]: QUOTAS[QUOTA_KEY.PLAN_GENERATIONS].limit,
      [QUOTA_KEY.NEWS_LOOKUPS]: QUOTAS[QUOTA_KEY.NEWS_LOOKUPS].limit,
      [QUOTA_KEY.IMAGES]: QUOTAS[QUOTA_KEY.IMAGES].limit,
    }),
  }),
  [PLAN_TIER.CREATOR]: Object.freeze({
    tier: PLAN_TIER.CREATOR,
    name: 'Creator',
    price: 5,
    pricePkr: env.PRICE_CREATOR_PKR,
    durationDays: env.PAYMENT_PLAN_DAYS,
    limits: Object.freeze({
      [QUOTA_KEY.PLAN_GENERATIONS]: 15,
      [QUOTA_KEY.NEWS_LOOKUPS]: 10,
      [QUOTA_KEY.IMAGES]: 30,
    }),
  }),
  [PLAN_TIER.PRO]: Object.freeze({
    tier: PLAN_TIER.PRO,
    name: 'Pro',
    price: 10,
    pricePkr: env.PRICE_PRO_PKR,
    durationDays: env.PAYMENT_PLAN_DAYS,
    limits: Object.freeze({
      [QUOTA_KEY.PLAN_GENERATIONS]: 40,
      [QUOTA_KEY.NEWS_LOOKUPS]: 20,
      [QUOTA_KEY.IMAGES]: 100,
    }),
  }),
});

/**
 * How long a purchase's effect stays reversible, in the operator's words.
 *
 * Not a timer that revokes anything — a promise shown to the customer about how
 * soon the operator will have looked at their statement.
 */
export const PAYMENT_REVIEW_HOURS = env.PAYMENT_REVIEW_HOURS;

/**
 * The order the tiers sit in, cheapest first.
 *
 * Used to answer "is this an upgrade, a renewal, or a downgrade" without
 * repeating the ordering in every caller. A list rather than a number per tier
 * so adding a tier means adding one entry in one place.
 */
export const TIER_RANK = Object.freeze([PLAN_TIER.FREE, PLAN_TIER.CREATOR, PLAN_TIER.PRO]);

/**
 * The tiers that can be bought.
 *
 * Free is not a purchase — it is what an account falls back to — and selling it
 * would only be a way to take money for nothing.
 */
export const PURCHASABLE_TIERS = Object.freeze([PLAN_TIER.CREATOR, PLAN_TIER.PRO]);

/**
 * Days of Pro every new signup receives.
 *
 * A deliberate spend decision rather than a marketing default: Pro's ceilings
 * are high, and image generation is the expensive call (~$0.04 each). Set it to
 * 0 to switch the grant off.
 */
export const SIGNUP_TRIAL_DAYS = env.SIGNUP_TRIAL_DAYS;

// ─────────────────────────────────────────────────────────────────────────────
// Images (Phase 3 — deferred; sizes retained so enabling it needs no edits)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Target image dimensions per platform.
 *
 * Both are multiples of 16 and sit between a 1:3 and 3:1 aspect ratio, which
 * is the documented constraint band for image generation APIs. X wants a wide
 * landscape card; LinkedIn's feed favours a square.
 */
export const IMAGE_SIZES = Object.freeze({
  [PLATFORM.X]: Object.freeze({ width: 1536, height: 1024, label: '1536x1024' }),
  [PLATFORM.LINKEDIN]: Object.freeze({ width: 1024, height: 1024, label: '1024x1024' }),
});

/** Directory generated images are written to, relative to the project root. */
export const MEDIA_DIR = 'media';

/**
 * Appended to every image prompt to hold the visual identity steady.
 *
 * WHY: without a fixed suffix, consecutive posts from the same account look
 * like they came from different brands. Restating the palette and the explicit
 * "no text" instruction also works around the model's unreliable lettering.
 */
export const IMAGE_STYLE_SUFFIX =
  'Clean modern flat vector illustration. Teal, navy and warm-white palette. ' +
  'Generous negative space, simple geometric shapes, soft shadows. ' +
  'Do not include any text, letters, numbers, watermarks or logos.';

// ─────────────────────────────────────────────────────────────────────────────
// Discord
// ─────────────────────────────────────────────────────────────────────────────

/** Max characters Discord allows inside a single embed field value. */
export const DISCORD_EMBED_FIELD_LIMIT = 1024;

/**
 * Max characters Discord allows in one message's content.
 *
 * Relevant to threads: a four-part thread rendered as labelled copy blocks is
 * roughly 1120 characters at the X limit, which fits — but the X limit is
 * configuration, so this is checked rather than assumed.
 *
 * Also the reason a long LinkedIn post could not be delivered at all: a 3000
 * character post fenced as a code block exceeds this, and Discord rejects the
 * whole message with error 50035 rather than truncating it.
 */
export const DISCORD_CONTENT_LIMIT = 2000;

/**
 * Max characters Discord allows in an embed description.
 *
 * The fallback target for a post too long to sit in `content`. It is comfortably
 * above the 3000-character LinkedIn ceiling, so a full post always fits.
 */
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;

/**
 * Discord's interaction acknowledgement deadline, in milliseconds.
 *
 * Every button handler must `defer` before this elapses or Discord shows the
 * user "This interaction failed". Regeneration takes seconds, so the defer is
 * mandatory rather than a nice-to-have.
 */
export const DISCORD_INTERACTION_TIMEOUT_MS = 3000;

/** Discord colour codes for embed sidebars, by post state. */
export const EMBED_COLOR = Object.freeze({
  PENDING: 0x5865f2,
  APPROVED: 0x57f287,
  REJECTED: 0xed4245,
  NEWS: 0xfee75c,
});

// ─────────────────────────────────────────────────────────────────────────────
// Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Network timeout for a single AI call, in milliseconds.
 *
 * WHY 120s: measured latency on this key ranges from ~2.5s to over 90s for
 * identical requests — a 1-field schema took 37s while a larger post schema
 * took 5.7s, so the variance is queueing on the provider side, not payload
 * size. A tighter timeout aborts requests that would have succeeded. The
 * provider layer retries a timeout as the transient failure it is.
 */
export const AI_REQUEST_TIMEOUT_MS = 120_000;

/** Network timeout for the news RSS fetch, in milliseconds. */
export const NEWS_FETCH_TIMEOUT_MS = 15_000;

/** How many feed items to consider before ranking and choosing one. */
export const NEWS_CANDIDATE_LIMIT = 25;

/**
 * Publisher domains dropped from news results.
 *
 * Aggregators and content farms produce summaries of summaries, which make for
 * a weak post and a weak citation. Filtering at the source is cheaper than
 * filtering after the model has already written about it.
 */
export const NEWS_BLOCKED_DOMAINS = Object.freeze([
  'msn.com',
  'yahoo.com',
  'biztoc.com',
  'flipboard.com',
  'newsbreak.com',
  'medium.com',
]);

export default {
  PLATFORM,
  PLATFORMS,
  MAX_THREAD_REPLIES,
  PLAN_STATUS,
  SLOT_STATUS,
  POST_STATUS,
  POST_TYPE,
  PUBLISH_METHOD,
  PLATFORM_LIMITS,
  PLATFORM_LABELS,
  HASHTAG_GUIDANCE,
  CONTENT_MIX,
  VALID_PLAN_DURATIONS,
  VALID_POST_FREQUENCIES,
  QUOTA_KEY,
  QUOTA_PERIOD,
  QUOTAS,
  MAX_REGENERATIONS_PER_POST,
  USER_ROLE,
  PLAN_TIER,
  COUPON_KIND,
  PAYMENT_STATUS,
  PAYMENT_METHOD,
  PAYMENT_METHOD_LABELS,
  PAYMENT_SOURCE,
  PAYMENT_DECISION,
  PAYMENT_REVIEW_HOURS,
  TIER_RANK,
  PURCHASABLE_TIERS,
  PLANS,
  SIGNUP_TRIAL_DAYS,
  IMAGE_SIZES,
  MEDIA_DIR,
  IMAGE_STYLE_SUFFIX,
  DISCORD_EMBED_FIELD_LIMIT,
  DISCORD_CONTENT_LIMIT,
  DISCORD_EMBED_DESCRIPTION_LIMIT,
  DISCORD_INTERACTION_TIMEOUT_MS,
  EMBED_COLOR,
  AI_REQUEST_TIMEOUT_MS,
  NEWS_FETCH_TIMEOUT_MS,
  NEWS_CANDIDATE_LIMIT,
  NEWS_BLOCKED_DOMAINS,
};
