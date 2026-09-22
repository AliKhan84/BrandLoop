import 'server-only';

import type {
  BillingSummary,
  ContentPlan,
  ContentPlanSummary,
  Coupon,
  CouponKind,
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  GenerateResult,
  LinkCode,
  Platform,
  PlanTier,
  Post,
  PostStatus,
  PostType,
  UsageSummary,
  User,
} from './types';

/**
 * Typed client for the BrandLoop Express API.
 *
 * ## Why every call happens on the server
 *
 * The browser never talks to `localhost:8080` directly. It cannot: the Express
 * app has no CORS middleware, so the browser would block the request before it
 * left. Rather than adding CORS and exposing the API to the internet, this
 * module is the only thing that calls it, from inside Next.js.
 *
 * Two things fall out of that:
 *   • The JWT travels in an httpOnly cookie the browser cannot read.
 *   • The API stays exactly as it was — no CORS, no new headers, no changes.
 *
 * `server-only` makes a Client Component import of this file a build error.
 */

/** Base URL of the Express API. Overridable so the dashboard is not hardcoded to one host. */
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8080';

/**
 * How long to wait on the API before giving up.
 *
 * Set well above the API's own AI timeout (120s) because generation calls
 * legitimately take a minute on the free tier. A shorter client timeout here
 * would abort work the server is still doing, and the user would see a failure
 * for a post that actually generated.
 */
const REQUEST_TIMEOUT_MS = 150_000;

/** The shape the API returns for any 4xx or 5xx. See `middleware/errorHandler.js`. */
interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
}

/**
 * An error thrown by the Express API, carrying its status code.
 *
 * WHY NOT A PLAIN Error: the UI needs to react differently to different
 * failures. A 401 means "your session ended, sign in again"; a 429 means "you
 * are out of quota, here is when it resets"; a 502 means the AI provider
 * failed. Collapsing those into one message string would force the UI to parse
 * text, which breaks the moment the copy changes.
 */
export class ApiError extends Error {
  /** HTTP status returned by the API. */
  readonly statusCode: number;
  /** Machine-readable context the API attached, when it sent any. */
  readonly details?: unknown;

  /**
   * @param statusCode - The HTTP status from the API.
   * @param message - A user-safe message, taken from the API's own response.
   * @param details - Optional extra context, e.g. which quota was exhausted.
   */
  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }

  /** True when the session is missing, expired, or rejected. */
  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }

  /** True when a quota is exhausted. */
  get isQuotaExceeded(): boolean {
    return this.statusCode === 429;
  }

  /** True when the API itself could not be reached, rather than returning an error. */
  get isUnreachable(): boolean {
    return this.statusCode === 0;
  }

  /**
   * True when the API answered but could not serve the request right now.
   *
   * Distinct from a 500 on purpose: the API returns this when its database
   * connection is down, which is an outage rather than a defect, and the same
   * request will usually succeed seconds later. A 500 says "this is broken";
   * this says "try again".
   */
  get isUnavailable(): boolean {
    return this.statusCode === 503;
  }
}

/**
 * Performs one request against the Express API.
 *
 * Every failure path is normalised into an `ApiError` so callers never have to
 * deal with a raw fetch rejection or an unparsed body.
 *
 * @param path - API path beginning with a slash, e.g. `"/api/plans"`.
 * @param options - Request options.
 * @param options.method - HTTP method. Defaults to GET.
 * @param options.body - JSON-serialisable request body.
 * @param options.token - JWT to send as a bearer token. Omit for public routes.
 * @returns The parsed JSON response, typed by the caller.
 * @throws {ApiError} On any non-2xx response, timeout, or connection failure.
 * @sideeffect Makes an outbound HTTP request.
 */
async function request<T>(
  path: string,
  { method = 'GET', body, token }: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // `no-store` because every screen here shows live state — a cached plan
      // would show a slot as pending after it had already generated.
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Distinguish a slow server from a stopped one, because the fix differs:
    // one is "wait", the other is "start the API".
    const isTimeout = (err as Error)?.name === 'TimeoutError';
    throw new ApiError(
      0,
      isTimeout
        ? 'The API took too long to respond. Generation can take up to a minute — try again.'
        : 'Cannot reach the BrandLoop API. Is it running on ' + API_BASE_URL + '?',
    );
  }

  // 204 and empty bodies are legitimate for some routes.
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body from our own API means something upstream intercepted
      // it — a proxy, or the API crashed mid-response.
      throw new ApiError(
        response.status,
        `The API returned an unexpected response (${response.status}).`,
      );
    }
  }

  if (!response.ok) {
    const errorBody = (payload ?? {}) as ApiErrorBody;
    throw new ApiError(
      response.status,
      errorBody.message ?? `Request failed with status ${response.status}.`,
      errorBody.details,
    );
  }

  return payload as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an account and returns a session token.
 *
 * @param input - Registration fields. `inputPoints` is optional but strongly
 *   affects output quality — see the note on `User.inputPoints`.
 * @returns The new user and their token.
 * @throws {ApiError} 409 when the email is already registered.
 * @sideeffect Creates a user in the database.
 */
export async function register(input: {
  email: string;
  password: string;
  name?: string;
  niche?: string;
  inputPoints?: string[];
  postFrequency?: 2 | 3 | 4;
  defaultPlanDuration?: 7 | 30;
}): Promise<{ user: User; token: string }> {
  return request('/api/auth/register', { method: 'POST', body: input });
}

/**
 * Exchanges credentials for a session token.
 *
 * @param input - Email and password.
 * @returns The user and their token.
 * @throws {ApiError} 401 when the credentials do not match.
 * @sideeffect none beyond the database read.
 */
export async function login(input: {
  email: string;
  password: string;
}): Promise<{ user: User; token: string }> {
  return request('/api/auth/login', { method: 'POST', body: input });
}

/**
 * Redeems a verification token from the link in the email.
 *
 * No session token is passed, deliberately: the token *is* the credential, and
 * a verification link is usually opened on whichever device has the mailbox —
 * often one where nobody is signed in.
 *
 * @param token - The raw token from the URL's query string.
 * @returns The confirmed user.
 * @throws {ApiError} 400 when the token is unknown, already used, or expired —
 *   the message distinguishes the last two, because the remedies differ.
 * @sideeffect Marks the address verified; the link is then spent.
 */
export async function verifyEmail(token: string): Promise<{ user: User; emailVerified: true }> {
  return request('/api/auth/verify-email', { method: 'POST', body: { token } });
}

/**
 * Signs in with a Google authorization code.
 *
 * The code is exchanged by the API, not here: that is where the client secret
 * lives, and identity is the API's job. This call is public — there is no token
 * yet, which is the whole point of it.
 *
 * @param code - The one-time `code` Google redirected back with.
 * @returns The account and a session JWT, plus whether it was just created.
 * @throws {ApiError} On an expired code, a misconfigured client, or an outage.
 * @sideeffect Signs the user in on the API side of the exchange.
 */
export async function googleSignIn(
  code: string,
): Promise<{ user: User; token: string; created: boolean }> {
  return request('/api/auth/google', { method: 'POST', body: { code } });
}

/**
 * Asks the API to send a fresh verification link.
 *
 * @param token - The session JWT.
 * @returns Whether it was sent, why not when it was not, and when another
 *   attempt is allowed.
 * @throws {ApiError} 429 when called inside the cooldown.
 * @sideeffect Sends mail and rewrites the stored token.
 */
export async function resendVerification(token: string): Promise<{
  sent: boolean;
  reason?: string;
  nextAllowedAt?: string;
  emailVerified?: boolean;
}> {
  return request('/api/auth/resend-verification', { method: 'POST', token });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans and coupons
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads the plan catalog and where this account stands.
 *
 * The catalog comes from the API rather than from constants in this package:
 * the page used to hold the numbers as literals while the enforced limits lived
 * in the API's config, so editing one left the other advertising a stale figure.
 *
 * @param token - The session JWT.
 * @returns Every tier, plus the caller's effective tier and grants.
 * @throws {ApiError} 401 when the token is rejected.
 * @sideeffect none (read-only)
 */
export async function getBilling(token: string): Promise<BillingSummary> {
  return request('/api/billing', { token });
}

/**
 * Redeems a coupon code for the signed-in account.
 *
 * @param token - The session JWT.
 * @param code - The code as typed; the API normalises case and spacing.
 * @returns What was granted, and the account fields that changed.
 * @throws {ApiError} 400 with the API's own reason when the code cannot be used.
 * @sideeffect Applies the grant to the user.
 */
export async function redeemCoupon(
  token: string,
  code: string,
): Promise<{
  redeemed: { code: string; kind: CouponKind; durationDays: number | null };
  account: {
    plan: PlanTier;
    planExpiresAt: string | null;
    unlimited: boolean;
    unlimitedUntil: string | null;
  };
}> {
  return request('/api/coupons/redeem', { method: 'POST', token, body: { code } });
}

/**
 * Lists coupons. Admin only — the API enforces it, and the page protects itself.
 *
 * @param token - The session JWT.
 * @returns Every coupon, newest first.
 * @throws {ApiError} 403 when the caller is not an administrator.
 * @sideeffect none (read-only)
 */
export async function listCoupons(token: string): Promise<Coupon[]> {
  const { coupons } = await request<{ coupons: Coupon[] }>('/api/admin/coupons', { token });
  return coupons;
}

/**
 * Creates a coupon. Admin only.
 *
 * @param token - The session JWT.
 * @param input - The code (optional — the API generates one), what it grants,
 *   how long for, and how many times it may be used.
 * @returns The created coupon.
 * @throws {ApiError} 409 when the chosen code already exists.
 * @sideeffect Writes a coupon.
 */
export async function createCoupon(
  token: string,
  input: {
    code?: string;
    kind: CouponKind;
    durationDays: number | null;
    maxRedemptions: number | null;
    note?: string;
  },
): Promise<Coupon> {
  const { coupon } = await request<{ coupon: Coupon }>('/api/admin/coupons', {
    method: 'POST',
    token,
    body: input,
  });
  return coupon;
}

/**
 * Enables or disables a coupon. Admin only.
 *
 * @param token - The session JWT.
 * @param couponId - The coupon to change.
 * @param isActive - The new state.
 * @returns The updated coupon.
 * @throws {ApiError} 404 when there is no such coupon.
 * @sideeffect Updates a coupon.
 */
export async function setCouponActive(
  token: string,
  couponId: string,
  isActive: boolean,
): Promise<Coupon> {
  const { coupon } = await request<{ coupon: Coupon }>(`/api/admin/coupons/${couponId}`, {
    method: 'PATCH',
    token,
    body: { isActive },
  });
  return coupon;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sends a message about the product.
 *
 * @param token - The session JWT.
 * @param input - Category, optional rating, the message, and the screen it came from.
 * @returns The stored message.
 * @throws {ApiError} 429 when the daily feedback allowance is spent.
 * @sideeffect Writes a feedback document.
 */
export async function submitFeedback(
  token: string,
  input: {
    category: FeedbackCategory;
    rating: number | null;
    message: string;
    page: string;
  },
): Promise<Feedback> {
  const { feedback } = await request<{ feedback: Feedback }>('/api/feedback', {
    method: 'POST',
    token,
    body: input,
  });
  return feedback;
}

/**
 * Lists every message. Admin only.
 *
 * @param token - The session JWT.
 * @returns Messages, newest first.
 * @throws {ApiError} 403 when the caller is not an administrator.
 * @sideeffect none (read-only)
 */
export async function listFeedback(token: string): Promise<Feedback[]> {
  const { feedback } = await request<{ feedback: Feedback[] }>('/api/admin/feedback', { token });
  return feedback;
}

/**
 * Moves a message through the reading workflow. Admin only.
 *
 * @param token - The session JWT.
 * @param feedbackId - The message to update.
 * @param status - The new status.
 * @param adminNote - A note for the next reader.
 * @returns The updated message.
 * @throws {ApiError} 404 when there is no such message.
 * @sideeffect Updates a feedback document.
 */
export async function setFeedbackStatus(
  token: string,
  feedbackId: string,
  status: FeedbackStatus,
  adminNote = '',
): Promise<Feedback> {
  const { feedback } = await request<{ feedback: Feedback }>(`/api/admin/feedback/${feedbackId}`, {
    method: 'PATCH',
    token,
    body: { status, adminNote },
  });
  return feedback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile and quota
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Loads the signed-in user's profile.
 *
 * @param token - The session JWT.
 * @returns The user.
 * @throws {ApiError} 401 when the token is missing, expired, or rejected.
 * @sideeffect none (read-only)
 */
export async function getMe(token: string): Promise<User> {
  const { user } = await request<{ user: User }>('/api/users/me', { token });
  return user;
}

/**
 * Updates profile fields. Omitted fields are left unchanged.
 *
 * @param token - The session JWT.
 * @param patch - Only the fields to change.
 * @returns The updated user.
 * @throws {ApiError} 400 when the patch is empty or a field is invalid.
 * @sideeffect Writes the user document.
 */
export async function updateMe(
  token: string,
  patch: Partial<Pick<User, 'name' | 'niche' | 'inputPoints' | 'postFrequency' | 'defaultPlanDuration' | 'autoRenewPlan' | 'isActive'>>,
): Promise<User> {
  const { user } = await request<{ user: User }>('/api/users/me', {
    method: 'PATCH',
    token,
    body: patch,
  });
  return user;
}

/**
 * Loads quota state for the signed-in user.
 *
 * WHY THIS EXISTS: the free tier allows 20 requests per day per model, which is
 * low enough that users hit it in normal use. Without this the dashboard could
 * only report an exhausted quota as a failure after the fact; with it, the
 * header can show what is left before the user tries.
 *
 * @param token - The session JWT.
 * @returns Used, limit and remaining for every metered resource.
 * @throws {ApiError} 401 when the token is rejected.
 * @sideeffect none (read-only)
 */
export async function getUsage(token: string): Promise<UsageSummary> {
  const { usage } = await request<{ usage: UsageSummary }>('/api/users/me/usage', { token });
  return usage;
}

/**
 * Issues a short-lived code to pair a Discord account.
 *
 * @param token - The session JWT.
 * @returns The code, its expiry, and the `/connect` instruction to show the user.
 * @throws {ApiError} 401 when the token is rejected.
 * @sideeffect Writes the code onto the user document.
 */
export async function createLinkCode(token: string): Promise<LinkCode> {
  return request('/api/auth/discord/link-code', { method: 'POST', token });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plans
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a new draft plan and consumes one plan-generation quota unit.
 *
 * @param token - The session JWT.
 * @param durationDays - 7 or 30. Falls back to the user's preference when omitted.
 * @returns The new plan, in `draft` status.
 * @throws {ApiError} 429 when the daily plan-generation quota is spent.
 * @sideeffect Calls the AI provider and writes a plan.
 */
export async function createPlan(token: string, durationDays?: 7 | 30): Promise<ContentPlan> {
  const { plan } = await request<{ plan: ContentPlan }>('/api/plans', {
    method: 'POST',
    token,
    body: durationDays ? { durationDays } : {},
  });
  return plan;
}

/**
 * Lists the user's plans, newest first.
 *
 * @param token - The session JWT.
 * @returns Plan summaries, without the slot list.
 * @throws {ApiError} 401 when the token is rejected.
 * @sideeffect none (read-only)
 */
export async function listPlans(token: string): Promise<ContentPlanSummary[]> {
  const { plans } = await request<{ plans: ContentPlanSummary[] }>('/api/plans', { token });
  return plans;
}

/**
 * Loads one plan with every post generated from it.
 *
 * @param token - The session JWT.
 * @param planId - The plan to load.
 * @returns The plan and its posts.
 * @throws {ApiError} 404 when the plan is missing or belongs to someone else.
 * @sideeffect none (read-only)
 */
export async function getPlan(
  token: string,
  planId: string,
): Promise<{ plan: ContentPlan; posts: Post[] }> {
  return request(`/api/plans/${planId}`, { token });
}

/**
 * Approves a draft plan so its slots can be generated.
 *
 * @param token - The session JWT.
 * @param planId - The plan to approve.
 * @returns The approved plan.
 * @throws {ApiError} 409 when the plan is already approved or archived.
 * @sideeffect Writes the plan's status.
 */
export async function approvePlan(token: string, planId: string): Promise<ContentPlan> {
  const { plan } = await request<{ plan: ContentPlan }>(`/api/plans/${planId}/approve`, {
    method: 'PATCH',
    token,
  });
  return plan;
}

/**
 * Generates one slot's posts on demand, without waiting for the daily job.
 *
 * Slow by nature — the free tier takes 30-60s for a two-platform slot. The
 * client timeout is set with that in mind.
 *
 * @param token - The session JWT.
 * @param planId - The plan owning the slot.
 * @param dayIndex - Which slot to generate. Omit for the next pending one.
 * @returns What was generated, and why anything was skipped.
 * @throws {ApiError} 429 when a quota is exhausted; 409 when the plan is not approved.
 * @sideeffect Calls the AI provider, writes posts, sends Discord DMs.
 */
export async function generateSlot(
  token: string,
  planId: string,
  dayIndex?: number,
): Promise<GenerateResult> {
  return request(`/api/plans/${planId}/generate`, {
    method: 'POST',
    token,
    body: dayIndex === undefined ? {} : { dayIndex },
  });
}

/**
 * Archives a plan. The record and its posts are retained.
 *
 * @param token - The session JWT.
 * @param planId - The plan to archive.
 * @returns The archived plan.
 * @throws {ApiError} 404 when the plan is not the user's.
 * @sideeffect Writes the plan's status.
 */
export async function archivePlan(token: string, planId: string): Promise<ContentPlan> {
  const { plan } = await request<{ plan: ContentPlan }>(`/api/plans/${planId}`, {
    method: 'DELETE',
    token,
  });
  return plan;
}

/**
 * Edits one slot's angle or type, before it has been generated.
 *
 * @param token - The session JWT.
 * @param planId - The plan owning the slot.
 * @param dayIndex - Which slot to edit.
 * @param patch - Only the fields to change.
 * @returns The updated plan.
 * @throws {ApiError} 409 when the slot has already been generated.
 * @sideeffect Writes the plan.
 */
export async function updateSlot(
  token: string,
  planId: string,
  dayIndex: number,
  patch: { theme?: string; type?: PostType },
): Promise<ContentPlan> {
  const { plan } = await request<{ plan: ContentPlan }>(
    `/api/plans/${planId}/slots/${dayIndex}`,
    { method: 'PATCH', token, body: patch },
  );
  return plan;
}

/**
 * Replaces a draft's body.
 *
 * The API re-renders the post's Discord message as part of this call, so the DM
 * and the dashboard never show different text for the same draft.
 *
 * @param token - The session JWT.
 * @param postId - The post to edit.
 * @param content - The new body.
 * @returns The updated post.
 * @throws {ApiError} 409 when the post has already been actioned; 400 when the
 *   content is empty or over the platform limit.
 * @sideeffect Writes the post and edits its Discord message.
 */
export async function updatePost(
  token: string,
  postId: string,
  content: string,
): Promise<Post> {
  const { post } = await request<{ post: Post }>(`/api/posts/${postId}`, {
    method: 'PATCH',
    token,
    body: { content },
  });
  return post;
}

/**
 * Loads one post in full.
 *
 * @param token - The session JWT.
 * @param postId - The post to load.
 * @returns The post.
 * @throws {ApiError} 404 when the post is missing or belongs to someone else.
 * @sideeffect none (read-only)
 */
export async function getPost(token: string, postId: string): Promise<Post> {
  const { post } = await request<{ post: Post }>(`/api/posts/${postId}`, { token });
  return post;
}

// ─────────────────────────────────────────────────────────────────────────────
// Posts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lists the user's posts, newest first.
 *
 * @param token - The session JWT.
 * @param filters - Optional status and platform filters.
 * @returns The matching posts.
 * @throws {ApiError} 400 when a status value is not recognised.
 * @sideeffect none (read-only)
 */
export async function listPosts(
  token: string,
  filters: { status?: PostStatus; platform?: Platform } = {},
): Promise<Post[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.platform) params.set('platform', filters.platform);

  const query = params.toString();
  const { posts } = await request<{ posts: Post[] }>(
    `/api/posts${query ? `?${query}` : ''}`,
    { token },
  );
  return posts;
}

export { API_BASE_URL };
