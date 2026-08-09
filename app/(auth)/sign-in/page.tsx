import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/require-session';
import { safeInternalPath, stripAuthErrorParam } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { SignInForm } from './sign-in-form';

export const dynamic = 'force-dynamic';

/**
 * Shown when someone who is already signed in lands on `/sign-in` carrying a
 * failed-verify `?error=`. Magic links are single-use, so every sign-in email
 * still sitting in the inbox is a dead link — clicking an old one redirects
 * here without ever touching the session. Rendering the sign-in form at that
 * moment told a signed-in user they were signed out and invited them to
 * request another email, which is how one drop-out turned into a run of them.
 */
function AlreadySignedIn({
  destination,
  email,
}: {
  destination: string;
  email: string;
}) {
  return (
    <section className="max-w-sm mx-auto mt-8 bg-card border rounded-lg p-6">
      <h1 className="text-2xl font-semibold mb-1">You&apos;re still signed in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        That link had already been used — sign-in links work once. Nothing has
        gone wrong: you&apos;re signed in as <strong>{email}</strong> and can
        carry on. No need for another email.
      </p>
      <Button asChild>
        <Link href={destination} data-testid="already-signed-in-continue">
          Continue
        </Link>
      </Button>
    </section>
  );
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string; error?: string }>;
}) {
  const { callbackURL, error } = await searchParams;
  const session = await getOptionalSession();

  if (session) {
    // `safeInternalPath` first — a `callbackURL` reaching us as an absolute
    // URL would otherwise make this an open redirect. Then drop any `error=`
    // residue the destination itself carries, so following it doesn't land
    // the user on a stale banner.
    const destination = stripAuthErrorParam(safeInternalPath(callbackURL));
    // Arriving with no error at all is an ordinary "already signed in" —
    // a bookmark, a back button, a second tab. Send them straight on; there
    // is nothing to explain.
    if (error === undefined) redirect(destination);
    return <AlreadySignedIn destination={destination} email={session.user.email} />;
  }

  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
