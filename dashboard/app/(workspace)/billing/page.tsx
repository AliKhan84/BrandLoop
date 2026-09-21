import { Check } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RedeemCouponForm } from '@/components/redeem-coupon-form';
import { ApiError, getBilling } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import { cn } from '@/lib/utils';
import type { BillingPlan } from '@/lib/types';

export const metadata = { title: 'Plans · BrandLoop' };

/**
 * Subscription plans, and what this account is on.
 *
 * ## Why the numbers come from the API now
 *
 * They used to be literals in this file, with a comment claiming they were "the
 * real QUOTA_* defaults". They were not: editing the API's quota config changed
 * what was enforced and left the page advertising the old figure, so the page
 * could promise an allowance the product no longer honoured. Every number here
 * is read from the endpoint that enforces it.
 *
 * ## Still not a checkout
 *
 * Nothing is charged and there is no payment provider. What changed is that a
 * tier is now real: everyone starts on Pro for a trial period, and a coupon can
 * grant Pro or unlimited usage. The buttons stay disabled, and the page says so
 * rather than letting a price imply a purchase.
 *
 * @returns The plans screen.
 * @sideeffect Reads the session and the plan catalog.
 */
export default async function BillingPage() {
  const token = await getSessionToken();
  if (!token) return null;

  let billing;
  try {
    billing = await getBilling(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) return null;
    throw err;
  }

  const { plans, current } = billing;
  const currentName = plans.find((plan) => plan.tier === current.plan)?.name ?? 'Free';

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
            . Redeeming a code, or a new plan once checkout exists, restores the higher limits.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertTitle>Checkout is not open yet</AlertTitle>
        <AlertDescription>
          Plans are shown here, not sold — no card is taken and nothing is charged. A tier is real
          though: signups start on Pro for a trial, and a coupon code grants access from the form
          below.
        </AlertDescription>
      </Alert>

      {/* One column while the cards are narrow enough to read at full width,
          three once there is room to compare them side by side. */}
      <ul className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.tier} plan={plan} isCurrent={plan.tier === current.plan} />
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

/**
 * One tier card.
 *
 * The feature lines are composed from the plan's own limits rather than written
 * out, so a card cannot describe numbers the tier does not have.
 *
 * @param props - Component props.
 * @param props.plan - The tier as the API describes it.
 * @param props.isCurrent - Whether this is the tier the account is resolved against.
 * @returns The card.
 * @sideeffect none
 */
function PlanCard({ plan, isCurrent }: { plan: BillingPlan; isCurrent: boolean }) {
  const features = [
    `${plan.limits.planGenerations} plan generations a day`,
    `${plan.limits.newsLookups} news lookups a day`,
    `${plan.limits.images} post images a week`,
    'X and LinkedIn drafts, approved in Discord',
    '7- and 30-day plans',
  ];

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
            ${plan.price}
          </span>
          <span className="text-muted-foreground text-xs">/ month</span>
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
          lists differ in length. */}
      <Button variant={isCurrent ? 'outline' : 'default'} disabled className="mt-auto">
        {isCurrent ? 'Current plan' : 'Coming soon'}
      </Button>
    </li>
  );
}
