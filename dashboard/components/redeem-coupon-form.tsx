'use client';

import { useActionState } from 'react';
import { Ticket } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { redeemCouponAction } from '@/lib/actions';

/**
 * Coupon redemption.
 *
 * ## Why the code field is not validated in the browser
 *
 * The API is the only thing that knows whether a code exists, is still active,
 * and has any uses left. Client-side validation here would only be able to check
 * the shape — so every real answer comes back from the server anyway, and the
 * form reports it verbatim. That keeps the reasons specific ("you already used
 * that code" rather than "invalid"), which is what stops a user retrying a code
 * that will never work.
 *
 * @returns The redemption form.
 * @sideeffect Submits a server action.
 */
export function RedeemCouponForm() {
  const [state, formAction, isPending] = useActionState(redeemCouponAction, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Have a code?</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="code"
            name="code"
            placeholder="LAUNCH30"
            autoComplete="off"
            // Codes are printed in uppercase and the API normalises anyway, so
            // autocapitalising on a phone helps rather than fights the user.
            autoCapitalize="characters"
            spellCheck={false}
            className="h-9 max-w-56 font-mono uppercase"
            aria-invalid={Boolean(state.fieldErrors?.code)}
            aria-describedby={state.fieldErrors?.code ? 'code-error' : undefined}
          />
          <Button type="submit" size="sm" variant="outline" disabled={isPending}>
            <Ticket className="size-4" aria-hidden="true" />
            {isPending ? 'Checking…' : 'Redeem'}
          </Button>
        </div>
        {state.fieldErrors?.code && (
          <p id="code-error" className="text-destructive text-sm">
            {state.fieldErrors.code}
          </p>
        )}
      </div>

      {state.success && (
        <p role="status" className="text-status-approved text-sm">
          {state.success}
        </p>
      )}
      {state.error && (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      )}
    </form>
  );
}
