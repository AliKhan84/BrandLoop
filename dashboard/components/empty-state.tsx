import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Shared empty state.
 *
 * ## What an empty state owes the user
 *
 * Three things, per the discipline this dashboard follows: what belongs in this
 * space, why it matters, and what action fills it. A label with no direction
 * ("No posts yet") is an omission dressed as a state — it tells the user their
 * situation without giving them a way out of it.
 *
 * So every instance of this component takes a title, a sentence of *why*, and
 * whatever action resolves it. The icon is decorative and hidden from assistive
 * tech, because the heading already says what the state is.
 *
 * @param props - Component props.
 * @param props.icon - A decorative icon element.
 * @param props.title - Heading. States the situation.
 * @param props.description - The reason it matters and what fills it.
 * @param props.action - The control that resolves the empty state.
 * @param props.className - Layout classes.
 * @returns The empty state.
 * @sideeffect none
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // Dashed rather than solid: this is absence, not a container, and a
        // solid border would read as a panel that failed to load its content.
        'border-border flex flex-col items-start gap-3 rounded-lg border border-dashed px-6 py-10',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground [&_svg]:size-5">{icon}</div>}

      <div className="flex max-w-prose flex-col gap-1.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
      </div>

      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
