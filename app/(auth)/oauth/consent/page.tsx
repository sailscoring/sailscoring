import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { getOptionalSession } from '@/lib/auth/require-session';
import { appDisplay, workspaceGrantable } from '@/lib/auth/oauth';
import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { describeScopes } from '@/lib/oauth-scopes';
import { UnknownApp } from '../unknown-app';
import { ConsentForm } from './consent-form';

export const dynamic = 'force-dynamic';

/**
 * The last step of granting an app access (ADR-016): what it may do, in
 * which workspace. The OAuth provider sends the user here with the request
 * signed into the query, once the workspace has been chosen.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getOptionalSession();
  if (!session) redirect('/sign-in');
  const { client_id: clientId, scope } = await searchParams;
  const app = typeof clientId === 'string' ? await appDisplay(clientId) : null;
  if (!app) return <UnknownApp />;
  const workspaceId = session.session.activeOrganizationId;
  const [workspace] =
    workspaceId && (await workspaceGrantable(session.user.id, workspaceId))
      ? await getDb()
          .select({ name: organization.name })
          .from(organization)
          .where(eq(organization.id, workspaceId))
          .limit(1)
      : [];
  const scopes = describeScopes(typeof scope === 'string' ? scope.split(' ') : []);
  return <ConsentForm app={app} workspaceName={workspace?.name ?? null} scopes={scopes} email={session.user.email} />;
}
