import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

/**
 * UX-only redirect-to-login for protected pages. Authoritative auth is
 * each page's call to `requireSession()` / `requireWorkspace()` —
 * proxy-only (formerly middleware-only) auth is the failure mode of
 * CVE-2025-29927, so this layer is defence-in-depth, not the fence.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  const callbackURL = url.pathname + url.search;
  url.pathname = '/sign-in';
  url.search = `?callbackURL=${encodeURIComponent(callbackURL)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Match every path except: the sign-in page itself, the public help
  // page, every API route (which already returns 401 JSON), Next.js
  // internals, and any path with a file extension (favicon, static
  // assets).
  matcher: ['/((?!sign-in|help|api/|_next/|.*\\.).*)'],
};
