import { NextResponse, type NextRequest } from 'next/server';

import { AUTH_ROUTES, PROTECTED_PREFIXES, SESSION_COOKIE } from '@/lib/constants';

/**
 * Route guard.
 *
 * ## What this is, and what it is not
 *
 * This checks only for the **presence** of a session cookie. It runs before any
 * server rendering, where the JWT cannot be verified against the API, so it is a
 * convenience: a signed-out visitor gets an instant redirect instead of a page
 * that renders a shell and then bounces.
 *
 * **It is not the security boundary.** The real check happens on every server
 * call — `lib/api.ts` forwards the cookie to the Express API, and an expired or
 * forged token gets a 401, which the workspace layout turns into a redirect to
 * `/login`. So a tampered cookie gets past this and is refused by the only
 * component that can actually tell whether it is valid.
 *
 * ## Why the file is `proxy.ts` and not `middleware.ts`
 *
 * Next 16 renamed the convention and warns on the old name. Same behaviour,
 * current API.
 *
 * @param request - The incoming request.
 * @returns A redirect for a guarded route, or the request passed through.
 * @sideeffect May issue a redirect response.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname === route);

  if (!hasSession && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // The originating path is deliberately NOT carried through as a `next`
    // parameter. Doing so safely needs validation on the receiving end to avoid
    // an open redirect, and the cost of skipping it is one extra click.
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (hasSession && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/workspace';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /*
   * Excludes Next internals, API routes (which must be reachable to sign in,
   * and cannot be guarded by a cookie that does not exist yet), and static
   * assets.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
