'use client';

import { useState, useTransition } from 'react';
import { Loader2, Pencil } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateSlotAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import type { PlanDay } from '@/lib/types';

/**
 * Edits one plan slot's angle, and whether it draws on news.
 *
 * ## Why this exists
 *
 * The plan is the model's first pass at "what should you say". Reviewing a list
 * of angles you cannot change is not reviewing — the only options were to accept
 * an angle you did not like or throw the whole plan away and spend another
 * generation. This makes the list editable before any of it costs a model call.
 *
 * ## Why only before generation
 *
 * Once a slot has produced posts the angle has already been written against, so
 * changing it would look like it worked and change nothing. The API returns 409
 * in that case and the dialog reports it rather than pretending to save.
 *
 * ## Why the fields are uncontrolled
 *
 * The form is submitted to a server action, so the values are read from the DOM.
 * Each field is keyed on its initial value for the same reason `profile-form`
 * keys its inputs: an uncontrolled field reads `defaultValue` once, and the
 * `key` re-initialises it when the server value changes rather than silently
 * keeping a stale one.
 *
 * @param props - Component props.
 * @param props.planId - The plan owning the slot.
 * @param props.slot - The slot being edited.
 * @returns The edit button and its dialog.
 * @sideeffect Writes the slot on save; revalidates the workspace.
 */
export function EditSlotDialog({ planId, slot }: { planId: string; slot: PlanDay }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    const theme = String(formData.get('theme') ?? '').trim();
    const type = String(formData.get('type') ?? slot.type) as 'planned' | 'news';

    if (!theme) {
      toast.error('An angle cannot be empty', { description: 'Write what this post should say.' });
      return;
    }

    startTransition(async () => {
      const result = await updateSlotAction(planId, slot.dayIndex, { theme, type });

      if (!result.ok) {
        toast.error('Could not save the angle', { description: result.error });
        return;
      }

      setOpen(false);
      toast.success('Angle updated', {
        description: `Slot ${String(slot.dayIndex).padStart(2, '0')} will be written against this.`,
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            aria-label={`Edit the angle for day ${slot.dayIndex}`}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
        }
      />

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit slot {String(slot.dayIndex).padStart(2, '0')}</DialogTitle>
          <DialogDescription>
            This is the angle the post will be written from. Nothing has been generated for this
            slot yet, so changing it costs nothing.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSave} className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="theme">Angle</Label>
            <Textarea
              key={slot.theme}
              id="theme"
              name="theme"
              defaultValue={slot.theme}
              rows={4}
              required
              className="text-base"
            />
            <p className="text-muted-foreground text-xs leading-relaxed">
              The more specific the angle, the more specific the post. &ldquo;Most hospital AI
              projects fail at integration, not accuracy&rdquo; beats &ldquo;AI in
              healthcare&rdquo;.
            </p>
          </div>

          {/* Radio rather than a checkbox: the two are alternatives, not
              independent options, and a plan has a deliberate news ratio. */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium">Source</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {(
                [
                  { value: 'planned', label: 'Your own angle', hint: 'Written from your niche' },
                  { value: 'news', label: 'Current news', hint: 'Finds a story to comment on' },
                ] as const
              ).map((option) => {
                const isSelected = slot.type === option.value;

                return (
                  <label
                    key={option.value}
                    className={cn(
                      'border-border flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 rounded-md border px-4 py-2 text-sm transition-colors',
                      'has-[:checked]:border-primary has-[:checked]:bg-accent',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                    )}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type="radio"
                        name="type"
                        value={option.value}
                        defaultChecked={isSelected}
                        className="accent-primary size-4"
                      />
                      {option.label}
                    </span>
                    <span className="text-muted-foreground pl-6 text-xs">{option.hint}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              A news slot uses one of your daily news lookups and falls back to a planned post if
              none is available.
            </p>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-2 font-semibold">
              {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {isPending ? 'Saving…' : 'Save angle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
