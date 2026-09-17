'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { approvePlanAction } from '@/lib/actions';

/**
 * Approves a draft plan.
 *
 * ## Why approval is a separate, deliberate step
 *
 * A plan consumes quota the moment it is generated, and only an approved plan
 * is allowed to spend more. Splitting "generate the plan" from "approve the
 * plan" means the user can read all the angles, reject the ones they do not
 * like, and only then let generation run — instead of discovering afterwards
 * that they paid for a month of themes they did not want.
 *
 * That is also why the button names the consequence rather than saying "OK".
 *
 * @param props - Component props.
 * @param props.planId - The plan to approve.
 * @returns The approve control.
 * @sideeffect Writes the plan's status.
 */
export function ApprovePlanButton({ planId }: { planId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Approves the plan and reports the result.
   *
   * @returns Resolves when the action settles.
   * @sideeffect Triggers the server action and raises a toast.
   */
  function handleApprove() {
    setError(null);

    startTransition(async () => {
      const result = await approvePlanAction(planId);

      if (!result.ok) {
        setError(result.error);
        toast.error('Could not approve', { description: result.error });
        return;
      }

      toast.success('Plan approved', {
        description: 'You can generate posts from it now.',
      });
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        onClick={handleApprove}
        disabled={isPending}
        className="h-10 gap-2 px-4 font-semibold"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        )}
        {isPending ? 'Approving…' : 'Approve plan'}
      </Button>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
