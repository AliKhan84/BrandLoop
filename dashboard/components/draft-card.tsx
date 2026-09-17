'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink, Newspaper } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { EditDraftDialog } from '@/components/edit-draft-dialog';
import {
  PLATFORM_LABELS,
  PLATFORM_LIMITS,
  STATUS_DOT_CLASS,
  STATUS_LABELS,
  buildComposerLink,
  countCharacters,
} from '@/lib/platform';
import { cn } from '@/lib/utils';
import type { Post } from '@/lib/types';

/**
 * A single generated draft.
 *
 * ## Why this component carries the most weight
 *
 * The generated post *is* the product. Everything else in the dashboard
 * exists to get a user to this text and out to the platform. So the draft gets
 * the reading face (serif), a capped measure, and the room to be read in full —
 * rather than being truncated into a table cell so more rows fit.
 *
 * ## Why the body is not clamped
 *
 * A LinkedIn draft runs to 3,000 characters. Collapsing it behind "show more"
 * would make the list tidier and would also mean the user approves something
 * they have not read. The list scrolls instead.
 *
 * @param props - Component props.
 * @param props.post - The draft to render.
 * @param props.showTheme - Whether to show the plan angle above the text.
 * @returns The draft card.
 * @sideeffect Clipboard write on Copy.
 */
export function DraftCard({ post, showTheme = false }: { post: Post; showTheme?: boolean }) {
  const [copied, setCopied] = useState(false);

  const text = post.fullText;
  const length = countCharacters(text);
  const limit = PLATFORM_LIMITS[post.platform];
  const overLimit = length > limit;

  // Every part, root first. The root is `fullText` so it carries the hashtags;
  // the replies are bare bodies.
  const segments = [text, ...(post.thread ?? []).filter((part) => part.trim().length > 0)];
  const isThread = segments.length > 1;

  // Counted per part, because each is posted on its own. A single "total"
  // number would be meaningless for a thread — 900 characters across four parts
  // is fine, and 900 in one part is not.
  const partLengths = segments.map((part) => countCharacters(part));
  const overLimitParts = partLengths.filter((partLength) => partLength > limit).length;

  // LinkedIn cannot prefill its composer, so its link goes to BrandLoop's own
  // copy-and-open page first — the same destination the Discord button uses.
  // Sending the user straight to an empty composer is the flow this page exists
  // to remove. X keeps its direct link, because that one really does prefill.
  const { url: composerUrl, prefilled } = buildComposerLink(post.platform, text);
  const href = post.platform === 'linkedin' ? `/compose/${post.id}` : composerUrl;
  const opensInNewTab = post.platform !== 'linkedin';

  /**
   * Copies the exact published text to the clipboard.
   *
   * Copies `fullText` — body plus hashtags — rather than just the body, because
   * that is what the user is about to paste. Copying the body alone would
   * silently drop the hashtags.
   *
   * @returns Resolves once the attempt finishes, successful or not.
   * @sideeffect Writes to the clipboard; shows a toast.
   */
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied', { description: `${length} characters on your clipboard.` });
      // Reverts so the button is usable again without a page reload.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some browsers unless the page is focused,
      // and over plain http on a non-localhost host. The text is still on
      // screen and selectable, so this is a degraded path rather than a dead end.
      toast.error('Could not copy automatically', {
        description: 'Select the text and copy it manually.',
      });
    }
  }

  return (
    <article className="border-border bg-card rounded-lg border">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3.5 pb-2 sm:px-5">
        {/* Status is a dot AND a label. Colour alone would be invisible to
            anyone who cannot separate the hues. */}
        <span className="flex items-center gap-1.5">
          <span
            className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT_CLASS[post.status])}
            aria-hidden="true"
          />
          <span className="text-muted-foreground text-xs font-medium">
            {STATUS_LABELS[post.status]}
          </span>
        </span>

        <span className="text-muted-foreground/50 text-xs" aria-hidden="true">
          ·
        </span>

        <span className="text-muted-foreground text-xs">
          Day {post.dayIndex} · {PLATFORM_LABELS[post.platform]}
        </span>

        {post.type === 'news' && (
          <span className="bg-status-news/12 text-status-news ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium">
            <Newspaper className="size-3" aria-hidden="true" />
            From news
          </span>
        )}
      </header>

      {showTheme && post.theme && (
        <p className="text-muted-foreground px-4 pb-2 text-xs sm:px-5">
          <span className="font-medium">Angle:</span> {post.theme}
        </p>
      )}

      <div className="px-4 pb-3 sm:px-5">
        {/* The artifact. Serif, capped measure, blank-line breaks preserved. */}
        <div className="prose-draft text-foreground measure-draft text-[0.9375rem]">{text}</div>
      </div>

      {/* Thread parts, each shown separately because each is posted separately.
          Collapsing them into one block would hide how many posts this really
          is — which is the thing the user is agreeing to. */}
      {isThread && (
        <div className="flex flex-col gap-3 px-4 pb-3 sm:px-5">
          <p className="text-muted-foreground text-xs font-medium">
            Thread — {segments.length} parts. Post part 1, then reply with each part in order.
          </p>

          {segments.slice(1).map((part, index) => (
            <div key={index} className="border-border flex flex-col gap-1.5 border-l-2 pl-3">
              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                Part {index + 2} of {segments.length}
              </span>
              <div className="prose-draft text-foreground text-[0.9375rem]">{part}</div>
            </div>
          ))}
        </div>
      )}

      {post.sourceNewsUrl && (
        <p className="text-muted-foreground px-4 pb-3 text-xs sm:px-5">
          Source:{' '}
          <a
            href={post.sourceNewsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline underline-offset-2"
          >
            {post.sourceNewsName ?? 'original report'}
          </a>
          {post.sourceNewsTitle ? ` — ${post.sourceNewsTitle}` : ''}
        </p>
      )}

      <footer className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 sm:px-5">
        {/* The count is checked here as a second line of defence. The API
            enforces the limit at generation time, so a violation means that
            guarantee broke — better to show it than to let it publish. */}
        <span
          className={cn(
            'text-xs tabular-nums',
            overLimitParts > 0 ? 'text-destructive font-medium' : 'text-muted-foreground',
          )}
        >
          {isThread ? (
            <>
              {segments.length} parts ·{' '}
              {partLengths.map((partLength, index) => (
                <span key={index}>
                  {index > 0 && ' / '}
                  {partLength}
                </span>
              ))}{' '}
              characters
              {overLimitParts > 0 && ` · ${overLimitParts} over the ${limit} limit`}
            </>
          ) : (
            <>
              {length} / {limit} characters
              {overLimit && ' · over the limit, edit before posting'}
            </>
          )}
        </span>

        <div className="flex items-center gap-2">
          {/* Only while the draft is still awaiting a decision. Once it has been
              approved or rejected the API refuses the edit, so offering the
              button would promise something that cannot happen. */}
          {post.status === 'pending_approval' && <EditDraftDialog post={post} />}

          <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
            {copied ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy post'}
          </Button>

          {href ? (
            // A real anchor, not `<Button render={<a/>}>`. It navigates, so it
            // should be a link in the accessibility tree — and that is also the
            // only way it can be opened in a new tab, middle-clicked, or copied
            // as a link. Base UI's Button asserts native button semantics and
            // logged a console error for the anchor; `buttonVariants()` gives
            // the same appearance with semantics that match the behaviour.
            <a
              href={href}
              // The compose page opens the composer itself, so opening it in a
              // new tab too would leave the user with two tabs and no clear
              // next step. X keeps `_blank` because its link IS the composer.
              {...(opensInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}
            >
              {prefilled
                ? `Open ${PLATFORM_LABELS[post.platform]}`
                : opensInNewTab
                  ? 'Open composer'
                  : `Copy & open ${PLATFORM_LABELS[post.platform]}`}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            // Reachable when a post is too long for the X intent URL to survive
            // the trip. The copy button above is the whole path in that case.
            <span className="text-muted-foreground text-xs">Too long to prefill — copy instead</span>
          )}
        </div>
      </footer>
    </article>
  );
}
