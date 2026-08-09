'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { RATE_LIMITED_ERROR } from '@/lib/auth/verify-rate-limit';
import { encodeNextPath, stripAuthErrorParam } from '@/lib/safe-redirect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignInForm() {
  const searchParams = useSearchParams();
  // Strip a stale `?error=…` from the forwarded destination: sign-in
  // URLs minted before the auth-guard started stripping it (bookmarks,
  // long-lived tabs) still carry one.
  const callbackURL = stripAuthErrorParam(searchParams.get('callbackURL') ?? '/');
  // A failed verify (expired or already-used link) redirects here with
  // ?error=<code> — see the errorCallbackURL passed below.
  const errorCode = searchParams.get('error');
  // Throttled verify is the one failure where the link is still good: the
  // limiter answers before the endpoint, so the token was never consumed.
  const throttled = errorCode === RATE_LIMITED_ERROR;
  const failedLink = errorCode !== null && !throttled;
  const retryMinutes = Math.max(
    1,
    Math.ceil(Number(searchParams.get('retryAfter') ?? 0) / 60),
  );
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    setErrorMessage(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL,
      // First-time sign-ups land on the welcome step (name prompt) before
      // their intended destination; returning users skip straight to it.
      // base64url rather than percent-encoding: the verify endpoint
      // URL-decodes this param once more than we encode it, so a nested
      // `?` would otherwise fail its callback validation.
      newUserCallbackURL: `/welcome?next=${encodeNextPath(callbackURL)}`,
      // A failed verify lands back here with ?error=<code> so the user
      // gets an explanation instead of silently looping through the
      // sign-in redirect.
      errorCallbackURL: '/sign-in',
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message ?? 'Could not send sign-in link');
      return;
    }
    setStatus('sent');
  }

  // No form here on purpose: while the window is open, requesting another
  // email produces a link that will be refused in exactly the same way. The
  // only thing that helps is waiting, so that is the whole message.
  if (throttled) {
    return (
      <section
        className="max-w-sm mx-auto mt-8 bg-card border rounded-lg p-6"
        data-testid="sign-in-throttled"
      >
        <h1 className="text-2xl font-semibold mb-1">Too many attempts</h1>
        <p className="text-sm text-muted-foreground mb-3">
          Too many sign-in links have been opened from your network in a short
          space of time.
        </p>
        <p className="text-sm">
          Your link is still good — it wasn&apos;t used up. Open the most recent
          sign-in email again in about {retryMinutes}{' '}
          {retryMinutes === 1 ? 'minute' : 'minutes'} and it will work. Asking
          for another email won&apos;t make it any quicker.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-sm mx-auto mt-8 bg-card border rounded-lg p-6">
      <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter your email and we&apos;ll send you a one-time link.
      </p>

      {status === 'sent' ? (
        <p className="text-sm">
          Check your inbox at <strong>{email}</strong>. The link expires in 30
          minutes.
        </p>
      ) : (
        <>
          {failedLink && (
            <p
              role="alert"
              className="text-sm mb-4 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950 px-3 py-2"
            >
              That sign-in link didn&apos;t work — it may have expired or
              already been used. Enter your email to get a fresh one.
            </p>
          )}
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'sending'}
              />
            </div>
            <Button type="submit" disabled={status === 'sending' || !email}>
              {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </Button>
            {status === 'error' && errorMessage && (
              <p className="text-sm text-red-600">{errorMessage}</p>
            )}
          </form>
          <p className="text-xs text-muted-foreground mt-4">
            By signing in or creating an account, you agree to the{' '}
            <a
              href="https://sailscoring.ie/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Terms
            </a>{' '}
            and{' '}
            <a
              href="https://sailscoring.ie/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Privacy Policy
            </a>
            .
          </p>
        </>
      )}
    </section>
  );
}
