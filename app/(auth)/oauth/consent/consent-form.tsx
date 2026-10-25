'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import type { AppDisplay } from '@/lib/auth/oauth';
import { Button } from '@/components/ui/button';
import { AppName } from '../app-name';

export function ConsentForm({
  app,
  workspaceName,
  scopes,
  email,
}: {
  app: AppDisplay;
  workspaceName: string | null;
  scopes: { scope: string; description: string }[];
  email: string;
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');

  async function answer(accept: boolean) {
    setStatus('working');
    const { data, error } = await authClient.$fetch<{ url?: string }>('/oauth2/consent', {
      method: 'POST',
      body: { accept },
    });
    if (error || !data?.url) {
      setStatus('error');
      return;
    }
    window.location.assign(data.url);
  }

  if (!workspaceName) {
    return (
      <section className="max-w-md mx-auto mt-8 bg-card border rounded-lg p-6" data-testid="oauth-consent-no-workspace">
        <h1 className="text-2xl font-semibold mb-1">Connect <AppName app={app} /></h1>
        <p className="text-sm text-muted-foreground">
          No workspace has been chosen for {app.name}. Go back to {app.name} and start connecting again.
        </p>
      </section>
    );
  }

  return (
    <section className="max-w-md mx-auto mt-8 bg-card border rounded-lg p-6" data-testid="oauth-consent">
      <h1 className="text-2xl font-semibold mb-1">Connect <AppName app={app} /></h1>
      <p className="text-sm text-muted-foreground mb-4">
        {app.name} is asking to act as you (<strong>{email}</strong>) in <strong>{workspaceName}</strong>.
        It will be able to:
      </p>
      <ul className="list-disc pl-5 text-sm space-y-1 mb-4" data-testid="oauth-consent-scopes">
        {scopes.map((s) => (
          <li key={s.scope}>{s.description}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground mb-6">
        It can never do more than your role in {workspaceName} allows, and its changes are recorded
        in the activity log as yours, made through {app.name}. You can disconnect it at any time from
        your account page.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => answer(true)} disabled={status === 'working'} data-testid="oauth-consent-allow">
          Allow
        </Button>
        <Button variant="outline" onClick={() => answer(false)} disabled={status === 'working'}>
          Deny
        </Button>
      </div>
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-600 mt-3">
          That didn&apos;t work. Go back to {app.name} and start connecting again.
        </p>
      )}
    </section>
  );
}
