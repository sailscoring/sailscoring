'use client';

import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';
import { organizationClient } from 'better-auth/client/plugins';

// No baseURL: Better Auth uses the current page origin, which is
// always the right answer in the browser (localhost in dev, the
// preview hostname on previews, app.sailscoring.ie in production).
// NEXT_PUBLIC_APP_URL is the production canonical URL used elsewhere
// in the app for "Open in Sail Scoring" links — pointing the auth
// client at it would break local dev.
export const authClient = createAuthClient({
  plugins: [magicLinkClient(), organizationClient()],
});
