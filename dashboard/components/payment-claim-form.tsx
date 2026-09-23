'use client';

import { useActionState } from 'react';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { submitPaymentAction } from '@/lib/actions';
import type { PaymentMethodOption, PaymentPlanOption } from '@/lib/types';

/**
 * The payment claim form.
 *
 * ## Why the reference is the only thing validated in the browser
 *
 * Everything else the API decides: whether the tier is buyable, whether a method
 * is configured, whether a claim is already open. The reference is the one field
 * where a mistake is invisible to the customer and expensive for the operator —
 * a transaction id they mistype is a transfer nobody can find — so it is checked
 * on both sides, and the API's own reason is still what gets shown.
 *
 * ## Why the tier is a field here rather than a URL parameter only
 *
 * The pay page can be linked with `?tier=`, but changing your mind about which
 * plan to buy should not mean going back a page and losing what you had typed.
 *
 * @param props - Component props.
 * @param props.plans - The tiers that may be bought, cheapest first.
 * @param props.methods - The configured ways to pay.
 * @param props.defaultTier - The tier the page arrived with.
 * @param props.disabledReason - Set when a claim is already open; the form is
 *   then shown read-only with the reason, rather than hidden.
 * @returns The form.
 * @sideeffect Submits a server action.
 */
export function PaymentClaimForm({
  plans,
  methods,
  defaultTier,
  disabledReason,
}: {
  plans: PaymentPlanOption[];
  methods: PaymentMethodOption[];
  defaultTier: string;
  disabledReason?: string;
}) {
  const [state, formAction, isPending] = useActionState(submitPaymentAction, EMPTY_ACTION_STATE);

  const disabled = Boolean(disabledReason);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tier">Plan</Label>
          {/* A native select: there is no select primitive in components/ui, and
              the admin coupon form already set this precedent. */}
          <select
            id="tier"
            name="tier"
            defaultValue={defaultTier}
            disabled={disabled}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {plans.map((plan) => (
              <option key={plan.tier} value={plan.tier}>
                {plan.name} — Rs {plan.pricePkr.toLocaleString('en-PK')}
                {plan.durationDays ? ` for ${plan.durationDays} days` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="method">Paid with</Label>
          <select
            id="method"
            name="method"
            defaultValue={methods[0]?.id}
            disabled={disabled}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {methods.map((method) => (
              <option key={method.id} value={method.id}>
                {method.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reference">Transaction ID</Label>
        <Input
          id="reference"
          name="reference"
          placeholder="e.g. 4821093376"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="h-9 font-mono"
          aria-invalid={Boolean(state.fieldErrors?.reference)}
          aria-describedby={state.fieldErrors?.reference ? 'reference-error' : 'reference-help'}
        />
        <p id="reference-help" className="text-muted-foreground text-xs">
          The ID from your transfer confirmation — the bank&rsquo;s reference, or the TID in your
          JazzCash or Easypaisa message. This is what we match the money against.
        </p>
        {state.fieldErrors?.reference && (
          <p id="reference-error" className="text-destructive text-sm">
            {state.fieldErrors.reference}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Anything to add? (optional)</Label>
        <Textarea
          id="note"
          name="note"
          rows={2}
          maxLength={500}
          disabled={disabled}
          placeholder="Sent from my father's account, for example."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={isPending || disabled}>
          <Send className="size-4" aria-hidden="true" />
          {isPending ? 'Submitting…' : 'I have sent the payment'}
        </Button>

        {state.success && (
          <span role="status" className="text-status-approved text-sm">
            {state.success}
          </span>
        )}
        {state.error && (
          <span role="alert" className="text-destructive text-sm">
            {state.error}
          </span>
        )}
      </div>

      {disabledReason && (
        <p className="text-muted-foreground text-xs">{disabledReason}</p>
      )}
    </form>
  );
}

export default PaymentClaimForm;
