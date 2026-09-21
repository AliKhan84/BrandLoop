import { redirect } from 'next/navigation';

import { BottomNav, SidebarNav } from '@/components/app-nav';
import { BrandLogo } from '@/components/brand-logo';
import { QuotaMeter } from '@/components/quota-meter';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { ApiError, getMe, getUsage } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import type { UsageSummary, User } from '@/lib/types';

/**
 * Shell for every signed-in route.
 *
 * ## The real auth boundary
 *
 * Middleware only checks that a cookie is *present*. This is where it is
 * actually verified: `getMe` forwards it to the API, and a 401 means the token
 * is expired or forged. Redirecting here is what makes the middleware's
 * optimistic check safe.
 *
 * ## Quota loads behind the user, not in front of them
 *
 * The user and the quota are fetched in parallel, and a quota failure does not
 * take the page down. The account is required to render anything; the quota
 * readout is an enhancement, and letting a counter outage block the workspace
 * would be the wrong trade.
 *
 * @param props - Standard layout props.
 * @param props.children - The active route.
 * @returns The application shell.
 * @sideeffect Reads the session cookie; makes two API calls.
 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let user: User;
  try {
    user = await getMe(token);
  } catch (err) {
    // Any auth failure means the cookie is no longer good — sign the visitor
    // out rather than showing a shell that 401s on every subsequent action.
    if (err instanceof ApiError && err.isUnauthorized) redirect('/login');
    throw err;
  }

  // A quota failure degrades to "unknown" rather than blocking the page.
  const usage: UsageSummary | null = await getUsage(token).catch(() => null);

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15rem_1fr]">
      {/*
        Desktop sidebar. Sticky rather than fixed so it participates in the
        grid and the main column does not need a compensating margin.
      */}
      <aside className="bg-sidebar border-sidebar-border sticky top-0 hidden h-dvh flex-col justify-between border-r px-3 py-4 lg:flex">
        <div className="flex flex-col gap-6">
          {/* Brand and the theme switch share the top row. The switch used to
              sit in the bottom cluster beside the account menu, where it read
              as an account preference; at the top it reads as a display
              setting, which is what it is — and it is where a person looks for
              it first. */}
          <div className="flex items-center justify-between gap-2 px-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandLogo className="size-8" priority />
              <span className="text-sidebar-foreground text-base font-semibold tracking-tight">
                BrandLoop
              </span>
            </div>
            <ThemeToggle />
          </div>
          <SidebarNav />
        </div>

        <div className="flex flex-col gap-3">
          {usage && <QuotaMeter usage={usage} variant="sidebar" />}
          {/* Full width now that the theme switch no longer shares the row. */}
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Mobile top bar — the sidebar's contents, reduced to what is needed
            on a phone: identity and the account menu. */}
        <header className="border-border bg-background/95 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <BrandLogo className="size-7" priority />
            <span className="text-base font-semibold tracking-tight">BrandLoop</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {/* `compact` because this bar has no room for a name and an email.
                Rendering the full trigger here measured 231px inside a 320px
                viewport and gave every mobile screen a horizontal scrollbar. */}
            <UserMenu user={user} compact />
          </div>
        </header>

        {/*
          `pb-24` clears the fixed bottom nav on mobile so the last row of
          content is never trapped underneath it.
        */}
        <main className="flex-1 px-4 py-6 pb-24 sm:px-6 lg:px-10 lg:py-8 lg:pb-10">
          {/* Sits above every signed-in page, so an unconfirmed address is
              visible wherever the user lands rather than only in settings.
              Verification is soft — this asks, it does not gate. */}
          {!user.emailVerified && <VerifyEmailBanner email={user.email} />}
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
