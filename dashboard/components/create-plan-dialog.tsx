'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createPlanAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

/**
 * Creates a new content plan.
 *
 * ## What this dialog has to communicate before the user commits
 *
 * Three things, in this order:
 *
 *   1. **What a plan is.** "7 days" alone does not say it produces a fixed set
 *      of angles that you then approve.
 *   2. **What it costs.** Generating a plan spends one plan-generation unit,
 *      and on the free tier that is a real fraction of the day's budget. Saying
 *      so up front is the difference between a considered choice and a surprise.
 *   3. **What happens next.** The plan arrives as a draft to review, not as
 *      finished posts — which is the part people get wrong.
 *
 * ## Why the duration is two large targets, not a select
 *
 * There are exactly two valid values and they mean different things to a user
 * ("a week" vs "a month"). A dropdown hides both behind a click and makes a
 * two-option decision feel like a form.
 */

/** The two supported plan lengths, with the reason each exists. */
const DURATIONS = [
  {
    value: 7 as const,
    label: '7 days',
    hint: 'A working week. Good for testing the output before committing to more.',
  },
  {
    value: 30 as const,
    label: '30 days',
    hint: 'A month. Around 9 to 17 posts depending on your posting frequency.',
  },
];

/**
 * Renders the create-plan dialog.
 *
 * @param props - Component props.
 * @param props.postFrequency - The user's posts-per-week setting, used to show
 *   how many slots each duration will produce.
 * @returns The dialog and its trigger.
 * @sideeffect Calls the AI provider and spends quota on success.
 */
export function CreatePlanDialog({
  postFrequency,
  hasExistingPlan = false,
}: {
  postFrequency: number;
  hasExistingPlan?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<7 | 30>(7);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Estimates the number of posting slots a duration will produce.
   *
   * Mirrors `buildPlanSlots` on the API — `round(frequency × days / 7)`. Shown
   * before generating so "30 days" is a concrete number of posts rather than an
   * abstraction.
   *
   * @param days - The plan length in days.
   * @returns The expected slot count.
   * @sideeffect none (pure)
   */
  function estimateSlots(days: number): number {
    return Math.max(1, Math.round((postFrequency * days) / 7));
  }

  /**
   * Generates the plan.
   *
   * @returns Resolves when the action settles.
   * @sideeffect Triggers the server action, then navigates to the new plan.
   */
  function handleCreate() {
    setError(null);

    startTransition(async () => {
      const result = await createPlanAction(selected);

      if (!result.ok) {
        // Stays open on failure so the user can retry without reopening and
        // re-picking — the common failure here is an exhausted quota, which a
        // retry later in the day will clear.
        setError(result.error);
        toast.error('Could not create the plan', { description: result.error });
        return;
      }

      setOpen(false);
      toast.success('Plan ready', { description: 'Review the angles, then approve it.' });
      // Refresh so the new draft plan replaces whatever the workspace is showing.
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="h-10 gap-2 px-4 font-semibold">
            <Plus className="size-4" aria-hidden="true" />
            {hasExistingPlan ? 'New plan' : 'Create a plan'}
          </Button>
        }
      />

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How far ahead?</DialogTitle>
          <DialogDescription>
            BrandLoop writes one angle per posting slot. You review the whole list before any posts
            are generated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2" role="radiogroup" aria-label="Plan length">
          {DURATIONS.map((duration) => {
            const isSelected = selected === duration.value;
            const slots = estimateSlots(duration.value);

            return (
              <button
                key={duration.value}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(duration.value)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors',
                  isSelected
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent/50',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  {duration.label}
                  <span className="text-muted-foreground font-normal">
                    · {slots} post{slots === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="text-muted-foreground text-xs leading-relaxed">
                  {duration.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* Stated before the click, not after. This spends a real unit of a
            20-per-day allowance. */}
        <p className="text-muted-foreground text-xs leading-relaxed">
          Creating a plan uses one of your plan generations for today. The plan arrives as a draft —
          generating the actual posts is a separate step you control per slot.
        </p>

        {error && (
          <p
            role="alert"
            className="text-destructive bg-destructive/8 border-destructive/25 rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending} className="gap-2 font-semibold">
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isPending ? 'Writing your plan…' : 'Create plan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
