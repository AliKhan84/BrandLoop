import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ContentPlan } from '@/lib/types';

/**
 * Where this plan is in its lifecycle, and what happens next.
 *
 * ## Why this exists
 *
 * The workspace said "Drafts are delivered to your Discord DMs" and offered an
 * "Approve plan" button — and that was the whole explanation. Two things were
 * left unsaid, and both produce the same support question:
 *
 *   • Approving does not generate anything. It only makes the slots
 *     generatable. A user who approves and waits sees an empty Drafts panel and
 *     reasonably concludes the product is broken.
 *   • The daily job advances ONE slot per day. Without that, a plan that drips
 *     in one post at a time looks like it is failing intermittently.
 *
 * So the three steps are stated, and the one the plan is currently on is the
 * one that reads as active.
 *
 * ## Why not in the EmptyStates
 *
 * Those explain the current state well, but they only appear when the Drafts
 * panel is empty. The gap is widest exactly when the panel *has* content and a
 * user is wondering why the rest has not arrived.
 */
export function PlanWorkflow({ plan }: { plan: ContentPlan }) {
  const isDraft = plan.status === 'draft';
  const hasPending = plan.progress.pending > 0;
  const isComplete = plan.status === 'completed' || !hasPending;

  // Which step reads as active is derived inside the list below rather than
  // stored — the plan's own status and progress already say where it is, and a
  // separate cursor could only disagree with them.
  const approvedStep = !isDraft;
  const generatedStep = plan.progress.generated > 0;

  const steps = [
    {
      title: 'Review the angles',
      body: 'One angle per slot, written for your niche. Nothing has been generated yet.',
      isDone: !isDraft,
      isCurrent: isDraft,
    },
    {
      title: 'Approve the plan',
      body: 'Approving enables generation. It does not write anything by itself.',
      isDone: approvedStep && generatedStep,
      isCurrent: approvedStep && !generatedStep && hasPending,
    },
    {
      title: 'Generate posts',
      body: 'Use Generate on any slot, or let the daily job take one slot per day at 09:00. Drafts then arrive here and in Discord — nothing publishes without your approval.',
      isDone: isComplete && generatedStep,
      isCurrent: approvedStep && generatedStep && hasPending,
    },
  ];

  return (
    <section aria-labelledby="workflow-heading" className="flex flex-col gap-3">
      <h2 id="workflow-heading" className="text-sm font-semibold tracking-tight">
        How this works
      </h2>

      <ol className="flex flex-col gap-2.5">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold tabular-nums',
                step.isCurrent
                  ? 'border-primary bg-primary text-primary-foreground'
                  : step.isDone
                    ? 'border-status-approved/40 text-status-approved'
                    : 'border-border text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {step.isDone ? <Check className="size-3" /> : index + 1}
            </span>

            <div className="flex min-w-0 flex-col gap-0.5">
              <p
                className={cn(
                  'text-xs font-medium',
                  // Only the current step is emphasised. Bolding all three would
                  // make the list look like a menu rather than a position.
                  step.isCurrent ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.title}
                {step.isCurrent && <span className="sr-only"> — you are here</span>}
              </p>
              <p className="text-muted-foreground text-xs leading-relaxed">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
