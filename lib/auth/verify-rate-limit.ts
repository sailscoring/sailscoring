import { safeInternalPath } from '@/lib/safe-redirect';

/** The `?error=` code the sign-in form renders wait-and-retry copy for. */
export const RATE_LIMITED_ERROR = 'RATE_LIMITED';

/**
 * Turn a rate-limited magic-link verify into a redirect to `/sign-in`.
 *
 * Clicking a sign-in link is a top-level navigation, so a 429 from the
 * limiter puts its raw JSON body in the address bar — an explanation-free
 * dead end for someone who is already having trouble getting in. Every other
 * verify failure redirects to `/sign-in?error=…`; this makes the throttled
 * one behave the same way.
 *
 * The limiter runs before the endpoint, so a throttled link is **not**
 * consumed and still works once the window passes. That is what the sign-in
 * form tells the user, and it is only true because of the ordering here —
 * a 429 raised from inside the endpoint would need different copy.
 *
 * Returns null when the response isn't a throttled verify, so callers can
 * pass everything else through untouched.
 */
export function rateLimitedVerifyRedirect(
  request: Request,
  response: Response,
): Response | null {
  if (response.status !== 429) return null;
  const requestUrl = new URL(request.url);
  if (!requestUrl.pathname.endsWith('/magic-link/verify')) return null;

  const target = new URL('/sign-in', requestUrl.origin);
  target.searchParams.set('error', RATE_LIMITED_ERROR);
  // Carry the link's own destination through, so retrying after the wait
  // still lands where the user was headed rather than on the home page.
  const callbackURL = requestUrl.searchParams.get('callbackURL');
  if (callbackURL) {
    target.searchParams.set('callbackURL', safeInternalPath(callbackURL));
  }
  // Better Auth reports the remaining window in seconds; the form turns it
  // into "try again in N minutes".
  const retryAfter = response.headers.get('X-Retry-After');
  if (retryAfter) target.searchParams.set('retryAfter', retryAfter);

  return new Response(null, {
    status: 303,
    headers: { location: target.toString() },
  });
}
