import Link from 'next/link';
import { CheckCircle2, MailWarning } from 'lucide-react';

import { BrandLogo } from '@/components/brand-logo';
import { buttonVariants } from '@/components/ui/button';
import { ApiError, getMe, verifyEmail } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import type { User } from '@/lib/types';

/**
 * The page a verification link lands on.
 *
 * ## Why it is outside the workspace and outside the auth routes
 *
 * Someone opening this link is frequently not signed in — they are in their
 * mailbox, often on a phone. Requiring a session would break the most common
 * way of clicking it. It is also deliberately not in `AUTH_ROUTES`, because
 * those redirect a signed-in visitor away to `/workspace`, which would hide the
 * result of the click from exactly the people most likely to make it.
 *
 * ## Why a GET redeems the token
 *
 * The link has to be clickable, so the redemption is a GET — the standard shape
 * for email confirmation, and the reason the token is single-use and expiring.
 * A second visit is not treated as an error: if the visitor is signed in and
 * their profile already says confirmed, this reads as success, because that is
 * what it is. Double-clicking a link, or opening it again after upgrading a
 * browser session, is normal behaviour and should not look like a failure.
 *
 * @param props - Page props.
 * @param props.searchParams - Awaited per Next 15+; carries `token`.
 * @returns The result screen.
 * @sideeffect Confirms the address when the token is valid.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { token } = await searchParams;
  const rawToken = Array.isArray(token) ? token[0] : token;

  const sessionToken = await getSessionToken();
  // Loaded so the screen can send the visitor somewhere sensible, and so an
  // already-verified address is recognised instead of reported as a bad link.
  const viewer: User | null = sessionToken ? await getMe(sessionToken).catch(() => null) : null;

  let state: 'verified' | 'already' | 'failed';
  let failureMessage = '';

  if (rawToken) {
    try {
      await verifyEmail(rawToken);
      state = 'verified';
    } catch (err) {
      if (viewer?.emailVerified) {
        state = 'already';
      } else {
        state = 'failed';
        failureMessage =
          err instanceof ApiError
            ? err.message
            : 'The link could not be checked. Please try again.';
      }
    }
  } else if (viewer?.emailVerified) {
    state = 'already';
  } else {
    state = 'failed';
    failureMessage =
      'This link is missing its token. Open the button in the email itself — some clients cut long links when they wrap.';
  }

  const confirmed = state !== 'failed';
  const destinations = viewer
    ? [{ href: '/workspace', label: 'Go to your workspace' }]
    : [
        { href: '/login', label: 'Sign in' },
        { href: '/signup', label: 'Create an account' },
      ];

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-16">
      <div className="flex items-center gap-2.5">
        <BrandLogo className="size-8" priority />
        <span className="text-base font-semibold tracking-tight">BrandLoop</span>
      </div>

      <section className="border-border bg-card flex flex-col gap-3 rounded-lg border p-6">
        <span
          className={confirmed ? 'text-status-approved' : 'text-muted-foreground'}
          aria-hidden="true"
        >
          {confirmed ? <CheckCircle2 className="size-6" /> : <MailWarning className="size-6" />}
        </span>

        <h1 className="font-heading text-xl leading-tight font-semibold">
          {state === 'verified' && 'Email confirmed'}
          {state === 'already' && 'This address is already confirmed'}
          {state === 'failed' && 'We could not confirm this link'}
        </h1>

        <p className="text-muted-foreground text-sm leading-relaxed">
          {state === 'verified' &&
            'Thanks — the address on your account is confirmed. Nothing else changes; you can carry on as before.'}
          {state === 'already' &&
            'Nothing to do. The link has been used, or the address was confirmed another way.'}
          {state === 'failed' && failureMessage}
        </p>

        <div className="mt-1 flex flex-wrap gap-2">
          {destinations.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              {destination.label}
            </Link>
          ))}
        </div>
      </section>

      <p className="text-muted-foreground text-xs leading-relaxed">
        Verification is optional — an unconfirmed account can still sign in and generate posts. If a
        link has expired, the workspace banner can send a new one.
      </p>
    </main>
  );
}
