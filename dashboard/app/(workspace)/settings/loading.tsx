import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading state for settings.
 *
 * Same reasoning as the other skeletons: it mirrors the real section structure
 * so the page resolves in place rather than jumping.
 *
 * @returns The loading skeleton.
 * @sideeffect none
 */
export default function SettingsLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your settings</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-72" />
      </div>

      {Array.from({ length: 2 }).map((_, section) => (
        <div key={section} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-4 w-full max-w-sm" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}
