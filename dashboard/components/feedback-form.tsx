'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { submitFeedbackAction } from '@/lib/actions';
import { cn } from '@/lib/utils';

/** The categories, with the label the user sees. */
const CATEGORIES = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'idea', label: 'An idea' },
  { value: 'praise', label: 'Something works well' },
  { value: 'other', label: 'Something else' },
] as const;

/**
 * The feedback form.
 *
 * ## Why the category is radios and not a select
 *
 * Four options, each a short sentence — a dropdown would hide three of them
 * behind a click and make the choice feel heavier than it is. Radios also keep
 * the whole form reachable by keyboard in one pass.
 *
 * ## Why the rating is optional and starts unset
 *
 * A default of 3 would record a rating the user never gave, and every average
 * computed from the column afterwards would be wrong in a way nobody could
 * detect. "Not rated" is a real answer and is stored as null.
 *
 * @param props - Component props.
 * @param props.page - The screen the form was rendered on, stored with the
 *   message so a bug report has context.
 * @returns The form, or a thank-you once it has been sent.
 * @sideeffect Submits a server action.
 */
export function FeedbackForm({ page }: { page: string }) {
  const [state, formAction, isPending] = useActionState(submitFeedbackAction, EMPTY_ACTION_STATE);

  if (state.success) {
    return (
      <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
        <p role="status" className="text-status-approved text-sm font-medium">
          {state.success}
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Every message is read. If it is a bug, saying which screen and what you expected to happen
          is what makes it fixable.
        </p>
        <Link
          href="/feedback"
          className="text-primary text-sm font-medium underline-offset-4 hover:underline"
        >
          Send another
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="page" value={page} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">What kind of message is this?</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category, index) => (
            <label
              key={category.value}
              className={cn(
                'border-border bg-card cursor-pointer rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                // Focus and selection both move to the label so the control has a
                // visible target — the radio itself is visually hidden, not
                // display:none, which would remove it from the keyboard order.
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                'has-[:checked]:border-primary/60 has-[:checked]:bg-primary/10 has-[:checked]:font-medium',
              )}
            >
              <input
                type="radio"
                name="category"
                value={category.value}
                defaultChecked={index === 1}
                className="sr-only"
              />
              {category.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rating">How is it going overall? (optional)</Label>
        <select
          id="rating"
          name="rating"
          defaultValue=""
          className="border-input bg-background h-9 w-fit rounded-md border px-2 text-sm"
        >
          <option value="">Not rated</option>
          <option value="5">5 — genuinely useful</option>
          <option value="4">4</option>
          <option value="3">3</option>
          <option value="2">2</option>
          <option value="1">1 — not working for me</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="message">Your message</Label>
        <Textarea
          id="message"
          name="message"
          rows={7}
          required
          minLength={5}
          maxLength={4000}
          placeholder="What happened, what you expected, and what would make it better."
          aria-invalid={Boolean(state.fieldErrors?.message)}
          aria-describedby={state.fieldErrors?.message ? 'message-error' : undefined}
        />
        {state.fieldErrors?.message && (
          <p id="message-error" className="text-destructive text-sm">
            {state.fieldErrors.message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="gap-2" disabled={isPending}>
          <Send className="size-4" aria-hidden="true" />
          {isPending ? 'Sending…' : 'Send feedback'}
        </Button>
        {state.error && (
          <span role="alert" className="text-destructive text-sm">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
