/**
 * Types mirroring the Express API's `toPublicJSON()` output.
 *
 * WHY THESE ARE HAND-WRITTEN RATHER THAN INFERRED
 *   The dashboard and the API are separate packages with no shared build step,
 *   so there is no compiler link between them. These declarations are the
 *   contract. If a field is renamed in `src/models/*.js` the dashboard will not
 *   fail to build — it will silently render `undefined`. Keeping them in one
 *   file next to a comment naming the source method makes that drift easy to
 *   spot when something looks wrong on screen.
 *
 * Source of truth for each:
 *   User        → src/models/User.js        toPublicJSON()
 *   ContentPlan → src/models/ContentPlan.js toPublicJSON()
 *   Post        → src/models/Post.js        toPublicJSON()
 */

/** The platforms a post can target. Mirrors `PLATFORM` in the API's constants. */
export type Platform = 'x' | 'linkedin';

/** Lifecycle of a content plan. */
export type PlanStatus = 'draft' | 'approved' | 'completed' | 'archived';

/** Whether a slot is planned from the user's themes, or tied to a news story. */
export type PostType = 'planned' | 'news';

/** Lifecycle of one posting slot within a plan. */
export type SlotStatus = 'pending' | 'generated' | 'skipped';

/** Lifecycle of a single generated post. */
export type PostStatus = 'pending_approval' | 'approved' | 'rejected' | 'failed';

/** An account, as returned by `/api/users/me`. */
export interface User {
  id: string;
  email: string;
  name: string;
  /** The user's field, e.g. "AI in healthcare". Drives every generation. */
  niche: string;
  /**
   * The user's own opinions and anecdotes. The single biggest lever on output
   * quality — without these the generated posts read as generic commentary.
   */
  inputPoints: string[];
  postFrequency: 2 | 3 | 4;
  defaultPlanDuration: 7 | 30;
  platforms: Platform[];
  timezone: string;
  /** True once the Discord account has been paired. */
  discordLinked: boolean;
  /**
   * True once the user has clicked the link sent to their address.
   *
   * Verification is soft: an unverified account is fully usable and the shell
   * shows a banner asking it to confirm. Nothing in the dashboard is gated on
   * this — see the note in `src/services/email/verification.js`.
   */
  emailVerified: boolean;
  isActive: boolean;
  autoRenewPlan: boolean;
  createdAt: string;
}

/** One posting slot inside a plan. */
export interface PlanDay {
  /** 1-based slot ordinal. Stable across regenerations. */
  dayIndex: number;
  /** 0-based calendar offset from the plan start. */
  dayOfPlan: number;
  theme: string;
  type: PostType;
  status: SlotStatus;
  newsHeadline: string | null;
  newsUrl: string | null;
  newsSourceName: string | null;
  /**
   * Why the last generation attempt left this slot incomplete, or null when it
   * was clean. Survives the toast that reports it, so a slot that keeps failing
   * can explain itself.
   */
  lastSkipReason: string | null;
}

/** Slot counts for a plan, computed server-side. */
export interface PlanProgress {
  total: number;
  pending: number;
  generated: number;
  skipped: number;
}

/** A content plan. */
export interface ContentPlan {
  id: string;
  durationDays: 7 | 30;
  postFrequency: 2 | 3 | 4;
  status: PlanStatus;
  summary: string;
  startDate: string;
  endDate: string | null;
  approvedAt: string | null;
  progress: PlanProgress;
  days: PlanDay[];
  createdAt: string;
}

/** Plan summary as returned by `GET /api/plans`. */
export interface ContentPlanSummary {
  id: string;
  status: PlanStatus;
  durationDays: 7 | 30;
  postFrequency: 2 | 3 | 4;
  summary: string;
  progress: PlanProgress;
  createdAt: string;
}

/** A generated post. */
export interface Post {
  id: string;
  planId: string;
  dayIndex: number;
  platform: Platform;
  type: PostType;
  theme: string;
  /** The post body, already fitted to the platform's character limit. */
  content: string;
  /**
   * Continuation parts, posted as replies to `content`. Empty for a single post.
   * X only — LinkedIn has no thread concept in this build.
   */
  thread: string[];
  hashtags: string[];
  /** Body plus hashtags — the exact text that will be published. */
  fullText: string;
  status: PostStatus;
  publishMethod: 'assisted' | 'api';
  /**
   * Citation for a news post. Always a real URL from the RSS feed — the model
   * is never allowed to author this field.
   */
  sourceNewsUrl: string | null;
  sourceNewsTitle: string | null;
  sourceNewsName: string | null;
  /**
   * Whether the text model asked for an accompanying image on this post.
   * True with no `imageUrl` means the image failed or the quota was spent.
   */
  needsImage: boolean;
  /**
   * The image's public URL on the API. Display-only from the browser: the API
   * has no CORS, so the bytes are read through this dashboard's own proxy route
   * instead when they are needed for the clipboard.
   */
  imageUrl: string | null;
  /**
   * Why a requested image is missing, or null when one was made or none was
   * asked for. Shown on the compose page so a text-only draft reads as degraded
   * rather than broken.
   */
  imageSkipReason: string | null;
  regenerationCount: number;
  publishedAt: string | null;
  createdAt: string;
}

/** One quota bucket, as returned by `/api/users/me/usage`. */
export interface QuotaEntry {
  used: number;
  limit: number;
  remaining: number;
  period: 'day' | 'week';
}

/** Quota state for every metered resource. */
export interface UsageSummary {
  planGenerations: QuotaEntry;
  newsLookups: QuotaEntry;
  images: QuotaEntry;
}

/** The response from creating a Discord link code. */
export interface LinkCode {
  code: string;
  expiresAt: string;
  instructions: string;
}

/** The payload returned when a slot is generated on demand. */
export interface GenerateResult {
  dayIndex: number;
  generated: Post[];
  /** Reasons why a platform was skipped, e.g. an exhausted news quota. */
  skipped: string[];
}
