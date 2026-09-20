'use client';

import { useEffect } from 'react';
import { AlertTriangle, DatabaseZap, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** What actually failed, as far as this screen can tell. */
type Cause = 'unreachable' | 'unavailable' | 'unknown';

/**
 * Decides which failure this is, so the screen can name it.
 *
 * ## Why this matches on the message
 *
 * The tidy version of this would test `error instanceof ApiError` and read its
 * status code — and for an error raised in a *client* component that works. It
 * does not for the case that matters here: an error thrown while rendering
 * arrives across the server boundary as a plain `Error`, and in production Next
 * strips its message down to a digest. So there is nothing left to type-check
 * against.
 *
 * What remains is the wording the API client itself produces, which survives in
 * development and is where this screen is most useful. In production the
 * fallback copy is what a reader sees, which is why it has to stand on its own.
 *
 * `lib/api.ts` is deliberately not imported for the type: it is `server-only`,
 * and reaching for it from here fails the build.
 *
 * @param error - The error that reached the boundary.
 * @returns The cause to describe.
 * @sideeffect none (pure)
 */
function classify(error: Error): Cause {
  if (/cannot reach the brandloop api/i.test(error.message)) return 'unreachable';
  if (/cannot reach its database/i.test(error.message)) return 'unavailable';

  return 'unknown';
}

/**
 * The screen for a route that could not render.
 *
 * ## Why this is shared rather than written twice
 *
 * Two boundaries need it: one inside the signed-in shell (a page failed) and one
 * at the root (the shell itself failed, so there is no sidebar to put a message
 * in). Two copies of this would eventually disagree about what to say, and the
 * copy is the entire product value of the screen.
 *
 * ## Why the copy names causes instead of saying "an error occurred"
 *
 * The most likely failure in local development is that the Express API is not
 * running. A generic message sends the reader looking for a bug in the
 * dashboard, when the fix is a command they have not run. The same logic
 * applies to the database being down: it is a wait, not an investigation.
 *
 * ## What it deliberately does not show
 *
 * The raw message appears only in development. In production a stack or an
 * internal identifier tells an attacker about the system and tells the user
 * nothing they can act on.
 *
 * @param props - Component props.
 * @param props.error - The error that propagated from the route.
 * @param props.reset - Re-renders the segment, retrying the failed work.
 * @param props.variant - `workspace` fills the content area of the shell;
 *   `root` fills the whole page, because the shell is what failed.
 * @returns The error screen.
 * @sideeffect Logs the error to the console for the developer.
 */
export function RouteError({
  error,
  reset,
  variant = 'workspace',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  variant?: 'workspace' | 'root';
}) {
  useEffect(() => {
    console.error('Route failed:', error);
  }, [error]);

  const cause = classify(error);
  const isDev = process.env.NODE_ENV === 'development';

  const Icon = cause === 'unavailable' ? DatabaseZap : AlertTriangle;

  return (
    <div
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-6',
        variant === 'root' ? 'min-h-dvh justify-center px-6 py-12' : 'py-8',
      )}
    >
      <div className="flex items-start gap-4">
        <Icon className="text-destructive mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {cause === 'unreachable' && 'The BrandLoop API is not reachable'}
            {cause === 'unavailable' && 'BrandLoop is briefly without its database'}
            {cause === 'unknown' && 'Something went wrong'}
          </h1>

          <p className="text-muted-foreground text-sm leading-relaxed">
            {cause === 'unreachable' &&
              'The dashboard is running, but it could not reach the API that generates and stores your posts. This is usually because it is not started.'}
            {cause === 'unavailable' &&
              'The API is up, but it cannot reach its database right now. That is an outage on the database side, not a problem with this screen, and nothing was changed. Trying again in a moment usually works.'}
            {cause === 'unknown' &&
              'This screen could not load its data. Trying again is safe — nothing was changed.'}
          </p>
        </div>
      </div>

      {cause === 'unreachable' && (
        <div className="border-border bg-muted/40 flex flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm font-medium">Start it in a second terminal:</p>
          <code className="bg-background border-border rounded border px-3 py-2 font-mono text-sm">
            npm run dev
          </code>
          <p className="text-muted-foreground text-xs">
            Run from the project root, not from <code>dashboard/</code>. It listens on port 8080.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={reset} className="h-10 gap-2 px-4 font-semibold">
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>

      {isDev && (
        <details className="border-border rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">Developer detail</summary>
          <pre className="text-muted-foreground mt-3 overflow-x-auto font-mono text-xs whitespace-pre-wrap">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        </details>
      )}
    </div>
  );
}
