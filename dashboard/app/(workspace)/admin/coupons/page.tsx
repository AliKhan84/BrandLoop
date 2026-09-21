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

  if (user.role !== 'admin') notFound();

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
