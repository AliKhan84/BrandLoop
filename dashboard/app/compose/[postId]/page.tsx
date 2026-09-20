import { notFound, redirect } from 'next/navigation';

import { CopyAndOpen } from '@/components/copy-and-open';
import { CopyImageButton } from '@/components/copy-image-button';
import { ApiError, getPost, getMe } from '@/lib/api';
import { PLATFORM_LABELS, buildComposerLink, countCharacters, PLATFORM_LIMITS } from '@/lib/platform';
import { getSessionToken } from '@/lib/session';

/**
 * Copy-and-open page for a post.
 *
 * ## Why this exists
 *
 * X can pre-fill its composer from a URL. LinkedIn cannot — its share endpoint
 * builds the card from the destination page's Open Graph tags, so there is no
 * parameter that seeds the post body. Opening LinkedIn from Discord therefore
 * always lands the user on an empty composer with the text somewhere else.
 *
 * This page is the missing half of that handoff: it shows the exact text and
 * puts it on the clipboard in one click, then opens the composer. Without it the
 * user has to find the text, copy it, and switch windows — and for a LinkedIn
 * post over 2000 characters the text is in a Discord embed description, where
 * there is no Copy button at all.
 *
 * The Discord link points here instead of at LinkedIn for that reason.
 *
 * @param props - Page props.
 * @param props.params - The route params, awaited per Next 15+.
 * @returns The page.
 * @sideeffect none (reads only; the clipboard write happens after a click)
 */
export default async function ComposePage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;

  const token = await getSessionToken();
  if (!token) redirect('/login');

  let post;
  try {
    post = await getPost(token, postId);
  } catch (err) {
    // A post belonging to someone else is a 404 from the API, so this is also
    // the branch that keeps one user from reading another's draft by guessing
    // an id.
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  // Loaded so the header can name the account, and so a stale session fails here
  // rather than after the user has clicked.
  const user = await getMe(token);

  const text = post.fullText;
  const { url: composerUrl, prefilled } = buildComposerLink(post.platform, text);
  const limit = PLATFORM_LIMITS[post.platform];
  const length = countCharacters(text);
  const label = PLATFORM_LABELS[post.platform];

  // Served through this dashboard's own origin rather than from the API's
  // `imageUrl`. The browser can display the API's URL but cannot read it — no
  // CORS — and reading the bytes is what the copy-to-clipboard path needs. See
  // the route for the longer version.
  const imageSrc = `/api/posts/${post.id}/image`;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {user.name || user.email}
        </p>
        <h1 className="font-heading text-2xl leading-tight font-semibold">
          Day {post.dayIndex} — {label}
        </h1>
        {post.theme && <p className="text-muted-foreground text-sm leading-relaxed">{post.theme}</p>}
      </header>

      {/* The action comes before the text, not after.
          A post can be 3000 characters, so a button below it would sit off the
          bottom of the screen — the one thing the user came here to click would
          be the one thing they have to scroll to find. */}
      {composerUrl ? (
        <CopyAndOpen text={text} composerUrl={composerUrl} platformLabel={label} />
      ) : (
        <p className="text-destructive bg-destructive/8 border-destructive/25 rounded-md border px-3 py-2 text-sm">
          This post is too long for the {label} composer to prefill. Select the text below and copy
          it manually.
        </p>
      )}

      {prefilled && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {label} can prefill this one, so it will already be in the composer when it opens.
        </p>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Post text</h2>
          <span
            className={
              length > limit
                ? 'text-destructive text-xs font-medium tabular-nums'
                : 'text-muted-foreground text-xs tabular-nums'
            }
          >
            {length} / {limit} characters
          </span>
        </div>

        {/* Selectable as a fallback for when the clipboard write is refused.
            `select-all` makes one click select the whole post, which is the
            fastest manual copy available. */}
        <div className="border-border bg-card rounded-lg border p-4">
          <div className="prose-draft text-foreground select-all text-[0.9375rem]">{text}</div>
        </div>

        {/* Inside the text section, not between the sections: with the image
            below, a note that sat after `</section>` would read as a caption
            for the picture. */}
        {post.hashtags.length > 0 && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Hashtags are already included in the text above.
          </p>
        )}
      </section>

      {/* Below the text rather than beside it, because the order is the
          instruction: the text is pasted first and the image second, and a
          clipboard holds one thing at a time. */}
      {(post.imageUrl || post.needsImage) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Image</h2>

          {post.imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- our own same-origin route serves an image already sized for the platform; next/image would add an optimizer round-trip and needs the dimensions mirrored from the API for no gain */}
              <img
                src={imageSrc}
                alt={`Illustration generated for this post`}
                className="border-border w-full rounded-lg border"
              />
              <CopyImageButton
                src={imageSrc}
                filename={`${post.id}.jpg`}
                platformLabel={label}
              />
            </>
          ) : (
            <p className="text-muted-foreground text-sm leading-relaxed">
              {post.imageSkipReason ?? 'No image was generated for this post.'}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
