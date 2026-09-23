import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AdminPaymentQueue } from '@/components/admin-payment-queue';
import { ApiError, getMe, listPayments } from '@/lib/api';
import { getSessionToken } from '@/lib/session';

export const metadata = { title: 'Payments · BrandLoop' };

/**
 * Admin — the payment reconciliation queue.
 *
 * ## Why the page checks the role as well as the API
 *
 * The API refuses every admin route to a non-admin, so this is not the security
 * boundary. It is here so a signed-in non-admin who guesses the URL gets an
 * explanation rather than a page full of failed requests that look like an
 * outage.
 *
 * ## Why the settled list is fetched separately
 *
 * The queue and the history want different orderings, and the API owns both: a
 * waiting claim is sorted by what is at risk, while settled claims are just
 * newest first. Asking for them together would mean re-sorting one of them here,
 * which is how a client and a server end up disagreeing about which row is
 * urgent.
 *
 * @returns The admin page.
 * @sideeffect Reads the session and makes three API calls.
 */
export default async function AdminPaymentsPage() {
  const token = await getSessionToken();
  if (!token) notFound();

  let user;
  try {
    user = await getMe(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) notFound();
    throw err;
  }

  // A non-admin gets an explanation, not a 404: the most likely visitor is the
  // operator whose own account has not been promoted yet, and to them a 404 is
  // indistinguishable from a typo. The API refuses the data either way.
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

  const [awaiting, all] = await Promise.all([
    listPayments(token, 'awaiting'),
    listPayments(token, 'all'),
  ]);

  // The settled tail of the same list — pending rows are already in the queue
  // above, and showing them twice would make the queue look longer than it is.
  const settled = all.filter((payment) => payment.status !== 'pending').slice(0, 10);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Payments</h1>
        <p className="text-muted-foreground text-sm">
          Claims customers have submitted by bank transfer, Raast, JazzCash or Easypaisa. Match the
          reference against the statement, then confirm it — or revoke it if the money is not there.{' '}
          <Link href="/admin/coupons" className="text-primary font-medium underline-offset-4 hover:underline">
            Coupons
          </Link>{' '}
          and the{' '}
          <Link href="/admin/feedback" className="text-primary font-medium underline-offset-4 hover:underline">
            feedback inbox
          </Link>{' '}
          are the other admin pages.
        </p>
      </header>

      <AdminPaymentQueue awaiting={awaiting} settled={settled} />
    </div>
  );
}
