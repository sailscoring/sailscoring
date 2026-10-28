import 'server-only';
import { createHash } from 'node:crypto';

import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { grantableWorkspaces, parseClientMetadata, REFRESH_TOKEN_PREFIX } from '@/lib/auth/oauth';
import { getDb } from '@/lib/db/client';
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken,
  organization,
} from '@/lib/db/schema/auth';
import type { ConnectedApp } from '@/lib/types';

/**
 * A user's connected apps (ADR-016): every grant they've given an outside
 * app, one per workspace, and every CLI they've signed in, with a way to
 * take each back. A grant is its consent and the tokens issued under it; the
 * CLI, which skips consent, is its tokens alone.
 */

const keyOf = (clientId: string, workspaceId: string | null) => `${clientId}\u0000${workspaceId ?? ''}`;

export async function listConnectedApps(
  userId: string,
): Promise<{ apps: ConnectedApp[]; canConnect: boolean }> {
  const db = getDb();
  const now = new Date();
  const [consents, refreshTokens, grantable] = await Promise.all([
    db
      .select({
        clientId: oauthConsent.clientId,
        workspaceId: oauthConsent.referenceId,
        scopes: oauthConsent.scopes,
        createdAt: oauthConsent.createdAt,
      })
      .from(oauthConsent)
      .where(eq(oauthConsent.userId, userId)),
    db
      .select({
        clientId: oauthRefreshToken.clientId,
        workspaceId: oauthRefreshToken.referenceId,
        scopes: oauthRefreshToken.scopes,
        createdAt: oauthRefreshToken.createdAt,
      })
      .from(oauthRefreshToken)
      .where(
        and(
          eq(oauthRefreshToken.userId, userId),
          isNull(oauthRefreshToken.revoked),
          gt(oauthRefreshToken.expiresAt, now),
        ),
      ),
    grantableWorkspaces(userId),
  ]);

  const grants = new Map<string, { clientId: string; workspaceId: string | null; scopes: Set<string>; since: Date }>();
  for (const row of [...consents, ...refreshTokens]) {
    const key = keyOf(row.clientId, row.workspaceId);
    const since = row.createdAt ?? now;
    const grant = grants.get(key);
    if (grant) {
      for (const s of row.scopes) grant.scopes.add(s);
      if (since < grant.since) grant.since = since;
    } else {
      grants.set(key, { clientId: row.clientId, workspaceId: row.workspaceId, scopes: new Set(row.scopes), since });
    }
  }
  if (grants.size === 0) return { apps: [], canConnect: grantable.length > 0 };

  const clientIds = [...new Set([...grants.values()].map((g) => g.clientId))];
  const workspaceIds = [...new Set([...grants.values()].flatMap((g) => (g.workspaceId ? [g.workspaceId] : [])))];
  const [clients, workspaces] = await Promise.all([
    db
      .select({ clientId: oauthClient.clientId, name: oauthClient.name, uri: oauthClient.uri, metadata: oauthClient.metadata })
      .from(oauthClient)
      .where(inArray(oauthClient.clientId, clientIds)),
    workspaceIds.length
      ? db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(inArray(organization.id, workspaceIds))
      : Promise.resolve([]),
  ]);
  const clientById = new Map(clients.map((c) => [c.clientId, c]));
  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));

  const apps = [...grants.values()]
    .map((g): ConnectedApp => {
      const client = clientById.get(g.clientId);
      return {
        clientId: g.clientId,
        name: client?.name ?? g.clientId,
        uri: client?.uri ?? null,
        firstParty: parseClientMetadata(client?.metadata).firstParty === true,
        workspaceId: g.workspaceId,
        workspaceName: g.workspaceId ? (workspaceName.get(g.workspaceId) ?? null) : null,
        scopes: [...g.scopes],
        connectedAt: g.since.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || (a.workspaceName ?? '').localeCompare(b.workspaceName ?? ''));
  return { apps, canConnect: grantable.length > 0 || apps.length > 0 };
}

/**
 * After an app revokes a refresh token: if it was the last live one under its
 * grant, take the grant back too, as Disconnect does. The provider's revoke
 * ends the token and leaves the consent, so the app would stay on the account
 * page and its next sign-in would skip the approval. The provider stores a
 * refresh token as the SHA-256 of its body, after the prefix; anything else
 * presented (an access token, a made-up string) finds no row and ends nothing.
 */
export async function endGrantAfterRevoke(presented: string): Promise<void> {
  if (!presented.startsWith(REFRESH_TOKEN_PREFIX)) return;
  const stored = createHash('sha256').update(presented.slice(REFRESH_TOKEN_PREFIX.length)).digest('base64url');
  const db = getDb();
  const [token] = await db
    .select({
      userId: oauthRefreshToken.userId,
      clientId: oauthRefreshToken.clientId,
      workspaceId: oauthRefreshToken.referenceId,
      revoked: oauthRefreshToken.revoked,
    })
    .from(oauthRefreshToken)
    .where(eq(oauthRefreshToken.token, stored))
    .limit(1);
  if (!token?.revoked) return;
  const reference =
    token.workspaceId === null ? isNull(oauthRefreshToken.referenceId) : eq(oauthRefreshToken.referenceId, token.workspaceId);
  const [live] = await db
    .select({ id: oauthRefreshToken.id })
    .from(oauthRefreshToken)
    .where(
      and(
        eq(oauthRefreshToken.userId, token.userId),
        eq(oauthRefreshToken.clientId, token.clientId),
        reference,
        isNull(oauthRefreshToken.revoked),
        gt(oauthRefreshToken.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (live) return;
  await disconnectApp(token.userId, { clientId: token.clientId, workspaceId: token.workspaceId });
}

export const disconnectInputSchema = z
  .object({ clientId: z.string().min(1), workspaceId: z.string().min(1).nullable() })
  .strict();

/**
 * Take a grant back: its consent and every token issued under it, at once.
 * The provider's own consent deletion leaves issued tokens working, so the
 * rows go here.
 */
export async function disconnectApp(userId: string, body: unknown): Promise<void> {
  const { clientId, workspaceId } = disconnectInputSchema.parse(body);
  const db = getDb();
  const reference = (column: typeof oauthConsent.referenceId | typeof oauthRefreshToken.referenceId | typeof oauthAccessToken.referenceId) =>
    workspaceId === null ? isNull(column) : eq(column, workspaceId);
  await db.transaction(async (tx) => {
    await tx
      .delete(oauthAccessToken)
      .where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId), reference(oauthAccessToken.referenceId)));
    await tx
      .delete(oauthRefreshToken)
      .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId), reference(oauthRefreshToken.referenceId)));
    await tx
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId), reference(oauthConsent.referenceId)));
  });
}
