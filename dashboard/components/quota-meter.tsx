import { cn } from '@/lib/utils';
import type { QuotaEntry, UsageSummary } from '@/lib/types';

/**
 * Quota readout.
 *
 * ## Why this is worth the space
 *
 * The Gemini free tier allows **20 requests per day per model**. That is low
 * enough that a user hits it during normal use, and when they do, generation
 * fails. Showing the remaining count before they commit turns "the tool is
 * broken" into "I am out until tomorrow" — which is the difference between a
 * product that feels honest and one that feels unreliable.
 *
 * ## Why there is no colour-only signalling
 *
 * A budget running low is carried by the bar, the remaining count, *and* a text
 * label. Anyone who cannot distinguish the amber warning from the neutral bar
 * still reads "1 left" and "Running low".
 *
 * The `images` bucket is deliberately not rendered. It exists in the API because
 * the model fields shipped ahead of Phase 3, but image generation is blocked on
 * quota and cannot succeed — displaying a counter for a disabled feature would
 * invite the user to spend something they cannot.
 */

/** The quotas that are actually spendable today, in the order they are shown. */
const VISIBLE_QUOTAS = [
  { key: 'planGenerations', label: 'Plans' },
  { key: 'newsLookups', label: 'News' },
] as const;

/**
 * Chooses the bar's fill colour from how much is left.
 *
 * @param entry - The quota bucket.
 * @returns A background class for the filled portion.
 * @sideeffect none (pure)
 */
function fillClass(entry: QuotaEntry): string {
  if (entry.remaining === 0) return 'bg-destructive';
  // One left is the warning band: enough to finish the thought, not enough to
  // spend without noticing.
  if (entry.remaining <= 1) return 'bg-primary';
  return 'bg-status-approved';
}

/**
 * Renders a single quota bucket.
 *
 * @param props - Component props.
 * @param props.entry - Used, limit and remaining for this bucket.
 * @param props.label - Short human name, e.g. "Plans".
 * @param props.className - Layout classes from the parent.
 * @returns The bucket row.
 * @sideeffect none
 */
function QuotaRow({
  entry,
  label,
  className,
}: {
  entry: QuotaEntry;
  label: string;
  className?: string;
}) {
  // Guard against a zero limit producing NaN width if a configuration ever
  // sets one to nothing.
  const pct = entry.limit > 0 ? Math.round((entry.used / entry.limit) * 100) : 0;

  const state =
    entry.remaining === 0 ? 'Used up' : entry.remaining <= 1 ? 'Running low' : null;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sidebar-foreground text-xs font-medium">{label}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {entry.remaining}/{entry.limit}
        </span>
      </div>

      <div
        className="bg-sidebar-accent h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={entry.used}
        aria-valuemin={0}
        aria-valuemax={entry.limit}
        aria-label={`${label} used this ${entry.period}`}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300', fillClass(entry))}
          style={{ width: `${pct}%` }}
        />
      </div>

      {state && (
        <span
          className={cn(
            'text-xs',
            entry.remaining === 0 ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {state} · resets {entry.period === 'day' ? 'at midnight UTC' : 'Monday'}
        </span>
      )}
    </div>
  );
}

/**
 * Renders every visible quota bucket.
 *
 * @param props - Component props.
 * @param props.usage - The summary from `/api/users/me/usage`.
 * @param props.variant - `sidebar` for the desktop rail, `inline` for headers.
 * @returns The quota meter, or null when there is nothing to show.
 * @sideeffect none
 */
export function QuotaMeter({
  usage,
  variant = 'sidebar',
}: {
  usage: UsageSummary;
  variant?: 'sidebar' | 'inline';
}) {
  const rows = VISIBLE_QUOTAS.map(({ key, label }) => ({ label, entry: usage[key] })).filter(
    (row) => Boolean(row.entry),
  );

  if (rows.length === 0) return null;

  if (variant === 'inline') {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {rows.map(({ label, entry }) => (
          <span key={label} className="text-muted-foreground text-xs tabular-nums">
            <span className="text-foreground font-medium">{entry.remaining}</span>/{entry.limit}{' '}
            {label.toLowerCase()} left today
          </span>
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Usage" className="border-sidebar-border flex flex-col gap-3 border-t px-2 pt-4">
      {rows.map(({ label, entry }) => (
        <QuotaRow key={label} label={label} entry={entry} />
      ))}
    </section>
  );
}
