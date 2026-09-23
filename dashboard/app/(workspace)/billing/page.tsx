import Link from 'next/link';
import { Check } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { RedeemCouponForm } from '@/components/redeem-coupon-form';
import { ApiError, getBilling, getPayments } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { BillingPlan, BillingSummary, Payment } from '@/lib/types';

export const metadata = { title: 'Plans · BrandLoop' };

/**
 * Subscription plans, and what this account is on.
 *
 * ## Why the numbers come from the API
 *
 * They used to be literals in this file, with a comment claiming they were "the
 * real QUOTA_* defaults". They were not: editing the API's quota config changed
 * what was enforced and left the page advertising the old figure. Every number
 * here is read from the endpoint that enforces it — including the price, which is
 * the PKR figure the API will actually charge rather than a conversion of the
 * catalog's USD one.
 *
 * ## What the buttons do now
 *
 * A plan can be bought. Paying is local and manual, so the button leads to a page
 * with the account details and a claim form — and by default the plan activates
 * the moment that form is submitted, with the operator confirming the transfer
 * afterwards rather than holding the plan hostage to their attention.
 *
 * A cheaper tier than the current one is deliberately not offered: the account
 * holds one plan with one expiry, so selling a downgrade would delete days the
 * customer already paid for. The API refuses it as well.
 *
 * @returns The plans screen.
 * @sideeffect Reads the session, the plan catalog, and this account's claims.
 */
export default async function BillingPage() {
  const token = await getSessionToken();
  if (!token) return null;

  let billing: BillingSummary;
  let payments: Payment[] = [];

  try {
    billing = await getBilling(token);
    // Only fetched when there is a checkout to talk about: an extra request on
    // every visit to a page that cannot take money would be waste.
    if (billing.payments.enabled) {
      payments = (await getPayments(token)).payments;
    }
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return null;
    throw err;
  }

  const { plans, current } = billing;
  const currentName = plans.find((plan) => plan.tier === current.plan)?.name ?? 'Free';

  // The one claim the customer is waiting on an answer about — the rest of the
  // history lives on the pay page, where it can be read in full.
  const openClaim = payments.find((payment) => payment.status === 'pending' && payment.grantedAt);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
        <p className="text-muted-foreground text-sm">
          You are on <span className="text-foreground font-medium">{currentName}</span>
          {current.unlimited &&
            (current.unlimitedUntil
              ? ` with unlimited usage until ${new Date(current.unlimitedUntil).toLocaleDateString()}`
              : ' with unlimited usage, with no end date')}
          {!current.unlimited &&
            current.planExpiresAt &&
            ` until ${new Date(current.planExpiresAt).toLocaleDateString()}`}
          .
        </p>
      </header>

      {current.lapsed && (
        <Alert>
          <AlertTitle>Your {current.storedPlan} plan has ended</AlertTitle>
          <AlertDescription>
            Quotas fell back to the free allowance
            {current.planExpiresAt && ` on ${new Date(current.planExpiresAt).toLocaleDateString()}`}
            . Choosing a plan again, or redeeming a code, restores the higher limits.
          </AlertDescription>
        </Alert>
      )}

      {openClaim && (
        <Alert>
          <AlertTitle>{openClaim.tierName} is active — we are confirming your transfer</AlertTitle>
          <AlertDescription>
            Nothing else is needed from you. We are checking the {openClaim.methodLabel.toLowerCase()}{' '}
            transfer you told us about
            {openClaim.grantedUntil &&
              `; ${openClaim.tierName} runs until ${new Date(openClaim.grantedUntil).toLocaleDateString()}`}
            . If the credit is not there, we will get in touch before anything changes.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTitle>
          {billing.payments.enabled ? 'How payment works' : 'Checkout is not open yet'}
        </AlertTitle>
        <AlertDescription>
          {billing.payments.enabled ? (
            <>
              Pay by bank transfer, Raast, JazzCash or Easypaisa, then tell us the transaction ID.
              Your plan starts immediately — we confirm the transfer against our own statement
              afterwards, usually within {billing.payments.reviewHours}{' '}
              {billing.payments.reviewHours === 1 ? 'hour' : 'hours'}.
              {billing.payments.contact && ` Questions: ${billing.payments.contact}.`}
            </>
          ) : (
            <>
              Plans are shown here, but no payment method is set up on this deployment, so nothing
              can be bought yet. A tier is still real: signups start on Pro for a trial, and a coupon
              code grants access from the form below.
            </>
          )}
        </AlertDescription>
      </Alert>

      {/* One column while the cards are narrow enough to read at full width,
          three once there is room to compare them side by side. */}
      <ul className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            plans={plans}
            current={current}
            paymentsEnabled={billing.payments.enabled}
          />
        ))}
      </ul>

      <section className="border-border bg-card flex flex-col gap-4 rounded-lg border p-5">
        <h2 className="text-sm font-semibold tracking-tight">Redeem a code</h2>
        <RedeemCouponForm />
        {current.couponCode && (
          <p className="text-muted-foreground text-xs">
            Last code used on this account: <span className="font-mono">{current.couponCode}</span>
          </p>
        )}
      </section>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Allowances reset daily at midnight UTC, and images weekly on Monday. An unlimited code
        bypasses both while it lasts.
      </p>
    </div>
  );
}

/** Where a card's action leads, or why it cannot be taken. */
type CardAction =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'disabled'; label: string };

/**
 * Decides what a tier card offers this account.
 *
 * WHY THIS COMPARES PRICES RATHER THAN A RANK: the API is what refuses a
 * downgrade; this only decides what to draw, and it should not invent an
 * ordering the API does not publish. Price is the ordering the catalog actually
 * sells on, so comparing it cannot disagree with the API about which of two plans
 * is the more expensive.
 *
 * @param plan - The tier being drawn.
 * @param plans - The whole catalog, to price the caller's current tier.
 * @param current - The caller's effective tier.
 * @param paymentsEnabled - Whether a purchase is possible at all.
 * @returns The label, and either a link or the reason there is none.
 * @sideeffect none (pure)
 */
function planAction(
  plan: BillingPlan,
  plans: BillingPlan[],
  current: BillingSummary['current'],
  paymentsEnabled: boolean,
): CardAction {
  const price = (tier: string) => plans.find((entry) => entry.tier === tier)?.pricePkr ?? 0;
  const rupees = `Rs ${plan.pricePkr.toLocaleString('en-PK')}`;
  const isCurrent = plan.tier === current.plan;

  if (isCurrent) {
    // Free is where an account falls back to, not something to buy — so the
    // current free tier is a label, while a paid one can be renewed.
    if (!paymentsEnabled || plan.pricePkr === 0) {
      return { kind: 'disabled', label: 'Current plan' };
    }
    return { kind: 'link', label: `Renew — ${rupees}`, href: `/billing/pay?tier=${plan.tier}` };
  }

  if (plan.pricePkr < price(current.plan)) {
    return { kind: 'disabled', label: 'Included in your current plan' };
  }

  if (!paymentsEnabled) {
    return { kind: 'disabled', label: 'Not available' };
  }

  return { kind: 'link', label: `Buy — ${rupees}`, href: `/billing/pay?tier=${plan.tier}` };
}

/**
 * One tier card.
 *
 * The feature lines are composed from the plan's own limits rather than written
 * out, so a card cannot describe numbers the tier does not have.
 *
 * @param props - Component props.
 * @param props.plan - The tier as the API describes it.
 * @param props.plans - The whole catalog.
 * @param props.current - The caller's effective tier.
 * @param props.paymentsEnabled - Whether a purchase is possible.
 * @returns The card.
 * @sideeffect none
 */
function PlanCard({
  plan,
  plans,
  current,
  paymentsEnabled,
}: {
  plan: BillingPlan;
  plans: BillingPlan[];
  current: BillingSummary['current'];
  paymentsEnabled: boolean;
}) {
  const features = [
    `${plan.limits.planGenerations} plan generations a day`,
    `${plan.limits.newsLookups} news lookups a day`,
    `${plan.limits.images} post images a week`,
    'X and LinkedIn drafts, approved in Discord',
    '7- and 30-day plans',
  ];

  const isCurrent = plan.tier === current.plan;
  const action = planAction(plan, plans, current, paymentsEnabled);

  return (
    <li
      aria-current={isCurrent ? 'true' : undefined}
      className={cn(
        'border-border bg-card flex flex-col gap-5 rounded-lg border p-5',
        // The current plan is marked by its badge and this edge, never by colour
        // alone.
        isCurrent && 'border-primary/50',
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">{plan.name}</h2>
          {isCurrent && <Badge variant="secondary">Current plan</Badge>}
        </div>

        <p className="flex items-baseline gap-1.5">
          <span className="font-heading text-2xl leading-none font-semibold tracking-tight tabular-nums">
            {plan.pricePkr === 0 ? 'Free' : `Rs ${plan.pricePkr.toLocaleString('en-PK')}`}
          </span>
          {plan.pricePkr > 0 && (
            <span className="text-muted-foreground text-xs">
              / {plan.durationDays ?? 30} days
            </span>
          )}
        </p>
      </div>

      <ul className="flex flex-col gap-2.5 text-sm">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2">
            <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="leading-snug">{feature}</span>
          </li>
        ))}
      </ul>

      {/* `mt-auto` keeps every card's action on the same line when the feature
          lists differ in length. A link is styled with `buttonVariants` rather
          than `Button render={<a/>}`, which this codebase has already seen log
          console errors from the UI primitive. */}
      {action.kind === 'link' ? (
        <Link
          href={action.href}
          className={cn(buttonVariants({ variant: 'default' }), 'mt-auto h-9')}
        >
          {action.label}
        </Link>
      ) : (
        <Button variant={isCurrent ? 'outline' : 'default'} disabled className="mt-auto h-9">
          {action.label}
        </Button>
      )}
    </li>
  );
}
