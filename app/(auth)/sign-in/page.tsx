import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/require-session';
import { authorizeCallbackFromQuery } from '@/lib/oauth-sign-in';
import { safeInternalPath, stripAuthErrorParam } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { SponsorCredit } from '@/components/sponsor-credit';
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackURL = typeof params.callbackURL === 'string' ? params.callbackURL : undefined;
  const error = typeof params.error === 'string' ? params.error : undefined;
  const session = await getOptionalSession();

  // An app's authorization request that found no session: once signed in,
  // the request carries on where it was.
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, v);
  }
  const authorize = authorizeCallbackFromQuery(query);
  if (session && authorize) redirect(authorize);

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
    <>
      <Suspense>
        <SignInForm />
      </Suspense>
      <SponsorCredit className="max-w-sm mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground" />
    </>
  );
}
