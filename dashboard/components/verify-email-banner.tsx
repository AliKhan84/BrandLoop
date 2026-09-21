'use client';

import { useActionState } from 'react';
import { MailCheck } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { resendVerificationAction } from '@/lib/actions';

/**
 * Prompts an unverified account to confirm its address.
 *
 * ## Why a banner and not a gate
 *
 * Verification is soft: nothing in the product is blocked on it. This is a
 * request, not a wall — which is what keeps one wrong mail credential from
 * locking every new account out. The banner keeps the offer visible without
 * interrupting anything the user came here to do.
 *
 * ## Why the resend result is shown here
 *
 * The API reports whether the message actually went out — and when it did not,
 * why. On a deployment with no mail credentials configured it still says so
 * honestly ("the link went to the server log") rather than claiming an email
 * that will never arrive, which is the failure mode that wastes the most time.
 *
 * @param props - Component props.
 * @param props.email - The address awaiting confirmation, shown so the user can
 *   spot a typo they made at signup.
 * @returns The banner.
 * @sideeffect Submits a server action that sends mail.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, formAction, isPending] = useActionState(resendVerificationAction, EMPTY_ACTION_STATE);

  return (
    <Alert className="mb-6">
      <MailCheck aria-hidden="true" />
      <AlertTitle>Confirm your email address</AlertTitle>
      <AlertDescription>
        <p>
          We sent a confirmation link to <span className="text-foreground font-medium">{email}</span>
          . Everything works without confirming, but the link is how we know the address is yours.
        </p>

        <form action={formAction} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            {isPending ? 'Sending…' : 'Resend the link'}
          </Button>

          {/* Both messages are role-announced rather than colour-only, and they
              sit next to the button that caused them. */}
          {state.success && (
            <span role="status" className="text-muted-foreground text-sm">
              {state.success}
            </span>
          )}
          {state.error && (
            <span role="alert" className="text-destructive text-sm">
              {state.error}
            </span>
          )}
        </form>
      </AlertDescription>
    </Alert>
  );
}
