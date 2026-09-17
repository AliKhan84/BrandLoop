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
}: {
  mode: 'signin' | 'signup';
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(action, EMPTY_ACTION_STATE);

  const isSignUp = mode === 'signup';

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
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
