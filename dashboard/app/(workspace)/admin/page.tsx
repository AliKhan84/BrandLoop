import { redirect } from 'next/navigation';

/**
 * `/admin` on its own — sends the visitor to the first admin page.
 *
 * There is no dashboard here; the two admin screens are siblings. Without this,
 * typing the obvious `/admin` gives a 404, which reads as "the admin area does
 * not exist" rather than "you left off the last segment".
 *
 * @returns Never returns — always redirects.
 * @sideeffect Issues a redirect.
 */
export default function AdminIndexPage() {
  redirect('/admin/coupons');
}
