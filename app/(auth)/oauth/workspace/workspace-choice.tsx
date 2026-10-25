'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient, refreshSessionCache } from '@/lib/auth-client';
import type { AppDisplay, GrantableWorkspace } from '@/lib/auth/oauth';
import { Button } from '@/components/ui/button';
import { AppName } from '../app-name';

export function WorkspaceChoice({
  app,
  workspaces,
  activeWorkspaceId,
}: {
  app: AppDisplay;
  workspaces: GrantableWorkspace[];
  activeWorkspaceId: string | null;
}) {
  const [chosen, setChosen] = useState<string | null>(
    workspaces.find((w) => w.id === activeWorkspaceId)?.id ?? (workspaces.length === 1 ? workspaces[0].id : null),
  );
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const router = useRouter();

  async function onContinue() {
    if (!chosen) return;
    setStatus('working');
    try {
      // The grant's workspace is the session's active one when the request
      // carries on; the provider checks again that it may be granted. The
      // switch is a plain request: through the auth client it would carry
      // the signed authorization request too, which the provider picks up
      // and runs in any request that sets the session cookie.
      const switched = await fetch('/api/auth/organization/set-active', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: chosen }),
      });
      if (!switched.ok) throw new Error('could not switch workspace');
      await refreshSessionCache();
      const { data, error } = await authClient.$fetch<{ url?: string }>('/oauth2/continue', {
        method: 'POST',
        body: { postLogin: true },
      });
      if (error || !data?.url) throw new Error(error?.message ?? 'no redirect');
      window.location.assign(data.url);
    } catch {
      setStatus('error');
    }
  }

  return (
    <section className="max-w-md mx-auto mt-8 bg-card border rounded-lg p-6" data-testid="oauth-workspace">
      <h1 className="text-2xl font-semibold mb-1">Connect <AppName app={app} /></h1>
      {workspaces.length === 0 ? (
        <>
          <p className="text-sm text-muted-foreground mb-4" data-testid="oauth-no-workspace">
            None of your workspaces can be connected to apps yet. Connecting apps is being turned on
            workspace by workspace; to ask for yours, contact{' '}
            <a href="mailto:mark@hyc.ie" className="underline">mark@hyc.ie</a>.
          </p>
          <Button variant="outline" onClick={() => router.push('/')}>
            Back to Sail Scoring
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-4">
            Which workspace should {app.name} work in? It will be able to reach that workspace only,
            and only as far as your own role there allows.
          </p>
          <fieldset className="flex flex-col gap-2 mb-6">
            <legend className="sr-only">Workspace</legend>
            {workspaces.map((w) => (
              <label key={w.id} className="flex items-center gap-2 text-sm rounded-md border px-3 py-2 cursor-pointer">
                <input
                  type="radio"
                  name="workspace"
                  value={w.id}
                  checked={chosen === w.id}
                  onChange={() => setChosen(w.id)}
                />
                {w.name}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button onClick={onContinue} disabled={!chosen || status === 'working'}>
              {status === 'working' ? 'Continuing…' : 'Continue'}
            </Button>
            <Button variant="outline" onClick={() => router.push('/')} disabled={status === 'working'}>
              Cancel
            </Button>
          </div>
          {status === 'error' && (
            <p role="alert" className="text-sm text-red-600 mt-3">
              That didn&apos;t work. Go back to {app.name} and start connecting again.
            </p>
          )}
        </>
      )}
    </section>
  );
}
