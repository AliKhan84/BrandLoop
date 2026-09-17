import { AlertTriangle, Check, Circle, Newspaper, SkipForward } from 'lucide-react';

import { EditSlotDialog } from '@/components/edit-slot-dialog';
import { GenerateSlotButton } from '@/components/generate-slot-button';
import { cn } from '@/lib/utils';
import type { ContentPlan, PlanDay, Platform, Post } from '@/lib/types';

/**
 * The plan rail.
 *
 * ## What this answers
 *
 * One question, at a glance: *where am I in this plan?* The draft queue next to
 * it answers a different one — what came out. Splitting them means neither has
 * to compromise, and each stays scannable on its own.
 *
 * ## The three states a slot can be in
 *
 *   pending   — nothing generated yet, or only some platforms. Offers Generate.
 *   generated — every configured platform produced a post. Shows a check.
 *   skipped   — deliberately passed over. Shown as such rather than hidden,
 *               because a slot that silently vanishes looks like a bug.
 *
 * ## Why a slot shows per-platform marks
 *
 * A slot is only complete when every configured platform has a post, but a
 * failure used to be reported once in a toast and then lost — and the slot was
 * marked done regardless, so the missing platform was never retried. Showing
 * the coverage per slot, and keeping the failure reason on the slot itself,
 * means a half-delivered slot stays visibly half-delivered instead of looking
 * finished.
 */

/** Display order and short labels for the platform marks. */
const PLATFORM_MARKS: ReadonlyArray<{ platform: Platform; label: string }> = [
  { platform: 'x', label: 'X' },
  { platform: 'linkedin', label: 'LinkedIn' },
];

/**
 * Picks the icon for a slot's state.
 *
 * Icons carry the state alongside the colour, so the rail still reads for
 * anyone who cannot separate the hues.
 *
 * @param slot - The slot to describe.
 * @param isComplete - Whether every configured platform has produced a post.
 * @returns The icon element.
 * @sideeffect none
 */
function SlotIcon({ slot, isComplete }: { slot: PlanDay; isComplete: boolean }) {
  if (isComplete) {
    return <Check className="text-status-approved size-4" aria-hidden="true" />;
  }
  if (slot.status === 'skipped') {
    return <SkipForward className="text-muted-foreground size-4" aria-hidden="true" />;
  }
  // A news slot is drawn as a hollow mark even when pending, so the planned
  // mix is visible before anything is generated.
  return slot.type === 'news' ? (
    <Newspaper className="text-muted-foreground size-4" aria-hidden="true" />
  ) : (
    <Circle className="text-muted-foreground size-4" aria-hidden="true" />
  );
}

/**
 * A readable label for a slot's state, for screen readers.
 *
 * @param slot - The slot to describe.
 * @param produced - Platforms that already have a post for this slot.
 * @returns A short phrase.
 * @sideeffect none (pure)
 */
function slotStateLabel(slot: PlanDay, produced: ReadonlySet<Platform>): string {
  const kind = slot.type === 'news' ? 'news post' : 'planned post';
  const coverage = PLATFORM_MARKS.map(
    ({ platform, label }) => `${label} ${produced.has(platform) ? 'ready' : 'missing'}`,
  ).join(', ');
  return `Day ${slot.dayIndex}, ${kind}, ${coverage}`;
}

/**
 * Which platforms already have a post for a given slot.
 *
 * @param posts - Every post belonging to the plan.
 * @param dayIndex - The slot to check.
 * @returns The platforms covered by an existing post.
 * @sideeffect none (pure)
 */
function producedPlatforms(posts: Post[], dayIndex: number): Set<Platform> {
  return new Set(
    posts.filter((post) => post.dayIndex === dayIndex).map((post) => post.platform),
  );
}

/**
 * The rail itself.
 *
 * @param props - Component props.
 * @param props.plan - The plan whose slots are shown.
 * @param props.posts - The plan's posts, used to report per-platform coverage.
 * @param props.platforms - Platforms the user has configured.
 * @returns The rail.
 * @sideeffect none
 */
export function PlanRail({
  plan,
  posts,
  platforms,
}: {
  plan: ContentPlan;
  posts: Post[];
  platforms: Platform[];
}) {
  const canGenerate = plan.status === 'approved';

  // Only mark the platforms this user actually generates for — showing a
  // permanent "missing" against a platform they have switched off would be a
  // warning about nothing.
  const configured = PLATFORM_MARKS.filter(({ platform }) => platforms.includes(platform));

  return (
    <section aria-labelledby="plan-rail-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="plan-rail-heading" className="text-sm font-semibold tracking-tight">
          Plan
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {plan.progress.generated}/{plan.progress.total} done
        </span>
      </div>

      <ol className="flex flex-col">
        {plan.days.map((slot, index) => {
          const produced = producedPlatforms(posts, slot.dayIndex);
          const isComplete = configured.every(({ platform }) => produced.has(platform));
          const isPartial = produced.size > 0 && !isComplete;

          return (
            <li
              key={slot.dayIndex}
              className={cn(
                'flex items-start gap-3 py-2.5',
                // Dividers between rows rather than a border per row — a border
                // on every item reads as a stack of boxes.
                index > 0 && 'border-border border-t',
              )}
            >
              <span className="mt-0.5 shrink-0">
                <SlotIcon slot={slot} isComplete={isComplete} />
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-muted-foreground font-mono text-xs">
                    {String(slot.dayIndex).padStart(2, '0')}
                  </span>
                  <span className="sr-only">{slotStateLabel(slot, produced)}</span>

                  {/* Per-platform coverage, but only once something exists —
                      otherwise every untouched slot carries two dashes of noise. */}
                  {produced.size > 0 && (
                    <span className="flex items-center gap-2 text-xs">
                      {configured.map(({ platform, label }) => (
                        <span
                          key={platform}
                          className={cn(
                            'flex items-center gap-1',
                            produced.has(platform)
                              ? 'text-muted-foreground'
                              : 'text-destructive font-medium',
                          )}
                        >
                          {produced.has(platform) ? (
                            <Check className="size-3" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="size-3" aria-hidden="true" />
                          )}
                          {label}
                        </span>
                      ))}
                    </span>
                  )}

                  <div className="ml-auto flex items-center gap-1">
                    {slot.status !== 'generated' && (
                      <EditSlotDialog planId={plan.id} slot={slot} />
                    )}
                    {slot.status === 'pending' && (
                      <GenerateSlotButton
                        planId={plan.id}
                        dayIndex={slot.dayIndex}
                        disabled={!canGenerate}
                        variant="compact"
                      />
                    )}
                  </div>
                </div>

                {/* The theme is the rail's content — without it the list would
                    be a column of numbers with no meaning. */}
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                  {slot.theme}
                </p>

                {/* The failure that used to live only in a toast. Kept on the
                    slot so it is still readable once the toast has gone. */}
                {isPartial && slot.lastSkipReason && (
                  <p className="text-destructive text-xs leading-relaxed">
                    {slot.lastSkipReason}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* The rail explains what happens next in both states. Going silent after
          approval reads as breakage — the user has approved, nothing has
          arrived, and there is nothing on screen to say why. */}
      {!canGenerate ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-xs">
          Approve this plan to generate its posts.
        </p>
      ) : (
        plan.progress.pending > 0 && (
          <p className="text-muted-foreground border-border rounded-md border border-dashed px-3 py-2 text-xs">
            Generate any slot now, or let the daily job take the next one at 09:00. Drafts arrive in
            Discord for your approval.
          </p>
        )
      )}
    </section>
  );
}
