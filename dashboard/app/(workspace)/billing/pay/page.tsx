import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CopyValue } from '@/components/copy-value';
import { PaymentClaimForm } from '@/components/payment-claim-form';
import { ApiError, getPayments } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { Payment } from '@/lib/types';

export const metadata = { title: 'Pay · BrandLoop' };

/**
 * Paying for a plan, locally.
 *
 * ## Why this page exists rather than a checkout button
 *
 * There is no processor. A customer in Pakistan pays by bank transfer, Raast,
 * JazzCash or Easypaisa, and the thing that makes that acceptable is that they
 * are not left waiting on a human: the plan activates the moment they submit the
 * transaction reference, and the operator's confirmation happens afterwards.
 * So the page has three jobs — show where to send money, take the reference
 * truthfully, and then say plainly that the plan is already on.
 *
 * ## Why every state says what happened to the account, not to the claim
 *
 * "Pending" is the status of our bookkeeping, not of the customer's access. A
 * claim that granted says so; one that has not says that too. Any wording that
 * leaves someone unsure whether their plan is live is a support message waiting
 * to be written.
 *
 * @param props - Component props.
 * @param props.searchParams - The requested tier, when a card linked here.
 * @returns The pay screen.
 * @sideeffect Reads the session, the payment options, and the claim history.
 */
export default async function BillingPayPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) return null;

  const { tier: requestedTier } = await searchParams;

  let data: Awaited<ReturnType<typeof getPayments>>;

  try {
    data = await getPayments(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return null;
    throw err;
  }

  const { options, account, payments } = data;

  // Only plans at or above the current tier: the API refuses a downgrade because
  // it would cut short days already paid for, and offering one here would only
  // produce a refusal after the money had been sent.
  const currentPrice =
    options.plans.find((plan) => plan.tier === account.plan)?.pricePkr ?? 0;
  const buyable = options.plans.filter((plan) => plan.pricePkr >= currentPrice);

  const selected = buyable.find((plan) => plan.tier === requestedTier) ?? buyable[0];

  // Anything pending, granted or not: a second claim is refused while one is
  // open, so the form is shown disabled rather than removed — the customer needs
  // to see why.
  const openClaim = payments.find((payment) => payment.status === 'pending');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {selected ? `Pay for ${selected.name}` : 'Pay for a plan'}
        </h1>
        <p className="text-muted-foreground text-sm">
          Transfer the amount using any method below, then enter the transaction ID.{' '}
          {options.autoVerify
            ? 'Your plan starts as soon as you submit — we confirm the transfer afterwards.'
            : 'We verify the transfer, then switch your plan on.'}{' '}
          <Link href="/billing" className="text-primary font-medium underline-offset-4 hover:underline">
            Back to plans
          </Link>
          .
        </p>
      </header>

      {!options.enabled && (
        <Alert>
          <AlertTitle>Payment is not set up yet</AlertTitle>
          <AlertDescription>
            This deployment has no receiving account configured, so there is nowhere to send money —
            and a page that asks for a transfer it cannot receive would be worse than this message.
            A coupon code from the plans page still works.
          </AlertDescription>
        </Alert>
      )}

      {options.enabled && openClaim && (
        <Alert>
          <AlertTitle>You already have a payment being confirmed</AlertTitle>
          <AlertDescription>
            {openClaim.grantedAt
              ? `Your plan is active until ${openClaim.grantedUntil ? new Date(openClaim.grantedUntil).toLocaleDateString() : 'further notice'}. `
              : 'It is still being checked. '}
            Another claim can be submitted once this one is settled — we keep it to one at a time so
            nothing is paid twice by accident.
          </AlertDescription>
        </Alert>
      )}

      {options.enabled && (
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold tracking-tight">Where to send it</h2>

            {options.methods.length === 0 ? (
              <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                No payment method is configured on this deployment.
              </p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {options.methods.map((method) => (
                  <li
                    key={method.id}
                    className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
                  >
                    <h3 className="text-sm font-semibold tracking-tight">{method.label}</h3>
                    <CopyValue label="Send to" value={method.account} detail={method.detail} />
                    <p className="text-muted-foreground text-xs leading-relaxed">{method.hint}</p>
                  </li>
                ))}
              </ul>
            )}

            {(options.notes || options.contact) && (
              <div className="border-border bg-card flex flex-col gap-1.5 rounded-lg border p-4 text-sm">
                {options.notes && <p>{options.notes}</p>}
                {options.contact && (
                  <p className="text-muted-foreground text-xs">
                    Send the receipt, or ask about a claim, at{' '}
                    <span className="text-foreground font-medium">{options.contact}</span>.
                  </p>
                )}
              </div>
            )}
          </section>

          {buyable.length > 0 && (
            <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-sm font-semibold tracking-tight">Then tell us about it</h2>
                <p className="text-muted-foreground text-xs">
                  {selected
                    ? `${selected.name}: Rs ${selected.pricePkr.toLocaleString('en-PK')}${
                      selected.durationDays ? ` for ${selected.durationDays} days` : ''
                    }, added to whatever time you have left.`
                    : null}
                </p>
              </div>

              <PaymentClaimForm
                plans={buyable}
                methods={options.methods}
                defaultTier={selected?.tier ?? ''}
                disabledReason={
                  openClaim
                    ? 'Submitting is paused until your earlier payment is confirmed.'
                    : undefined
                }
              />
            </section>
          )}
        </>
      )}

      {payments.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Your payments</h2>
          <ul className="flex flex-col gap-2">
            {payments.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * What a claim's status means for the customer, in their own terms.
 *
 * The status itself is our bookkeeping; what a customer wants to know is whether
 * their plan is on. `grantedAt` is what tells the two pending states apart, so
 * this reads it rather than the status alone.
 *
 * @param payment - The claim.
 * @returns The label and the class that colours it.
 * @sideeffect none (pure)
 */
function statusLabel(payment: Payment): { text: string; className: string } {
  if (payment.status === 'verified') {
    return { text: 'Confirmed', className: 'text-status-approved' };
  }
  if (payment.status === 'rejected') {
    return { text: 'Rejected', className: 'text-status-rejected' };
  }
  if (payment.status === 'revoked') {
    return { text: 'Reversed', className: 'text-status-rejected' };
  }
  return payment.grantedAt
    ? { text: 'Active — confirming your transfer', className: 'text-status-pending' }
    : { text: 'Waiting to be checked', className: 'text-status-pending' };
}

/**
 * One claim in the customer's own history.
 *
 * @param props - Component props.
 * @param props.payment - The claim.
 * @returns The row.
 * @sideeffect none
 */
function PaymentRow({ payment }: { payment: Payment }) {
  const status = statusLabel(payment);

  return (
    <li className="border-border bg-card flex flex-col gap-2 rounded-lg border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{payment.tierName}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          Rs {payment.amountPkr.toLocaleString('en-PK')}
        </span>
        <span className="text-muted-foreground text-xs">{payment.methodLabel}</span>
        <span className="font-mono text-xs">{payment.reference}</span>
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {new Date(payment.createdAt).toLocaleDateString()}
        </span>
      </div>

      {/* Status is a word as well as a colour, never the colour alone. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn('text-xs font-medium', status.className)}>{status.text}</span>
        {payment.grantedUntil && payment.status !== 'revoked' && (
          <span className="text-muted-foreground text-xs">
            {payment.tierName} until {new Date(payment.grantedUntil).toLocaleDateString()}
          </span>
        )}
      </div>

      {payment.reviewNote && (
        <p className="text-muted-foreground text-xs italic">{payment.reviewNote}</p>
      )}
    </li>
  );
}
