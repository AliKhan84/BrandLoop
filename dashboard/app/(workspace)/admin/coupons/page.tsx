import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminCouponPanel } from '@/components/admin-coupon-panel';
import { ApiError, getMe, listCoupons } from '@/lib/api';
import { getSessionToken } from '@/lib/session';

/**
 * Admin — coupon management.
 *
 * ## Why the page checks the role as well as the API
 *
 * The API refuses every admin route to a non-admin, so this is not the security
 * boundary. It is here so a signed-in non-admin who guesses the URL gets a 404
 * rather than a page full of failed requests that look like an outage.
 *
 * @returns The admin page.
 * @sideeffect Reads the session and makes two API calls.
 */
export default async function AdminCouponsPage() {
  const token = await getSessionToken();
  if (!token) notFound();

  let user;
  try {
    user = await getMe(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) notFound();
    throw err;
  }

  // A non-admin gets an explanation, not a 404. The usual instinct is to hide
  // the page's existence, but the most likely visitor is the operator whose own
  // account has not been promoted yet — and to them this 404 is indistinguishable
  // from a typo'd URL, with the one-line fix invisible. The API refuses the data
  // either way.
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Admin access required</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          This account is a normal user, so the admin pages stay hidden. Promote it once from the
          project folder — it takes effect immediately, with no sign-out, because the role is read
          from the database on every request:
        </p>
        <pre className="border-border bg-card overflow-x-auto rounded-lg border px-4 py-3 text-xs">
          npm run make-admin -- --email {user.email}
        </pre>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Then reload this page. To undo it, run the same command with <code>--revoke</code>.
        </p>
      </div>
    );
  }

  const coupons = await listCoupons(token);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Coupons</h1>
        <p className="text-muted-foreground text-sm">
          Codes anyone can redeem from the billing page. An unlimited code bypasses every metered
          quota; a Pro code grants the Pro tier for a period. The{' '}
          <Link href="/admin/feedback" className="text-primary font-medium underline-offset-4 hover:underline">
            feedback inbox
          </Link>{' '}
          is the other admin page.
        </p>
      </header>

      <AdminCouponPanel coupons={coupons} />
    </div>
  );
}
