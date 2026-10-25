import { redirect } from 'next/navigation';

import { getOptionalSession } from '@/lib/auth/require-session';
import { appDisplay, grantableWorkspaces } from '@/lib/auth/oauth';
import { UnknownApp } from '../unknown-app';
import { WorkspaceChoice } from './workspace-choice';

export const dynamic = 'force-dynamic';

/**
 * The first step of granting an app access (ADR-016): which workspace it
 * may act in. The OAuth provider sends the user here after sign-in, with
 * the authorization request signed into the query; the choice becomes the
 * grant's workspace.
 */
export default async function OAuthWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getOptionalSession();
  if (!session) redirect('/sign-in');
  const { client_id: clientId } = await searchParams;
  const app = typeof clientId === 'string' ? await appDisplay(clientId) : null;
  if (!app) return <UnknownApp />;
  const workspaces = await grantableWorkspaces(session.user.id);
  return (
    <WorkspaceChoice
      app={app}
      workspaces={workspaces}
      activeWorkspaceId={session.session.activeOrganizationId ?? null}
    />
  );
}
