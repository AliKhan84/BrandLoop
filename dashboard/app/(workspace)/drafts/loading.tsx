import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for the drafts list.
 *
 * Mirrors the real card stack so the layout does not shift on arrival.
 *
 * @returns The loading skeleton.
 * @sideeffect none
 */
export default function DraftsLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your drafts</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-56" />
      </div>

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="border-border rounded-lg border p-5">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex flex-col gap-2.5">
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-10/12" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
