'use client';

import { useState, useTransition } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { generateSlotAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

/**
 * Generates one slot's posts on demand.
 *
 * ## Why the button stays disabled for the whole call
 *
 * A slot takes 30-60 seconds on the free tier — two model calls, one per
 * platform. If the button re-enabled optimistically, a second click would spend
 * another plan-generation unit on a slot that is already generating, and the
 * user would get two sets of drafts for the same day. `isPending` from
 * `useTransition` covers the whole action, so the guard is real rather than
 * cosmetic.
 *
 * ## Why it reports what was skipped
 *
 * Generation can partially succeed: one platform's model call may fail, or a
 * news lookup may come back empty and the slot quietly falls back to a planned
 * post. Reporting only "done" would leave the user believing they got two
 * drafts when they got one. The skip reasons come straight from the API.
 *
 * @param props - Component props.
 * @param props.planId - The plan owning the slot.
 * @param props.dayIndex - Which slot to generate. Omit to let the API pick the
 *   next pending one — used by the workspace empty state, where the user has
 *   not chosen a slot and simply wants the next post.
 * @param props.disabled - Set when the plan is not approved yet.
 * @param props.variant - `compact` for the rail, `default` for a full-width row.
 * @returns The generate control.
 * @sideeffect Calls the AI provider, spends quota, delivers Discord DMs.
 */
export function GenerateSlotButton({
  planId,
  dayIndex,
  disabled = false,
  variant = 'compact',
}: {
  planId: string;
  dayIndex?: number;
  disabled?: boolean;
  variant?: 'compact' | 'default';
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Runs the generation and reports the outcome.
   *
   * @returns Resolves when the action settles.
   * @sideeffect Trigers the server action and raises a toast.
   */
  function handleClick() {
    setError(null);

    startTransition(async () => {
      const result = await generateSlotAction(planId, dayIndex);

      if (!result.ok) {
        setError(result.error);
        toast.error('Could not generate', { description: result.error });
        return;
      }

      if (result.generated === 0) {
        // Nothing generated is not a crash — the API reports why. Common cause
        // is every platform failing, or the slot already being generated.
        toast.warning('Nothing new was generated', {
          description: result.skipped.join(' · ') || 'The slot may already be generated.',
        });
        return;
      }

      const skippedNote = result.skipped.length > 0 ? result.skipped.join(' · ') : undefined;

      toast.success(
        result.generated === 1 ? 'Post generated' : `${result.generated} posts generated`,
        {
          description: skippedNote ?? 'Waiting in Discord for your approval.',
        },
      );
    });
  }

  const label = isPending ? 'Generating…' : 'Generate';
  // With no specific slot, "next" is what the API will do — the label says so
  // rather than implying the user picked something.
  const slotLabel = dayIndex === undefined ? 'the next slot' : `day ${dayIndex}`;

  if (variant === 'compact') {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={handleClick}
        disabled={disabled || isPending}
        aria-label={`Generate posts for ${slotLabel}`}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        {isPending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-3.5" aria-hidden="true" />
        )}
        {isPending ? 'Working…' : 'Generate'}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        onClick={handleClick}
        disabled={disabled || isPending}
        className={cn('h-11 gap-2 px-5 text-base font-semibold')}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Sparkles className="size-4" aria-hidden="true" />
        )}
        {isPending ? 'Generating… this takes up to a minute' : label}
      </Button>

      {/* Inline as well as a toast, because a toast disappears and the reason
          for a failure is worth keeping on screen. */}
      {error && (
        <p role="alert" className="text-destructive max-w-prose text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
