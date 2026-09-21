'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMPTY_ACTION_STATE } from '@/lib/action-state';
import { setFeedbackStatusAction } from '@/lib/actions';
import type { Feedback } from '@/lib/types';

/** How each category is described, so the list is readable at a glance. */
const CATEGORY_LABEL: Record<Feedback['category'], string> = {
  bug: 'Bug',
  idea: 'Idea',
  praise: 'Praise',
  other: 'Other',
};

/**
 * The feedback inbox.
 *
 * ## Why the note sits beside the buttons
 *
 * The status answers "has this been seen"; the note answers "what came of it".
 * Keeping them in one row means the person closing a message writes the answer
 * while they still remember it, rather than in a second pass that never happens.
 *
 * @param props - Component props.
 * @param props.messages - Every message, newest first.
 * @returns The inbox list.
 * @sideeffect Submits server actions.
 */
export function AdminFeedbackPanel({ messages }: { messages: Feedback[] }) {
  if (messages.length === 0) {
    return (
      <p className="border-border text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        Nothing yet. Messages sent from the feedback page appear here.
      </p>
    );
  }

  const unread = messages.filter((message) => message.status === 'new').length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs font-medium">
        {messages.length} message{messages.length === 1 ? '' : 's'}
        {unread > 0 && ` · ${unread} new`}
      </p>

      <ul className="flex flex-col gap-3">
        {messages.map((message) => (
          <FeedbackRow key={message.id} message={message} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One message, with its workflow controls.
 *
 * @param props - Component props.
 * @param props.message - The message to render.
 * @returns The row.
 * @sideeffect Submits a server action.
 */
function FeedbackRow({ message }: { message: Feedback }) {
  const [state, action, isPending] = useActionState(setFeedbackStatusAction, EMPTY_ACTION_STATE);

  return (
    <li className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge variant={message.category === 'bug' ? 'destructive' : 'secondary'}>
          {CATEGORY_LABEL[message.category]}
        </Badge>

        {message.rating !== null && (
          <span className="text-muted-foreground text-xs tabular-nums">{message.rating}/5</span>
        )}

        <span className="text-muted-foreground text-xs">{message.email}</span>

        {/* Status is a word as well as a colour. */}
        <span
          className={
            message.status === 'new'
              ? 'text-primary ml-auto text-xs font-medium'
              : 'text-muted-foreground ml-auto text-xs font-medium'
          }
        >
          {message.status}
        </span>
      </div>

      {/* `whitespace-pre-wrap` because a bug report arrives with line breaks and
          collapsing them makes the reproduction steps unreadable. */}
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.message}</p>

      <p className="text-muted-foreground text-xs">
        {new Date(message.createdAt).toLocaleString()}
        {message.page && <> · from {message.page}</>}
        {message.adminNote && <> · note: {message.adminNote}</>}
      </p>

      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="feedbackId" value={message.id} />

        <Input
          name="adminNote"
          defaultValue={message.adminNote}
          placeholder="What came of it? (optional)"
          maxLength={500}
          className="h-8 max-w-72 text-xs"
        />

        <Button
          type="submit"
          size="sm"
          variant="outline"
          name="status"
          value="read"
          disabled={isPending || message.status === 'read'}
        >
          Mark read
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          name="status"
          value="archived"
          disabled={isPending || message.status === 'archived'}
        >
          Archive
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          name="status"
          value="new"
          disabled={isPending || message.status === 'new'}
        >
          Reopen
        </Button>

        {state.error && (
          <span role="alert" className="text-destructive w-full text-xs">
            {state.error}
          </span>
        )}
      </form>
    </li>
  );
}
