'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import * as api from './api';
import { ApiError } from './api';
import { clearSessionToken, getSessionToken, setSessionToken } from './session';
import type { ActionState } from './action-state';

/**
 * Server Actions for every write in the dashboard.
 *
 * ## Why actions rather than route handlers
 *
 * The plan called for `/api/auth/login` and friends as Route Handlers. Actions
 * are the better instrument here and satisfy the same constraints:
 *
 *   • They can set the httpOnly cookie directly, so the JWT still never reaches
 *     the browser.
 *   • They run on the server, so the API is still called server-to-server and
 *     still needs no CORS.
 *   • The form works with **JavaScript disabled**, because the browser posts it
 *     natively. A fetch-based handler cannot do that.
 *   • `useActionState` gives pending and error state without hand-rolled
 *     loading booleans in every form.
 *
 * `redirect()` is called outside `try` blocks throughout. It works by throwing
 * a control-flow signal, so catching it would silently swallow the navigation.
 */

/**
 * Turns an API error into form state.
 *
 * WHY THIS EXISTS: the API returns field-level detail as an array of
 * `{ field, message }` when a request body fails validation. Surfacing those
 * inline next to the offending input is far more useful than one summary line,
 * and it means the dashboard does not have to re-implement the API's own
 * validation rules.
 *
 * @param err - The caught value.
 * @returns Form state describing what went wrong.
 * @sideeffect none (pure)
 */
function toActionState(err: unknown): ActionState {
  if (err instanceof ApiError) {
    // 400s from `validateBody` carry a per-field breakdown.
    if (err.statusCode === 400 && Array.isArray(err.details)) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.details as Array<{ field?: string; message?: string }>) {
        if (issue?.field && issue?.message) fieldErrors[issue.field] = issue.message;
      }
      if (Object.keys(fieldErrors).length > 0) {
        return { error: 'Please fix the highlighted fields.', fieldErrors };
      }
    }
    return { error: err.message };
  }

  return { error: 'Something went wrong. Please try again.' };
}

/**
 * Signs a new user up and starts their session.
 *
 * @param _prev - Previous form state, supplied by `useActionState`.
 * @param formData - The submitted signup form.
 * @returns Form state on failure. On success this never returns — it redirects.
 * @sideeffect Creates a user, sets the session cookie, redirects.
 */
export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '').trim();

  let token: string;

  try {
    const result = await api.register({ email, password, name });
    token = result.token;
  } catch (err) {
    return toActionState(err);
  }

  await setSessionToken(token);
  // New accounts have no profile yet, so settings is where they need to be —
  // the workspace would be an empty state with nothing to explain it.
  redirect('/settings?welcome=1');
}

/**
 * Signs an existing user in.
 *
 * @param _prev - Previous form state, supplied by `useActionState`.
 * @param formData - The submitted login form.
 * @returns Form state on failure. On success this never returns — it redirects.
 * @sideeffect Sets the session cookie and redirects.
 */
export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  let token: string;

  try {
    const result = await api.login({ email, password });
    token = result.token;
  } catch (err) {
    return toActionState(err);
  }

  await setSessionToken(token);
  redirect('/workspace');
}

/**
 * Ends the session and returns to the login screen.
 *
 * @returns Never returns — always redirects.
 * @sideeffect Clears the session cookie and redirects.
 */
export async function signOutAction(): Promise<void> {
  await clearSessionToken();
  redirect('/login');
}

/**
 * Sends a fresh verification link to the signed-in user's address.
 *
 * Reports the API's own answer rather than assuming success. Three outcomes
 * matter and only one of them is "an email is on its way": the address may
 * already be confirmed, or this deployment may have no mail credentials at all —
 * in which case the link was written to the server log and saying "sent" would
 * be a straight lie to the user.
 *
 * Takes no arguments on purpose: the address is the session's own, so there is
 * nothing for the form to carry. `useActionState` still calls it with
 * `(state, formData)` — both are ignored, and declaring parameters that are
 * never read would only produce lint warnings.
 *
 * @returns Form state describing what happened.
 * @sideeffect Sends mail through the API.
 */
export async function resendVerificationAction(): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  let result: Awaited<ReturnType<typeof api.resendVerification>>;

  try {
    result = await api.resendVerification(token);
  } catch (err) {
    // Covers the 429 cooldown too — the API's message says how long to wait, and
    // it is more specific than anything this layer could invent.
    return toActionState(err);
  }

  if (result.emailVerified) {
    return { error: null, success: 'This address is already confirmed.' };
  }

  if (!result.sent) {
    return {
      error: null,
      success:
        result.reason === 'smtp-not-configured'
          ? 'Email is not set up on this deployment, so the link was written to the server log instead.'
          : 'The message could not be sent just now. Please try again in a moment.',
    };
  }

  return { error: null, success: 'Sent — check your inbox.' };
}

/**
 * Redeems a coupon code for the signed-in account.
 *
 * The success message names what was granted, because "Redeemed" alone leaves
 * the user to go and check whether it worked.
 *
 * @param _prev - Previous form state, supplied by `useActionState`.
 * @param formData - The submitted form, carrying `code`.
 * @returns Form state describing what happened.
 * @sideeffect Applies the grant through the API.
 */
export async function redeemCouponAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'Enter a code.', fieldErrors: { code: 'Enter a code.' } };

  try {
    const result = await api.redeemCoupon(token, code);

    // The quota meter and the plan cards both read the account, so the whole
    // shell is revalidated rather than just this page.
    revalidatePath('/', 'layout');

    const grant = result.account.unlimited
      ? result.account.unlimitedUntil
        ? `Unlimited until ${new Date(result.account.unlimitedUntil).toLocaleDateString()}.`
        : 'Unlimited access, with no end date.'
      : result.account.planExpiresAt
        ? `${result.account.plan} until ${new Date(result.account.planExpiresAt).toLocaleDateString()}.`
        : `${result.account.plan}, with no end date.`;

    return { error: null, success: `${result.redeemed.code} applied — ${grant}` };
  } catch (err) {
    return toActionState(err);
  }
}

/**
 * Creates a coupon. Admin only.
 *
 * @param _prev - Previous form state.
 * @param formData - The submitted form.
 * @returns Form state, with the generated code in the success message when the
 *   operator left the code field empty.
 * @sideeffect Writes a coupon through the API.
 */
export async function createCouponAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  const rawDuration = String(formData.get('durationDays') ?? '').trim();
  const rawMax = String(formData.get('maxRedemptions') ?? '').trim();

  try {
    const coupon = await api.createCoupon(token, {
      code: String(formData.get('code') ?? '').trim() || undefined,
      kind: String(formData.get('kind') ?? 'pro') === 'unlimited' ? 'unlimited' : 'pro',
      // Empty means "no limit" for both of these — the schema treats null as
      // forever/no-cap, so an empty field must not become 0.
      durationDays: rawDuration ? Number(rawDuration) : null,
      maxRedemptions: rawMax ? Number(rawMax) : null,
      note: String(formData.get('note') ?? '').trim(),
    });

    revalidatePath('/admin/coupons');
    return { error: null, success: `Created ${coupon.code}.` };
  } catch (err) {
    return toActionState(err);
  }
}

/**
 * Enables or disables a coupon. Admin only.
 *
 * @param _prev - Previous form state.
 * @param formData - The submitted form, carrying `couponId` and `isActive`.
 * @returns Form state.
 * @sideeffect Updates a coupon through the API.
 */
export async function setCouponActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  const couponId = String(formData.get('couponId') ?? '');
  const isActive = String(formData.get('isActive') ?? '') === 'true';

  try {
    const coupon = await api.setCouponActive(token, couponId, isActive);
    revalidatePath('/admin/coupons');
    return { error: null, success: `${coupon.code} ${isActive ? 'enabled' : 'disabled'}.` };
  } catch (err) {
    return toActionState(err);
  }
}

/**
 * Sends feedback about the product.
 *
 * The page is stamped by the caller rather than read from the request: a Server
 * Action has no reliable access to the URL the form was rendered on, and asking
 * the user which screen they were on would be a question with an obvious answer.
 *
 * @param _prev - Previous form state.
 * @param formData - The submitted form.
 * @returns Form state, with a thank-you on success.
 * @sideeffect Writes a feedback document through the API.
 */
export async function submitFeedbackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  const rawRating = String(formData.get('rating') ?? '').trim();
  const category = String(formData.get('category') ?? 'idea');
  const allowed = ['bug', 'idea', 'praise', 'other'] as const;
  type Category = (typeof allowed)[number];

  const message = String(formData.get('message') ?? '').trim();
  if (message.length < 5) {
    return {
      error: 'Please write a little more.',
      fieldErrors: { message: 'Please write a little more.' },
    };
  }

  try {
    await api.submitFeedback(token, {
      category: (allowed.includes(category as Category) ? category : 'idea') as Category,
      // Empty means "not rated" — a default of 3 would record a rating nobody
      // gave and skew anything computed from the column.
      rating: rawRating ? Number(rawRating) : null,
      message,
      page: String(formData.get('page') ?? '').trim(),
    });

    revalidatePath('/feedback');
    return { error: null, success: 'Thank you — that is genuinely useful.' };
  } catch (err) {
    return toActionState(err);
  }
}

/**
 * Moves a feedback message through the reading workflow. Admin only.
 *
 * @param _prev - Previous form state.
 * @param formData - The submitted form, carrying `feedbackId` and `status`.
 * @returns Form state.
 * @sideeffect Updates a feedback document through the API.
 */
export async function setFeedbackStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  const feedbackId = String(formData.get('feedbackId') ?? '');
  const status = String(formData.get('status') ?? 'read');

  try {
    const updated = await api.setFeedbackStatus(
      token,
      feedbackId,
      status === 'archived' ? 'archived' : status === 'new' ? 'new' : 'read',
      String(formData.get('adminNote') ?? '').trim(),
    );
    revalidatePath('/admin/feedback');
    return { error: null, success: `Marked ${updated.status}.` };
  } catch (err) {
    return toActionState(err);
  }
}

/**
 * Saves profile changes from the settings form.
 *
 * @param _prev - Previous form state, supplied by `useActionState`.
 * @param formData - The submitted settings form.
 * @returns Form state, with a success message on completion.
 * @sideeffect Writes the user document and revalidates the workspace.
 */
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = await getSessionToken();
  if (!token) return { error: 'Your session has ended. Please sign in again.' };

  // Input points arrive as one textarea, one point per line. Splitting here
  // keeps the form simple — a repeating field group would be heavier for what
  // is usually three to five short lines.
  const rawPoints = String(formData.get('inputPoints') ?? '');
  const inputPoints = rawPoints
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const postFrequency = Number(formData.get('postFrequency'));

  try {
    await api.updateMe(token, {
      name: String(formData.get('name') ?? '').trim(),
      niche: String(formData.get('niche') ?? '').trim(),
      inputPoints,
      postFrequency: (postFrequency === 2 || postFrequency === 3 || postFrequency === 4
        ? postFrequency
        : 3) as 2 | 3 | 4,
    });
  } catch (err) {
    return toActionState(err);
  }

  // Settings appear in the sidebar and drive generation, so the whole shell
  // needs to re-render, not just this page.
  revalidatePath('/', 'layout');

  return { error: null, success: 'Saved.' };
}

/**
 * Edits a plan slot's angle or type.
 *
 * Only accepted before the slot is generated — the API returns 409 otherwise,
 * because the theme has already been written against by then.
 *
 * @param planId - The plan owning the slot.
 * @param dayIndex - Which slot to edit.
 * @param patch - Only the fields to change.
 * @returns Nothing on success, or an error message.
 * @sideeffect Writes the plan and revalidates the workspace.
 */
export async function updateSlotAction(
  planId: string,
  dayIndex: number,
  patch: { theme?: string; type?: 'planned' | 'news' },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    await api.updateSlot(token, planId, dayIndex, patch);
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not save the change.' };
  }

  revalidatePath('/workspace');

  return { ok: true };
}

/**
 * Replaces a draft's body.
 *
 * The API also edits the post's Discord message, so an edit made here is what
 * the user sees in the DM — they are never asked to approve text they were not
 * shown.
 *
 * @param postId - The post to edit.
 * @param content - The new body.
 * @returns Nothing on success, or an error message.
 * @sideeffect Writes the post, edits its Discord message, revalidates.
 */
export async function updatePostAction(
  postId: string,
  content: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    await api.updatePost(token, postId, content);
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not save the edit.' };
  }

  revalidatePath('/workspace');
  revalidatePath('/drafts');

  return { ok: true };
}

/**
 * Issues a Discord link code for the settings page.
 *
 * @returns The code and expiry, or an error message.
 * @sideeffect Writes the code onto the user document.
 */
export async function createLinkCodeAction(): Promise<
  { ok: true; code: string; expiresAt: string } | { ok: false; error: string }
> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    const result = await api.createLinkCode(token);
    return { ok: true, code: result.code, expiresAt: result.expiresAt };
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not create a code.' };
  }
}

/**
 * Checks whether the Discord account has been paired yet.
 *
 * The pairing happens in Discord, outside this app, so there is no event to
 * listen for. The settings panel polls this until it flips.
 *
 * @returns Whether the account is now linked.
 * @sideeffect none (read-only)
 */
export async function checkDiscordLinkedAction(): Promise<boolean> {
  const token = await getSessionToken();
  if (!token) return false;

  try {
    const user = await api.getMe(token);
    return user.discordLinked;
  } catch {
    // A transient failure should not be reported as "not linked", which would
    // leave the poller running with no indication anything was wrong.
    return false;
  }
}

/**
 * Generates a fresh draft plan.
 *
 * @param durationDays - 7 or 30 days.
 * @returns The new plan's id, or an error message.
 * @sideeffect Calls the AI provider, consumes quota, writes a plan.
 */
export async function createPlanAction(
  durationDays: 7 | 30,
): Promise<{ ok: true; planId: string } | { ok: false; error: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    const plan = await api.createPlan(token, durationDays);
    revalidatePath('/workspace');
    revalidatePath('/drafts');
    return { ok: true, planId: plan.id };
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not create the plan.' };
  }
}

/**
 * Approves a draft plan so its slots become generatable.
 *
 * @param planId - The plan to approve.
 * @returns Nothing on success, or an error message.
 * @sideeffect Writes the plan's status.
 */
export async function approvePlanAction(
  planId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    await api.approvePlan(token, planId);
    revalidatePath('/workspace');
    revalidatePath(`/plans/${planId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not approve the plan.' };
  }
}

/**
 * Generates one slot's posts and delivers them.
 *
 * The slowest action in the product — 30-60s on the free tier for a
 * two-platform slot. The UI keeps the button disabled for the whole call rather
 * than optimistically re-enabling it, because a second click would spend
 * another quota unit on a slot that is already generating.
 *
 * @param planId - The plan owning the slot.
 * @param dayIndex - Which slot to generate. Omit for the next pending one.
 * @returns What was produced, or an error message.
 * @sideeffect Calls the AI provider, writes posts, sends Discord DMs.
 */
export async function generateSlotAction(
  planId: string,
  dayIndex?: number,
): Promise<{ ok: true; generated: number; skipped: string[] } | { ok: false; error: string }> {
  const token = await getSessionToken();
  if (!token) return { ok: false, error: 'Your session has ended. Please sign in again.' };

  try {
    const result = await api.generateSlot(token, planId, dayIndex);
    revalidatePath('/workspace');
    revalidatePath('/drafts');
    revalidatePath(`/plans/${planId}`);
    return { ok: true, generated: result.generated.length, skipped: result.skipped };
  } catch (err) {
    return { ok: false, error: toActionState(err).error ?? 'Could not generate the post.' };
  }
}
