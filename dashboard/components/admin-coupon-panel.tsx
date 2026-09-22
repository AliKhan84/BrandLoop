'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { createCouponAction, setCouponActiveAction } from '@/lib/actions';
import type { Coupon } from '@/lib/types';

/**
 * Coupon list and creation form.
 *
 * ## Why create and toggle live in one client component
 *
 * Both are small forms posting to server actions, and they share the coupon list
 * they revalidate. Splitting them would mean passing the same list through two
 * boundaries for no benefit.
 *
 * ## Why an empty duration means "forever"
 *
 * The API models `durationDays: null` and `maxRedemptions: null` as "no end" and
 * "no cap". An empty text field must therefore become null rather than 0 — a
 * zero-day grant would be a coupon that does nothing.
 *
 * @param props - Component props.
 * @param props.coupons - Every coupon, newest first.
 * @returns The admin panel.
 * @sideeffect Submits server actions.
 */
export function AdminCouponPanel({ coupons }: { coupons: Coupon[] }) {
  const [createState, createAction, isCreating] = useActionState(
    createCouponAction,
    EMPTY_ACTION_STATE,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="border-border bg-card flex flex-col gap-5 rounded-lg border p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">Create a code</h2>
          <p className="text-muted-foreground text-xs">
            Leave the code empty to generate one, and leave a number empty for forever.
          </p>
        </div>

        <form action={createAction} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                name="code"
                placeholder="auto"
                autoComplete="off"
                spellCheck={false}
                className="h-9 font-mono uppercase"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kind">Grants</Label>
              {/* A native select: there is no select primitive in components/ui,
                  and a two-option control does not justify building one. */}
              <select
                id="kind"
                name="kind"
                defaultValue="pro"
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="pro">Pro tier</option>
                <option value="unlimited">Unlimited usage</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="durationDays">Duration</Label>
              {/*
                A preset list rather than a raw day count. "180" makes the
                operator do date arithmetic to answer a question they are
                actually asking in months, and a wrong number here is a grant
                that quietly ends early — the kind of mistake nobody notices
                until a customer does.

                The empty value means forever, which is what the server action
                already does with an empty field: `null`, never zero.
              */}
              <select
                id="durationDays"
                name="durationDays"
                defaultValue=""
                className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              >
                <option value="">Forever (no expiry)</option>
                <option value="30">1 month</option>
                <option value="90">3 months</option>
                <option value="180">6 months</option>
                <option value="365">1 year</option>
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="maxRedemptions">Uses</Label>
              <Input
                id="maxRedemptions"
                name="maxRedemptions"
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="unlimited"
                className="h-9"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">Note</Label>
            <Input
              id="note"
              name="note"
              placeholder="Who is this for?"
              maxLength={200}
              className="h-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" disabled={isCreating}>
              <Plus className="size-4" aria-hidden="true" />
              {isCreating ? 'Creating…' : 'Create coupon'}
            </Button>

            {createState.success && (
              <span role="status" className="text-status-approved text-sm">
                {createState.success}
              </span>
            )}
            {createState.error && (
              <span role="alert" className="text-destructive text-sm">
                {createState.error}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight">
          {coupons.length} code{coupons.length === 1 ? '' : 's'}
        </h2>

        {coupons.length === 0 ? (
          <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
            No codes yet. Create one above and share it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {coupons.map((coupon) => (
              <CouponRow key={coupon.id} coupon={coupon} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * One coupon row, with its toggle.
 *
 * @param props - Component props.
 * @param props.coupon - The coupon to render.
 * @returns The row.
 * @sideeffect Submits a server action.
 */
function CouponRow({ coupon }: { coupon: Coupon }) {
  const [state, action, isPending] = useActionState(setCouponActiveAction, EMPTY_ACTION_STATE);

  const uses =
    coupon.maxRedemptions === null
      ? `${coupon.redemptionCount} used, no cap`
      : `${coupon.redemptionCount}/${coupon.maxRedemptions} used`;

  return (
    <li className="border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-4 py-3">
      <span className="font-mono text-sm font-semibold tracking-tight">{coupon.code}</span>

      <Badge variant="secondary">
        {coupon.kind === 'unlimited' ? 'Unlimited' : 'Pro'}
        {coupon.durationDays === null ? ' · forever' : ` · ${coupon.durationDays}d`}
      </Badge>

      <span className="text-muted-foreground text-xs tabular-nums">{uses}</span>

      {coupon.note && <span className="text-muted-foreground text-xs italic">{coupon.note}</span>}

      {/* Status is a word, not just a colour. */}
      <span
        className={
          coupon.isActive
            ? 'text-status-approved ml-auto text-xs font-medium'
            : 'text-muted-foreground ml-auto text-xs font-medium'
        }
      >
        {coupon.isActive ? 'Active' : 'Disabled'}
      </span>

      <form action={action}>
        <input type="hidden" name="couponId" value={coupon.id} />
        <input type="hidden" name="isActive" value={coupon.isActive ? 'false' : 'true'} />
        <Button type="submit" size="sm" variant="outline" disabled={isPending}>
          {isPending ? 'Saving…' : coupon.isActive ? 'Disable' : 'Enable'}
        </Button>
      </form>

      {state.error && (
        <span role="alert" className="text-destructive w-full text-xs">
          {state.error}
        </span>
      )}
    </li>
  );
}
