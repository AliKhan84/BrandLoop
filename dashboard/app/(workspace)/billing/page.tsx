import { Check } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Plans · BrandLoop' };

/**
 * Subscription plans.
 *
 * ## This is the shape of the offer, not a checkout
 *
 * Nothing here charges anything. There is no plan field on the user, no payment
 * provider, and the API enforces the free tier's quotas for everybody — so the
 * page states that outright rather than letting a price imply a purchase that
 * cannot happen. Wiring it up later means a plan on `User`, a provider, and
 * `QUOTAS` reading from the plan instead of from env.
 *
 * ## Why the free tier is stated in real numbers
 *
 * Its limits are the ones the API actually enforces today (`QUOTA_*` defaults
 * in `src/config/env.js`), so the card cannot advertise a ceiling the product
 * does not honour. The paid tiers are targets: they are described, not
 * promised, and their buttons stay inert until there is something behind them.
 *
 * ## Why the current plan is hard-coded
 *
 * Everyone is on Free, because a plan cannot be bought yet. The badge becomes
 * real data the day billing does.
 *
 * No session check here: the workspace layout already redirects anyone without
 * a valid token, and this page reads nothing from the API.
 *
 * @returns The plans screen.
 * @sideeffect none
 */
export default function BillingPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Plans</h1>
        <p className="text-muted-foreground text-sm">
          BrandLoop runs on the free tier. Everything the product does is available on it, within a
          metered daily allowance.
        </p>
      </header>

      <Alert>
        <AlertTitle>Checkout is not open yet</AlertTitle>
        <AlertDescription>
          Paid plans are shown here, not sold. No card is taken, nothing is charged, and no plan is
          attached to your account — the free tier&apos;s limits are the only ones the API enforces.
        </AlertDescription>
      </Alert>

      {/* One column while the cards are narrow enough to read at full width,
          three once there is room to compare them side by side. */}
      <ul className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <li
            key={plan.name}
            aria-current={plan.current ? 'true' : undefined}
            className={cn(
              'border-border bg-card flex flex-col gap-5 rounded-lg border p-5',
              // The current plan is marked by its badge and this edge, never by
              // colour alone.
              plan.current && 'border-primary/50',
            )}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">{plan.name}</h2>
                {plan.current && <Badge variant="secondary">Current plan</Badge>}
              </div>

              <p className="flex items-baseline gap-1.5">
                <span className="font-heading text-2xl leading-none font-semibold tracking-tight tabular-nums">
                  ${plan.price}
                </span>
                <span className="text-muted-foreground text-xs">/ month</span>
              </p>

              <p className="text-muted-foreground text-sm leading-relaxed">{plan.tagline}</p>
            </div>

            <ul className="flex flex-col gap-2.5 text-sm">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2">
                  <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="leading-snug">{feature}</span>
                </li>
              ))}
            </ul>

            {/* `mt-auto` keeps every card's action on the same line when the
                feature lists differ in length. */}
            <Button variant={plan.current ? 'outline' : 'default'} disabled className="mt-auto">
              {plan.current ? 'Current plan' : 'Coming soon'}
            </Button>
          </li>
        ))}
      </ul>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Allowances reset daily at midnight UTC, and images weekly on Monday. Until paid plans are
        live, raising these ceilings is a matter of the API&apos;s quota configuration.
      </p>
    </div>
  );
}

/** The three tiers, in the order they are shown. */
const PLANS = [
  {
    name: 'Free',
    price: 0,
    tagline: 'The whole loop, inside a metered allowance.',
    features: [
      '3 plan generations a day',
      '2 news lookups a day',
      '5 post images a week',
      'X and LinkedIn drafts, approved in Discord',
      '7- and 30-day plans',
    ],
    current: true,
  },
  {
    name: 'Creator',
    price: 5,
    tagline: 'For a posting rhythm that outgrows a daily ceiling.',
    features: ['Everything in Free', '15 plan generations a day', '30 post images a week'],
    current: false,
  },
  {
    name: 'Pro',
    price: 10,
    tagline: 'For running more than one idea at a time.',
    features: [
      'Everything in Creator',
      '40 plan generations a day',
      '100 post images a week',
      'Priority generation when the queue is busy',
    ],
    current: false,
  },
] as const;
