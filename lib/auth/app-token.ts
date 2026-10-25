import 'server-only';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { ACCESS_TOKEN_PREFIX, type ResolvedAccessToken } from '@/lib/auth/oauth';
import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';

/**
 * OAuth access tokens on a request (ADR-016): finding one, and resolving it
 * to the user it acts for. Shared by the public API's authenticated part and
 * by `/api/v1`, which takes the CLI's tokens.
 */

/** The bearer token on a request, if there is one. */
export function bearerToken(headers: Headers): string | null {
  const header = headers.get('authorization');
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match ? match[1].trim() : null;
}

/** Whether a bearer token is an OAuth access token, not an API key. */
export function isAccessToken(token: string): boolean {
  return token.startsWith(ACCESS_TOKEN_PREFIX);
}

export interface AppCaller extends ResolvedAccessToken {
  email: string;
}

/** The user, app and grant behind an access token; null when it isn't one
 *  the provider accepts (expired, revoked, a disabled app, made up). */
export async function resolveAppCaller(token: string): Promise<AppCaller | null> {
  const resolved = await auth.api.resolveAccessToken({ body: { token } });
  if (!resolved) return null;
  const [row] = await getDb()
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, resolved.userId))
    .limit(1);
  return row ? { ...resolved, email: row.email } : null;
}
