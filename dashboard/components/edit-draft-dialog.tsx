'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
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
import { updatePostAction } from '@/lib/actions';
import { PLATFORM_LABELS, PLATFORM_LIMITS, countCharacters } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { Post } from '@/lib/types';

/**
 * Edits a generated draft's body from the dashboard.
 *
 * ## Why this belongs here as well as in Discord
 *
 * The Discord modal was the only way to change a draft, which meant reading the
 * text in one place and editing it in another. The dashboard already shows the
 * full draft; making it editable there removes the round trip.
 *
 * ## Why it cannot diverge from the Discord edit
 *
 * Both surfaces call `updatePostContent` on the API, which owns the guards
 * (must still be pending, non-empty, within the platform limit) and re-renders
 * the Discord message. So an edit made here is what the DM shows, and neither
 * path can accept something the other would reject.
 *
 * @param props - Component props.
 * @param props.post - The draft to edit.
 * @returns The edit button and its dialog.
 * @sideeffect Writes the post and its Discord message on save.
 */
export function EditDraftDialog({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const limit = PLATFORM_LIMITS[post.platform];

  /**
   * Counts as the user types, so the limit is visible before saving rather than
   * as a rejection afterwards.
   *
   * Seeded from the current body and updated on change — this field is
   * controlled, unlike the plan forms, because the counter has to track it.
   */
  const [draft, setDraft] = useState(post.content);
  const length = countCharacters(draft);
  const overLimit = length > limit;

  function handleSave() {
    if (!draft.trim()) {
      toast.error('A post cannot be empty');
      return;
    }

    if (overLimit) {
      toast.error('Too long to save', {
        description: `${length} characters — ${PLATFORM_LABELS[post.platform]} allows ${limit}.`,
      });
      return;
    }

    startTransition(async () => {
      const result = await updatePostAction(post.id, draft);

      if (!result.ok) {
        toast.error('Could not save the edit', { description: result.error });
        return;
      }

      setOpen(false);
      toast.success('Draft updated', { description: 'The copy in Discord matches this now.' });
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            Edit
          </Button>
        }
      />

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit draft</DialogTitle>
          <DialogDescription>
            Changing this updates the message in Discord too, so you are never asked to approve text
            you were not shown.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`content-${post.id}`}>Post text</Label>
            <Textarea
              id={`content-${post.id}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={10}
              // Deliberately not `required` with a native bubble — the counter
              // below states the limit continuously, which is more useful than
              // a message that only appears on submit.
              aria-describedby={`content-hint-${post.id}`}
              aria-invalid={overLimit}
              className="text-base"
            />
            <p
              id={`content-hint-${post.id}`}
              className={cn(
                'text-xs tabular-nums',
                overLimit ? 'text-destructive font-medium' : 'text-muted-foreground',
              )}
            >
              {length} / {limit} characters
              {overLimit && ` — ${length - limit} over the ${PLATFORM_LABELS[post.platform]} limit`}
            </p>
          </div>

          {post.hashtags.length > 0 && (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {/* Stated because they are stored separately and are NOT part of
                  this field — a user editing the body would otherwise reasonably
                  assume they are about to delete the hashtags. */}
              Hashtags ({post.hashtags.join(' ')}) are added automatically and are not edited here.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isPending || overLimit}
            className="gap-2 font-semibold"
          >
            {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
