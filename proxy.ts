import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-only redirect-to-login for `/account`. Authoritative auth is the
 * page's call to `requireSession()` (defence in depth — middleware-only
 * auth is the failure mode of CVE-2025-29927). Phase 1 keeps this
 * narrow; later phases extend it to `/series/...` and `/settings`.
 */
export function proxy(request: NextRequest) {
  const sessionToken =
    request.cookies.get('better-auth.session_token') ??
    request.cookies.get('__Secure-better-auth.session_token');

  if (!sessionToken) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.searchParams.set('callbackURL', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/account/:path*'],
};
