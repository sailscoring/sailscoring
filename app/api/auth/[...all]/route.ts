import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';
import { rateLimitedVerifyRedirect } from '@/lib/auth/verify-rate-limit';

const handlers = toNextJsHandler(auth.handler);

export const POST = handlers.POST;

/**
 * Magic-link verify arrives here as a top-level navigation, so any response
 * that isn't a redirect is something the user reads in the address bar. The
 * rate limiter answers before the endpoint runs and its 429 carries a JSON
 * body, which is why it needs translating into the same `/sign-in?error=…`
 * redirect every other verify failure produces.
 */
export async function GET(request: Request): Promise<Response> {
  const response = await handlers.GET(request);
  return rateLimitedVerifyRedirect(request, response) ?? response;
}
