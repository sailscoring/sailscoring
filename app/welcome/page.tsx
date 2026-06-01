import { redirect } from 'next/navigation';

import { requireSession } from '@/lib/auth/require-session';
import { safeInternalPath } from '@/lib/safe-redirect';
import { WelcomeForm } from './welcome-form';

export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await requireSession();
  const next = safeInternalPath((await searchParams).next);

  // Defensive: this page is only linked from the new-user magic-link
  // callback, but a user who already has a name has nothing to do here —
  // send them on rather than re-prompting.
  if (session.user.name?.trim()) {
    redirect(next);
  }

  return <WelcomeForm next={next} />;
}
