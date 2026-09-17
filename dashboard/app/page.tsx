import { redirect } from 'next/navigation';

import { getSessionToken } from '@/lib/session';

/**
 * Root route.
 *
 * Sends the visitor to the workspace if they hold a session, and to the login
 * screen otherwise. A server redirect rather than a rendered page, so there is
 * never a flash of empty content at the root.
 *
 * @returns Never returns — always redirects.
 * @sideeffect none beyond the redirect
 */
export default async function Home() {
  const token = await getSessionToken();
  redirect(token ? '/workspace' : '/login');
}
