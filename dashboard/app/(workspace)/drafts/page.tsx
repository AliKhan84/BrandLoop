import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText } from 'lucide-react';

import { DraftCard } from '@/components/draft-card';
import { EmptyState } from '@/components/empty-state';
import { ApiError, listPosts } from '@/lib/api';
import { getSessionToken } from '@/lib/session';
import { STATUS_LABELS } from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { Post, PostStatus } from '@/lib/types';

export const metadata = { title: 'Drafts · BrandLoop' };

/**
 * The status filters offered, in the order they are shown.
 *
 * "All" first because it is the default and the most common intent. The list
 * mirrors the post lifecycle exactly, so no status can exist in the data
 * without being filterable — a status the user cannot see is a status they
 * cannot act on.
 */
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Needs review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;

/**
 * Reports whether a string is a status the API will accept.
 *
 * The filter comes from the URL, so it is user input. Passing an unknown value
 * through would make the API return a 400 and the page would fail — instead it
 * is validated here and anything unrecognised falls back to "all".
 *
 * @param value - The raw filter from the query string.
 * @returns True when it is a real post status.
 * @sideeffect none (pure)
 */
function isPostStatus(value: string): value is PostStatus {
  return value in STATUS_LABELS;
}

/**
 * The drafts list.
 *
 * ## Why this is a separate screen from the workspace
 *
 * The workspace shows one plan's output, in the order it was planned. This
 * shows everything the account has ever produced, newest first, filtered by
 * what still needs attention. They answer different questions: "where am I in
 * this plan" versus "what is waiting on me overall".
 *
 * ## Why filtering is in the URL
 *
 * The filter is a link, not client state, so it survives a refresh, can be
 * bookmarked, and works with JavaScript disabled. It also means the server
 * fetches only the matching posts rather than loading everything and hiding
 * most of it.
 *
 * @param props - Page props.
 * @param props.searchParams - The query string, carrying the status filter.
 * @returns The drafts screen.
 * @sideeffect Makes one API call.
 */
export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const { status: rawStatus } = await searchParams;
  const activeFilter = rawStatus && isPostStatus(rawStatus) ? rawStatus : 'all';

  let posts: Post[];
  try {
    posts = await listPosts(token, activeFilter === 'all' ? {} : { status: activeFilter });
  } catch (err) {
    if (err instanceof ApiError && err.isUnauthorized) redirect('/login');
    throw err;
  }

  const pendingCount = posts.filter((post) => post.status === 'pending_approval').length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Drafts</h1>
        <p className="text-muted-foreground text-sm">
          {posts.length === 0
            ? 'Everything BrandLoop has written for you.'
            : `${posts.length} post${posts.length === 1 ? '' : 's'}${
                pendingCount > 0 ? ` · ${pendingCount} awaiting review in Discord` : ''
              }`}
        </p>
      </header>

      {/*
        Filters as links. The active one is marked with `aria-current` as well
        as a filled style, since the difference is otherwise carried by colour
        alone.
      */}
      <nav aria-label="Filter drafts" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.value;
          return (
            <Link
              key={filter.value}
              href={filter.value === 'all' ? '/drafts' : `/drafts?status=${filter.value}`}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground font-medium'
                  : 'border-border hover:bg-accent',
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {posts.length > 0 ? (
        <div className="flex flex-col gap-4">
          {posts.map((post) => (
            <DraftCard key={post.id} post={post} showTheme />
          ))}
        </div>
      ) : activeFilter === 'all' ? (
        <EmptyState
          icon={<FileText />}
          title="Nothing written yet"
          description="Drafts appear here as soon as you generate a slot from the workspace. Each one is also delivered to Discord for approval."
          action={
            <Link
              href="/workspace"
              className="bg-primary text-primary-foreground inline-flex h-10 items-center rounded-md px-4 text-sm font-semibold"
            >
              Go to the workspace
            </Link>
          }
        />
      ) : (
        // A filtered empty state is a different situation from an empty
        // account, and needs a different way out: clear the filter, not
        // "create something".
        <EmptyState
          icon={<FileText />}
          title={`No posts are ${FILTERS.find((f) => f.value === activeFilter)?.label.toLowerCase()}`}
          description="Nothing matches this filter right now. Clearing it shows everything."
          action={
            <Link
              href="/drafts"
              className="border-border hover:bg-accent inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium"
            >
              Show all drafts
            </Link>
          }
        />
      )}
    </div>
  );
}
