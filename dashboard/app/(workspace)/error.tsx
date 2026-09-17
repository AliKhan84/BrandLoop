'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Error boundary for every signed-in route.
 *
 * ## Why this exists at all
 *
 * The most likely failure in local development is that the Express API is not
 * running — the dashboard boots fine and every data call fails. Without this
 * boundary, Next.js shows its generic error overlay, which says something went
 * wrong but not *what*, and a user reasonably concludes the dashboard is broken
 * when it is actually waiting for a server they have not started.
 *
 * So the copy names the likely cause and the exact command that fixes it. That
 * is the difference between an error state and a recovery path.
 *
 * ## What it deliberately does not show
 *
 * The raw error message is rendered only in development. In production a stack
 * trace or an internal identifier in an error screen tells an attacker about
 * the system and tells the user nothing they can act on.
 *
 * @param props - Component props.
 * @param props.error - The error that propagated from the route.
 * @param props.reset - Re-renders the segment, retrying the failed fetch.
 * @returns The error screen.
 * @sideeffect Logs the error to the console for the developer.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Workspace route failed:', error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  // The API client produces this phrasing when it cannot open a connection.
  // Matching on it lets the screen give the specific fix rather than a generic
  // "try again", which would not help.
  const looksLikeApiDown = /cannot reach the brandloop api/i.test(error.message);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-8">
      <div className="flex items-start gap-4">
        <AlertTriangle className="text-destructive mt-0.5 size-6 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold tracking-tight">
            {looksLikeApiDown ? 'The BrandLoop API is not reachable' : 'Something went wrong'}
          </h1>

          <p className="text-muted-foreground text-sm leading-relaxed">
            {looksLikeApiDown
              ? 'The dashboard is running, but it could not reach the API that generates and stores your posts. This is usually because it is not started.'
              : 'This screen could not load its data. Trying again is safe — nothing was changed.'}
          </p>
        </div>
      </div>

      {looksLikeApiDown && (
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
