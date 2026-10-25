'use client';

import { useConnectedApps, useDisconnectApp } from '@/hooks/use-connected-apps';
import { describeScopes } from '@/lib/oauth-scopes';
import type { ConnectedApp } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/confirm-dialog';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The apps the user has let act for them (ADR-016), and a way to take each
 * back: an outside app per workspace it was granted, and the command line
 * wherever it's signed in. Disconnecting stops the app's access at once.
 * Hidden for someone with nothing connected and nowhere they could connect
 * an app.
 */
export function ConnectedAppsCard() {
  const { data, isLoading } = useConnectedApps();
  const disconnect = useDisconnectApp();
  const confirm = useConfirm();

  if (isLoading || !data || !data.canConnect) return null;

  async function onDisconnect(app: ConnectedApp) {
    const where = app.workspaceName ? ` from ${app.workspaceName}` : '';
    const ok = await confirm({
      title: `Disconnect ${app.name}?`,
      description: app.firstParty ? (
        <>
          The command line will be signed out. Run <code>sailscoring auth login</code> to sign it in again.
        </>
      ) : (
        `${app.name} will lose its access${where} straight away. You can connect it again from the app.`
      ),
      confirmLabel: 'Disconnect',
    });
    if (ok) disconnect.mutate({ clientId: app.clientId, workspaceId: app.workspaceId });
  }

  return (
    <section className="rounded-lg border p-5 space-y-3 mt-4" data-testid="connected-apps-card">
      <div>
        <h2 className="text-lg font-semibold">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Apps you&apos;ve let work in Sail Scoring as you. Each can do no more than your role allows,
          and what it does is recorded as yours, made through it.
        </p>
      </div>
      {data.apps.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="connected-apps-empty">
          No apps connected.
        </p>
      ) : (
        <ul className="divide-y">
          {data.apps.map((app) => (
            <li
              key={`${app.clientId}-${app.workspaceId ?? 'all'}`}
              className="py-3 flex items-start justify-between gap-3"
              data-testid="connected-app"
            >
              <div className="min-w-0 text-sm">
                <p className="font-medium">
                  {app.uri ? (
                    <a href={app.uri} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                      {app.name}
                    </a>
                  ) : (
                    app.name
                  )}
                </p>
                <p className="text-muted-foreground">
                  {app.firstParty ? 'Every workspace you belong to' : (app.workspaceName ?? 'A workspace you have left')}
                  {' · '}connected {formatDate(app.connectedAt)}
                </p>
                {!app.firstParty && (
                  <ul className="text-xs text-muted-foreground list-disc pl-4 mt-1">
                    {describeScopes(app.scopes)
                      .filter((s) => s.scope !== 'offline_access')
                      .map((s) => (
                        <li key={s.scope}>{s.description}</li>
                      ))}
                  </ul>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onDisconnect(app)}
                disabled={disconnect.isPending}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
