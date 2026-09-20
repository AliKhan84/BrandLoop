'use client';

import { RouteError } from '@/components/route-error';

/**
 * Error boundary for every signed-in route.
 *
 * Catches failures in the *pages* of the shell — a workspace slot that could not
 * load, a draft list that lost its connection. The shell itself is not covered
 * here: a boundary never catches an error thrown by the layout of its own
 * segment, so a failure in `(workspace)/layout.tsx` (the auth check, the user
 * and quota reads) is caught by `app/error.tsx` instead.
 *
 * @param props - Component props.
 * @param props.error - The error that propagated from the route.
 * @param props.reset - Re-renders the segment, retrying the failed fetch.
 * @returns The error screen.
 * @sideeffect none (the shared screen logs the error)
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} variant="workspace" />;
}
