import type { Metadata } from 'next';

import { AuthForm } from '@/components/auth-form';
import { signInAction } from '@/lib/actions';

export const metadata: Metadata = {
  title: 'Sign in · BrandLoop',
};

/**
 * Sign-in route.
 *
 * The heading carries the page; the form does the work. No welcome copy beyond
 * one line, because someone arriving here already decided to sign in and does
 * not need to be sold to again.
 *
 * Takes `error` from the query string because the Google callback sends its
 * failures back here rather than rendering a screen of its own — someone who
 * just cancelled a consent prompt should land on the form they started from,
 * with a sentence saying what happened.
 *
 * @param props - Route props.
 * @param props.searchParams - Next 16 hands these in as a promise.
 * @returns The sign-in screen.
 * @sideeffect none
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted-foreground text-sm">
          Pick up your plan where you left it.
        </p>
      </header>

      <AuthForm mode="signin" action={signInAction} submitLabel="Sign in" error={error} />
    </>
  );
}
