/**
 * Form state shared between server actions and the forms that call them.
 *
 * WHY THIS IS NOT IN `actions.ts`: that file carries `'use server'`, and a
 * `'use server'` module may only export **async functions**. Exporting a plain
 * object from it fails the build with "A 'use server' file can only export
 * async functions, found object". Types would survive, but values do not — so
 * the shared constant lives here and both sides import it from one place.
 *
 * Keeping it separate also means a Client Component can import the shape and
 * the initial state without pulling in the server module at all.
 */

/** State returned to a form via `useActionState`. */
export interface ActionState {
  /** A message to show the user, or null when there is nothing wrong. */
  error: string | null;
  /**
   * Confirmation copy shown after a successful save.
   *
   * WHY A SEPARATE FIELD: a settings form that saves silently leaves the user
   * unsure whether the click registered. Clearing `error` alone is not visible
   * feedback — nothing changes on screen. An explicit message is the difference
   * between "nothing happened" and "saved".
   */
  success?: string;
  /** Per-field messages, keyed by input name, for inline display. */
  fieldErrors?: Record<string, string>;
}

/** The initial, untouched form state. */
export const EMPTY_ACTION_STATE: ActionState = { error: null };
