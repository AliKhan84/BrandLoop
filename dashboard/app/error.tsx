'use client';

import { RouteError } from '@/components/route-error';

/**
 * Error boundary for the root segment.
 *
 * ## Why this exists on top of `(workspace)/error.tsx`
 *
 * A boundary does not catch errors thrown by the layout of its own segment, and
 * the signed-in shell does real work: it reads the session cookie and loads the
 * user and the quota. When the API answers 503 — its database is down — that
 * read is what fails, and without this file Next has nowhere to put the result
 * except its own error page, which replaces the whole document and says nothing
 * useful about what happened.
 *
 * Here the failure lands inside the root layout instead: the page is themed,
 * the copy names the cause, and "Try again" retries the same render.
 *
 * `app/global-error.tsx` still covers the case this cannot — a root layout that
 * fails before this boundary can render — because it is the only screen that
 * does not depend on the layout working.
 *
 * @param props - Component props.
 * @param props.error - The error that escaped the signed-in shell.
 * @param props.reset - Re-renders the tree, retrying the failed reads.
 * @returns The error screen.
 * @sideeffect none (the shared screen logs the error)
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} variant="root" />;
}
