'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { reviewPaymentAction } from '@/lib/actions';
import type { AdminPayment } from '@/lib/types';

/**
 * The reconciliation queue, and what has already been settled.
 *
 * ## Why every row says whether the plan is already active
 *
 * The pressing question about a claim is not "is it pending" — it is "is the
 * customer already using something I have not confirmed". A granted claim is
 * money already given away; an ungranted one is only a customer waiting. The two
 * need different actions and different urgency, and the status word alone does
 * not distinguish them.
 *
 * ## Why one form per row with a decision select
 *
 * The row's pair of decisions changes with its shape (confirm/revoke versus
 * verify/reject), and the note applies to whichever is chosen. A select keeps one
 * note field for the row; two submit buttons would either duplicate the note or
 * depend on native button name/value semantics this UI's Button does not
 * document.
 *
 * @param props - Component props.
 * @param props.awaiting - Claims still to settle, urgent first.
 * @param props.settled - The most recent settled claims, newest first.
 * @returns The queue.
 * @sideeffect Submits server actions.
 */
export function AdminPaymentQueue({
  awaiting,
  settled,
}: {
  awaiting: AdminPayment[];
  settled: AdminPayment[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">To reconcile</h2>
          <p className="text-muted-foreground text-xs">
            Granted claims are listed first — those are plans already active that nobody has checked
            against the statement yet.
          </p>
        </div>

        {awaiting.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
            Nothing to reconcile. Claims appear here as customers submit them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {awaiting.map((payment) => (
              <ClaimRow key={payment.id} payment={payment} />
            ))}
          </ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Settled recently</h2>
          <ul className="flex flex-col gap-2">
            {settled.map((payment) => (
              <SettledRow key={payment.id} payment={payment} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One claim waiting on a decision.
 *
 * @param props - Component props.
 * @param props.payment - The claim.
 * @returns The row.
 * @sideeffect Submits a server action.
 */
function ClaimRow({ payment }: { payment: AdminPayment }) {
  const [state, action, isPending] = useActionState(reviewPaymentAction, EMPTY_ACTION_STATE);

  const granted = Boolean(payment.grantedAt);
  const account = payment.user?.email ?? payment.userId;

  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-lg border px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{account}</span>
        <Badge variant={granted ? 'secondary' : 'outline'}>
          {granted ? `${payment.tierName} already active` : 'Nothing granted yet'}
        </Badge>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {timeAgo(payment.createdAt)}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="text-foreground text-sm font-medium tabular-nums">
          Rs {payment.amountPkr.toLocaleString('en-PK')}
        </span>
        <span>{payment.methodLabel}</span>
        <span className="font-mono">{payment.reference}</span>
        <span>
          {payment.user?.plan
            ? `on ${payment.user.plan}${payment.user.planExpiresAt ? ` until ${new Date(payment.user.planExpiresAt).toLocaleDateString()}` : ''}`
            : 'no plan'}
        </span>
      </div>

      {payment.note && <p className="text-xs italic">“{payment.note}”</p>}

      {granted && payment.previousPlan && (
        <p className="text-muted-foreground text-xs">
          Revoking returns the account to {payment.previousPlan}
          {payment.previousPlanExpiresAt
            ? ` until ${new Date(payment.previousPlanExpiresAt).toLocaleDateString()}`
            : ''}
          .
        </p>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="paymentId" value={payment.id} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`decision-${payment.id}`} className="text-muted-foreground text-xs">
            Decision
          </label>
          <select
            id={`decision-${payment.id}`}
            name="decision"
            defaultValue={granted ? 'confirm' : 'verify'}
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {granted ? (
              <>
                <option value="confirm">Confirm — the money is there</option>
                <option value="revoke">Revoke — no such transfer</option>
              </>
            ) : (
              <>
                <option value="verify">Verify — grant the plan</option>
                <option value="reject">Reject — no such transfer</option>
              </>
            )}
          </select>
        </div>

        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <label htmlFor={`note-${payment.id}`} className="text-muted-foreground text-xs">
            Note (shown to the customer)
          </label>
          <Input
            id={`note-${payment.id}`}
            name="note"
            maxLength={300}
            placeholder="Optional reason"
            className="h-9"
          />
        </div>

        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Settle'}
        </Button>
      </form>

      {state.success && (
        <span role="status" className="text-status-approved text-xs">
          {state.success}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-destructive text-xs">
          {state.error}
        </span>
      )}
    </li>
  );
}

/**
 * One settled claim, for the record.
 *
 * @param props - Component props.
 * @param props.payment - The claim.
 * @returns The row.
 * @sideeffect none
 */
function SettledRow({ payment }: { payment: AdminPayment }) {
  const label = {
    verified: 'Confirmed',
    rejected: 'Rejected',
    revoked: 'Revoked',
    pending: 'Pending',
  }[payment.status];

  const tone = payment.status === 'verified' ? 'text-status-approved' : 'text-status-rejected';

  return (
    <li className="border-border flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-dashed px-4 py-2.5 text-xs">
      <span className="text-foreground text-sm font-medium">{payment.user?.email ?? payment.userId}</span>
      <span className="tabular-nums">Rs {payment.amountPkr.toLocaleString('en-PK')}</span>
      <span className="font-mono">{payment.reference}</span>
      {payment.autoVerified && (
        <span className="text-muted-foreground">
          activated at submit, then {label.toLowerCase()}
        </span>
      )}
      <span className={`${tone} ml-auto font-medium`}>{label}</span>
      {payment.reviewedAt && (
        <span className="text-muted-foreground tabular-nums">
          {new Date(payment.reviewedAt).toLocaleDateString()}
        </span>
      )}
    </li>
  );
}

/**
 * Formats a timestamp as how long ago it was.
 *
 * A queue is read by how stale each row is, and "3 hours ago" answers that in a
 * way a date does not.
 *
 * @param value - The timestamp.
 * @returns A short relative string.
 * @sideeffect none (pure)
 */
function timeAgo(value: string): string {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
