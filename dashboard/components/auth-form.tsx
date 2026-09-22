'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPTY_ACTION_STATE, type ActionState } from '@/lib/action-state';

/**
 * Shared sign-in / sign-up form.
 *
 * ## Why `useActionState` rather than hand-rolled state
 *
 * Three things fall out of it that would otherwise each need wiring: the
 * pending flag during submit, the error returned by the server action, and
 * progressive enhancement — with JavaScript disabled the browser posts the form
 * natively and the action still runs. A `fetch`-based handler cannot do the
 * last one, and on a slow connection that difference is the whole experience.
 *
 * ## Accessibility decisions worth keeping
 *
 *   • Labels are real `<label>` elements bound by `htmlFor`, never placeholder
 *     text standing in for one. A placeholder disappears exactly when the user
 *     needs it.
 *   • Errors are tied to their input with `aria-describedby` and announced via
 *     `aria-invalid`, so a screen reader reports the problem at the field
 *     rather than leaving the user to hunt for it.
 *   • Inputs are 16px on small screens. Anything smaller makes iOS Safari zoom
 *     the viewport on focus and the layout never settles back.
 *
 * @param props - Component props.
 * @param props.mode - Which flow this form drives.
 * @param props.action - The server action from `lib/actions`.
 * @param props.submitLabel - Text for the primary button.
 * @returns The form.
 * @sideeffect none
 */
export function AuthForm({
  mode,
  action,
  submitLabel,
  error,
}: {
  mode: 'signin' | 'signup';
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  /**
   * Reason code from the Google callback's redirect, e.g. `google-cancelled`.
   *
   * Passed in rather than read from `useSearchParams` because this is a Client
   * Component and the page is server-rendered: reading the query string here
   * would opt the whole route into client rendering for one line of text.
   */
  error?: string;
}) {
  const [state, formAction, isPending] = useActionState(action, EMPTY_ACTION_STATE);

  const isSignUp = mode === 'signup';

  /**
   * Google sign-in failures, in words.
   *
   * Every one of these ends back here with nothing else to show, so silence
   * would read as "the button does nothing". The codes are the callback's; an
   * unmapped one still says something rather than disappearing.
   */
  const OAUTH_ERRORS: Record<string, string> = {
    'google-not-configured':
      'Google sign-in is not set up on this deployment. Use your email and password instead.',
    'google-cancelled':
      'Google sign-in was cancelled, or that Google account is not allowed to sign in to this app yet.',
    'google-state': 'That sign-in attempt expired before it finished. Please try again.',
    'google-failed': 'Google could not complete the sign-in. Try again, or use your email and password.',
  };

  const oauthError = error ? (OAUTH_ERRORS[error] ?? 'Google sign-in failed. Please try again.') : null;

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {/*
        Google sign-in, offered first because it is the shorter path: no password
        to choose, and the address arrives already verified.

        A real `<a>`, not a `<Button render={<a/>}>`. The navigation is the whole
        behaviour — the route sets a state cookie and redirects — so a native link
        is the honest element, and it cannot produce the Base UI `render` warning
        this project spent a commit clearing.

        Shown unconditionally: with no credentials the route answers with a
        redirect back to this form carrying `error=google-not-configured`, which is
        a clearer explanation than a button that silently is not there.
      */}
      <a
        href="/api/auth/google"
        className="border-border hover:bg-accent focus-visible:ring-ring flex h-11 w-full items-center justify-center gap-2.5 rounded-md border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {/*
          Google's four-colour "G", in its own brand colours — the one place in
          this interface that is deliberately not on the amber palette. Google's
          brand rules require the mark to keep these values, and a monochrome
          version reads as a generic glyph rather than as the account provider.
          It does not leak into the design system: nothing here is reused as a
          token, and the button is a bordered surface rather than a Google-blue
          one, so the app's own palette is unchanged.
        */}
        <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden="true" focusable="false">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        Continue with Google
      </a>

      <p className="text-muted-foreground -my-2 flex items-center gap-3 text-xs">
        <span className="bg-border h-px flex-1" aria-hidden="true" />
        or
        <span className="bg-border h-px flex-1" aria-hidden="true" />
      </p>

      {isSignUp && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Ali Khan"
            aria-invalid={Boolean(state.fieldErrors?.name)}
            aria-describedby={state.fieldErrors?.name ? 'name-error' : undefined}
            className="h-11 text-base"
          />
          {state.fieldErrors?.name && (
            <p id="name-error" className="text-destructive text-sm">
              {state.fieldErrors.name}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          aria-describedby={state.fieldErrors?.email ? 'email-error' : undefined}
          className="h-11 text-base"
        />
        {state.fieldErrors?.email && (
          <p id="email-error" className="text-destructive text-sm">
            {state.fieldErrors.email}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          required
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          aria-invalid={Boolean(state.fieldErrors?.password)}
          aria-describedby={
            state.fieldErrors?.password ? 'password-error' : isSignUp ? 'password-hint' : undefined
          }
          className="h-11 text-base"
        />
        {isSignUp && !state.fieldErrors?.password && (
          <p id="password-hint" className="text-muted-foreground text-sm">
            At least 8 characters.
          </p>
        )}
        {state.fieldErrors?.password && (
          <p id="password-error" className="text-destructive text-sm">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      {/*
        A single live region for the whole-form error. `role="alert"` makes a
        screen reader announce it the moment it appears, which matters because
        the message is the only thing telling the user why nothing happened.
      */}
      {oauthError && (
        <p role="alert" className="text-destructive bg-destructive/8 border-destructive/25 rounded-md border px-3 py-2 text-sm">
          {oauthError}
        </p>
      )}

      {state.error && (
        <p role="alert" className="text-destructive bg-destructive/8 border-destructive/25 rounded-md border px-3 py-2 text-sm">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending} className="h-11 w-full text-base font-semibold">
        {isPending ? (isSignUp ? 'Creating account…' : 'Signing in…') : submitLabel}
      </Button>

      <p className="text-muted-foreground text-center text-sm">
        {isSignUp ? (
          <>
            Already have an account?{' '}
            <Link href="/login" className="text-foreground font-medium underline underline-offset-4">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{' '}
            <Link href="/signup" className="text-foreground font-medium underline underline-offset-4">
              Create one
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
