'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function SignInForm() {
  const searchParams = useSearchParams();
  const callbackURL = searchParams.get('callbackURL') ?? '/';
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
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message ?? 'Could not send sign-in link');
      return;
    }
    setStatus('sent');
  }

  return (
    <section className="max-w-sm">
      <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter your email and we&apos;ll send you a one-time link.
      </p>

      <aside
        data-testid="stealth-beta-notice"
        className="mb-6 rounded-md border px-4 py-3 text-sm text-muted-foreground"
      >
        <p className="mb-2">
          Sail Scoring is in stealth beta, running trials with sailing clubs in Ireland.
        </p>
        <p className="mb-2">
          You&apos;re welcome to try it out — feedback to{' '}
          <a href="mailto:mark@hyc.ie" className="underline">
            mark@hyc.ie
          </a>{' '}
          is appreciated.
        </p>
        <p>
          <strong>Heads up:</strong> while we&apos;re still iterating, accounts
          created outside our trial cohort may be deleted (with a copy of your
          data emailed back) after a couple of weeks.
        </p>
      </aside>

      {status === 'sent' ? (
        <p className="text-sm">
          Check your inbox at <strong>{email}</strong>. The link expires in 5
          minutes.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <div>
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
      )}
    </section>
  );
}
