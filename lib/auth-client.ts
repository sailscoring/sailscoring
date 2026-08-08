'use client';

import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { organizationClient } from 'better-auth/client/plugins';

import { orgAccessControl, orgRoles } from '@/lib/auth/org-roles';

// No baseURL: Better Auth uses the current page origin, which is
// always the right answer in the browser (localhost in dev, the
// preview hostname on previews, app.sailscoring.ie in production).
// NEXT_PUBLIC_APP_URL is the production canonical URL used elsewhere
// in the app for "Open in Sail Scoring" links — pointing the auth
// client at it would break local dev.
export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    organizationClient({ ac: orgAccessControl, roles: orgRoles }),
  ],
});

/**
 * Re-read the session from the database and repopulate the session cookie
 * cache.
 *
 * Better Auth refreshes that cache only from inside `getSession`. Everything
 * else that writes the session or user row — `set-active`, `updateUser` —
 * updates the database and leaves the cached cookie holding the old values
 * until it ages out. `disableCookieCache` skips the cached read, falls
 * through to the database, and writes the fresh result back into the cookie
 * on the way out, so the next request observes the change.
 *
 * Call this after any mutation to the session or the signed-in user, and
 * await it before navigating: a hard reload does not help on its own,
 * because the server still reads the stale cache.
 */
export async function refreshSessionCache(): Promise<void> {
  await authClient.getSession({ query: { disableCookieCache: true } });
}

/**
 * Switch the active workspace so the change is authoritative on the very
 * next request.
 *
 * Always prefer this to calling `authClient.organization.setActive`
 * directly: unpaired with the refresh above, the switch lands in the session
 * row but every server read keeps resolving the previous workspace, and the
 * switcher looks like it silently did nothing.
 */
export async function setActiveWorkspace(organizationId: string): Promise<void> {
  await authClient.organization.setActive({ organizationId });
  await refreshSessionCache();
}
