import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the workspace.
 *
 * ## Why skeletons and not a spinner
 *
 * A spinner says "wait"; a skeleton says "a two-column surface with a list on
 * the left and drafts on the right is about to appear here". The second is
 * information. Because this mirrors the real layout, nothing jumps when the
 * content arrives — the page simply resolves in place.
 *
 * The shapes match the actual components: a narrow rail of slot rows, and a
 * stack of draft cards with a text block roughly the height of one post.
 *
 * @returns The loading skeleton.
 * @sideeffect none
 */
export default function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      {/* Announces the wait to assistive tech, which cannot see the shapes. */}
      <span className="sr-only">Loading your workspace</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-16" />
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2 py-2">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-16" />
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="border-border rounded-lg border p-5">
              <div className="mb-4 flex items-center gap-3">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              {/* Several line-shaped blocks to imitate a real post body. */}
              <div className="flex flex-col gap-2.5">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-11/12" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
