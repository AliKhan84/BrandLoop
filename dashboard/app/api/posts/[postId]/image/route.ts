import { NextResponse } from 'next/server';

import { ApiError, getPost } from '@/lib/api';
import { getSessionToken } from '@/lib/session';

/**
 * Serves a post's generated image from the dashboard's own origin.
 *
 * ## Why the browser cannot just use `post.imageUrl`
 *
 * The URL the API stores points at the Express server. A browser can *display*
 * that in an `<img>` — but it cannot *read* it: the API sends no CORS headers,
 * so `fetch()` is blocked and a canvas drawn from it is tainted. Reading the
 * bytes is exactly what the copy-to-clipboard path needs, because the clipboard
 * takes a Blob, not a URL.
 *
 * Proxying also keeps the rule from `lib/api.ts` intact — the browser only ever
 * talks to Next.js — and is what makes the image work when the API is not
 * reachable from the browser at all (a hosted dashboard, or the API on a
 * private network).
 *
 * ## Authorization
 *
 * `/media` on the API is intentionally public, so this handler must not become
 * a proxy for any id it is handed. It loads the post through the API with the
 * session token first: a post belonging to another user is a 404 there, and no
 * image is fetched. That is the same guarantee the compose page itself relies
 * on.
 *
 * @param _request - Unused. The session cookie carries the credentials.
 * @param context - Route context.
 * @param context.params - The post whose image to serve, awaited per Next 15+.
 * @returns The image bytes, or a plain-text failure the page reports.
 * @sideeffect Makes two outbound requests to the API.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;

  const token = await getSessionToken();
  if (!token) {
    return new NextResponse('Sign in to load this image.', { status: 401 });
  }

  let post;
  try {
    post = await getPost(token, postId);
  } catch (err) {
    if (err instanceof ApiError) {
      // `statusCode` is 0 when the API could not be reached at all, which is a
      // bad gateway for this route rather than a client error.
      return new NextResponse(err.message, { status: err.statusCode || 502 });
    }
    throw err;
  }

  if (!post.imageUrl) {
    return new NextResponse('This post has no image.', { status: 404 });
  }

  // Server-to-server, so there is no CORS to satisfy — and the URL came from
  // the API's own record of the post, never from the request.
  const upstream = await fetch(post.imageUrl, { cache: 'no-store' });

  if (!upstream.ok) {
    return new NextResponse('The image could not be loaded from the API.', { status: 502 });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      // Private because the route is authenticated. Long-lived because a post's
      // image never changes: regenerating produces a new post id, and so a new
      // URL, rather than new bytes behind this one.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
