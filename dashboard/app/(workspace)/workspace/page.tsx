import { redirect } from 'next/navigation';
import { FileText, Inbox, ListChecks } from 'lucide-react';

import { ApprovePlanButton } from '@/components/approve-plan-button';
import { CreatePlanDialog } from '@/components/create-plan-dialog';
import { DraftCard } from '@/components/draft-card';
import { EmptyState } from '@/components/empty-state';
import { GenerateSlotButton } from '@/components/generate-slot-button';
import { PlanRail } from '@/components/plan-rail';
import { PlanWorkflow } from '@/components/plan-workflow';
import { ApiError, getMe, getPlan, listPlans, listPosts } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import type { ContentPlan, User } from '@/lib/types';

export const metadata = { title: 'Workspace · BrandLoop' };

/**
 * The workspace — the surface the product exists for.
 *
 * ## Composition
 *
 * Two tracks, not a grid of metric tiles. On the left, the plan rail answers
 * "where am I in the plan"; on the right, the draft queue answers "what came
 * out of it". Both are built from the same artifact, so neither is filler, and
 * a stat card reading "3 posts" would carry less information than one visible
 * draft.
 *
 * The rail is narrow and fixed; the drafts get the remaining width because they
 * are the thing being read. On a phone the rail moves above the queue, since
 * scanning a week's angles before reading a draft is the order the work happens
 * in.
 *
 * ## Which plan is shown
 *
 * The most recently created one, whatever its status. An approved plan is the
 * interesting case, but a draft plan needs to be visible too — otherwise a user
 * who creates a plan and navigates away has no way back to approving it.
 *
 * @returns The workspace screen.
 * @sideeffect Makes three API calls.
 */
export default async function WorkspacePage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  let user: User;
  try {
    user = await getMe(token);
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) redirect('/login');
    throw err;
  }

  const plans = await listPlans(token);
  const activePlanSummary = plans[0] ?? null;

  // Nothing has been planned yet. This is the one state where the whole screen
  // is instruction rather than data.
  if (!activePlanSummary) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <PageHeader user={user} />

        <EmptyState
          icon={<ListChecks />}
          title="No plan yet"
          description={
            user.niche
              ? 'A plan is a set of posting angles — one per slot, covering the next week or month. Create one, review the angles, then approve it to start generating posts.'
              : 'Before a plan can say anything useful, BrandLoop needs to know your field and what you actually think. Set those first, then create a plan.'
          }
          action={
            user.niche ? (
              <CreatePlanDialog postFrequency={user.postFrequency} />
            ) : (
              <a
                href="/settings"
                className="bg-primary text-primary-foreground inline-flex h-10 items-center rounded-md px-4 text-sm font-semibold"
              >
                Set your niche first
              </a>
            )
          }
        />
      </div>
    );
  }

  // The list endpoint returns summaries; the detail call carries the slots.
  const [{ plan }, posts] = await Promise.all([
    getPlan(token, activePlanSummary.id),
    listPosts(token),
  ]);

  const planPosts = posts.filter((post) => post.planId === plan.id);
  const isApproved = plan.status === 'approved';
  const hasPendingSlot = plan.days.some((slot) => slot.status === 'pending');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader user={user} plan={plan} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:gap-10">
        <div className="flex flex-col gap-6">
          <PlanRail plan={plan} posts={planPosts} platforms={user.platforms} />

          {!isApproved && plan.status === 'draft' && (
            <div className="border-border bg-accent/40 flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Ready to approve?</h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Approving lets BrandLoop generate these posts. It does not write anything by
                  itself — you choose when to generate, and you review every draft before anything
                  goes out.
                </p>
              </div>
              <ApprovePlanButton planId={plan.id} />
            </div>
          )}

          <PlanWorkflow plan={plan} />
        </div>

        <section aria-labelledby="drafts-heading" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="drafts-heading" className="text-sm font-semibold tracking-tight">
              Drafts
            </h2>
            {planPosts.length > 0 && (
              <span className="text-muted-foreground text-xs tabular-nums">
                {planPosts.length} post{planPosts.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {planPosts.length > 0 ? (
            <div className="flex flex-col gap-4">
              {planPosts.map((post) => (
                <DraftCard key={post.id} post={post} showTheme />
              ))}
            </div>
          ) : isApproved && hasPendingSlot ? (
            <EmptyState
              icon={<Inbox />}
              title="Plan approved, nothing generated yet"
              description="Generate a slot from the rail to write its posts for X and LinkedIn — or let the daily job take one slot per day at 09:00. This takes up to a minute, and both drafts then arrive here and in Discord for approval."
              action={<GenerateSlotButton planId={plan.id} variant="default" />}
            />
          ) : !isApproved ? (
            <EmptyState
              icon={<FileText />}
              title="This plan is still a draft"
              description="Approve it from the panel on the left and its slots become generatable. Nothing is written until you do."
            />
          ) : (
            <EmptyState
              icon={<Inbox />}
              title="Every slot has been generated"
              description="This plan is complete. Create a new one to keep posting."
              action={<CreatePlanDialog postFrequency={user.postFrequency} hasExistingPlan />}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The workspace header.
 *
 * Carries the account's state at a glance and the primary action for the
 * screen. Kept thin — the rail and the drafts are the content, and a tall
 * header would push them below the fold on a laptop.
 *
 * @param props - Component props.
 * @param props.user - The signed-in user.
 * @param props.plan - The plan in view, when there is one.
 * @returns The page header.
 * @sideeffect none
 */
function PageHeader({ user, plan }: { user: User; plan?: ContentPlan }) {
  const hasExistingPlan = Boolean(plan);

  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {user.niche ? user.niche : 'Your workspace'}
        </h1>
        <p className="text-muted-foreground text-sm">
          {user.discordLinked ? (
            'Drafts are delivered to your Discord DMs.'
          ) : (
            <>
              <a href="/settings" className="text-foreground underline underline-offset-4">
                Link Discord
              </a>{' '}
              to receive drafts for approval.
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <CreatePlanDialog postFrequency={user.postFrequency} hasExistingPlan={hasExistingPlan} />
      </div>
    </header>
  );
}
