'use client';

import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { encodeNextPath } from '@/lib/safe-redirect';
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
      // First-time sign-ups land on the welcome step (name prompt) before
      // their intended destination; returning users skip straight to it.
      // base64url rather than percent-encoding: the verify endpoint
      // URL-decodes this param once more than we encode it, so a nested
      // `?` would otherwise fail its callback validation.
      newUserCallbackURL: `/welcome?next=${encodeNextPath(callbackURL)}`,
    });
    if (error) {
      setStatus('error');
      setErrorMessage(error.message ?? 'Could not send sign-in link');
      return;
    }
    setStatus('sent');
  }

  return (
    <section className="max-w-sm mx-auto mt-8 bg-card border rounded-lg p-6">
      <h1 className="text-2xl font-semibold mb-1">Sign in</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Enter your email and we&apos;ll send you a one-time link.
      </p>

      {status === 'sent' ? (
        <p className="text-sm">
          Check your inbox at <strong>{email}</strong>. The link expires in 5
          minutes.
        </p>
      ) : (
        <>
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
