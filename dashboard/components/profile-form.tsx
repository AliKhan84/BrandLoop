'use client';

import { useActionState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { updateProfileAction } from '@/lib/actions';
import { cn } from '@/lib/utils';
import type { User } from '@/lib/types';

/**
 * Profile form.
 *
 * ## Why `inputPoints` is a plain textarea
 *
 * It is an open-ended list of the user's own opinions, and it is the single
 * biggest lever on output quality — the generator writes from these. A repeating
 * field group with add/remove buttons would look more engineered and would be
 * slower to fill in for what is usually three to five short lines. One textarea,
 * one point per line, with the instruction stated.
 *
 * The help text explains *why* it matters rather than just what goes in it,
 * because a user who understands the payoff writes better inputs.
 *
 * @param props - Component props.
 * @param props.user - The signed-in user, used for initial values.
 * @returns The profile form.
 * @sideeffect Saves via a server action; revalidates the layout on success.
 */
export function ProfileForm({ user }: { user: User }) {
  const [state, formAction, isPending] = useActionState(updateProfileAction, EMPTY_ACTION_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        {/* `key` on the server value, so a save that changes the stored name
            re-initialises this input from the new value.
            WHY NOT CONTROLLED: Base UI's warning suggests a controlled
            FieldControl, but a controlled input here would need an effect to
            pull in the new server value — same work, more ways to desync. The
            key makes the input remount exactly when the server value changes,
            which is the behaviour an uncontrolled field cannot express on its
            own, and it leaves the form's no-JS submission intact. */}
        <Input
          key={user.name}
          id="name"
          name="name"
          defaultValue={user.name}
          autoComplete="name"
          className="h-10 max-w-sm text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="niche">Niche</Label>
        <Input
          key={user.niche}
          id="niche"
          name="niche"
          defaultValue={user.niche}
          placeholder="AI in healthcare"
          aria-describedby="niche-hint"
          className="h-10 max-w-lg text-base"
        />
        <p id="niche-hint" className="text-muted-foreground max-w-prose text-xs leading-relaxed">
          Your field, as specifically as you can state it. Every theme and every post is written
          against this, so &ldquo;AI in healthcare&rdquo; produces noticeably better output
          than &ldquo;technology&rdquo;.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="inputPoints">What you actually think</Label>
        {/* Keyed for the same reason as the inputs above. The native textarea
            does not warn the way Base UI's Input does, but it has identical
            staleness semantics — its `defaultValue` is only read on mount — so
            it is keyed to match rather than left with the quieter version of
            the same flaw. */}
        <Textarea
          key={user.inputPoints.join('\n')}
          id="inputPoints"
          name="inputPoints"
          defaultValue={user.inputPoints.join('\n')}
          rows={6}
          placeholder={
            'One point per line, for example:\nI spent three years deploying clinical decision support in NHS trusts.\nMost hospital AI projects fail at integration, not model accuracy.'
          }
          aria-describedby="inputPoints-hint"
          className="max-w-2xl text-base"
        />
        <p id="inputPoints-hint" className="text-muted-foreground max-w-prose text-xs leading-relaxed">
          Opinions, experience, things you have seen go wrong. One per line. These are what stop the
          output reading like generic industry commentary — the generator writes from them wherever
          the theme allows.
        </p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Posts per week</legend>
        <div className="flex flex-wrap gap-2">
          {([2, 3, 4] as const).map((frequency) => (
            <label
              key={frequency}
              className={cn(
                // The label wraps the input so the whole target is clickable
                // and the association needs no id — which also means it cannot
                // drift out of sync.
                'border-border flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm transition-colors',
                'has-[:checked]:border-primary has-[:checked]:bg-accent',
                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              )}
            >
              <input
                type="radio"
                name="postFrequency"
                value={frequency}
                defaultChecked={user.postFrequency === frequency}
                className="accent-primary size-4"
              />
              {frequency} / week
            </label>
          ))}
        </div>
        <p className="text-muted-foreground max-w-prose text-xs leading-relaxed">
          How many posting slots each week of a plan gets. More slots means more model calls, which
          matters on a limited daily allowance.
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending} className="h-10 gap-2 px-4 font-semibold">
          {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>

        {/* Confirmation, announced politely so it does not interrupt whatever
            the screen reader is currently saying. */}
        {state.success && !isPending && (
          <span
            role="status"
            className="text-status-approved flex items-center gap-1.5 text-sm font-medium"
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {state.success}
          </span>
        )}
      </div>

      {state.error && (
        <p
          role="alert"
          className="text-destructive bg-destructive/8 border-destructive/25 max-w-2xl rounded-md border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
