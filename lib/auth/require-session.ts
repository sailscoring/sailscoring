import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';

/**
 * Server-side session guard. Returns the active session or redirects to
 * `/sign-in`. Phase 2 repositories will reuse this so workspace-scoped
 * authorization sits at a single chokepoint.
 */
export async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) {
    redirect('/sign-in');
  }
  return session;
}

export async function getOptionalSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}
