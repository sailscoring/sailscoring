import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { ftpServerInputSchema } from '@/lib/validation/ftp-server';
import type { FtpServer } from '@/lib/types';

// FTP upload is an experimental, gated feature (#155). These endpoints store
// FTP credentials, so the gate is enforced server-side — not just by hiding
// the UI — since the routes could be hit directly.

export async function listFtpServers(
  workspace: WorkspaceContext,
): Promise<FtpServer[]> {
  requireFeature(workspace, 'ftp-upload');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.ftpServers.list();
}

export async function getFtpServer(
  workspace: WorkspaceContext,
  id: string,
): Promise<FtpServer> {
  requireFeature(workspace, 'ftp-upload');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const all = await repos.ftpServers.list();
  const server = all.find((s) => s.id === id);
  if (!server) throw new NotFoundError('ftp-server');
  return server;
}

export async function putFtpServer(
  workspace: WorkspaceContext,
  pathId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<FtpServer> {
  requireFeature(workspace, 'ftp-upload');
  const input = ftpServerInputSchema.parse(body);
  const id = input.id ?? pathId;
  if (id !== pathId) throw new NotFoundError('ftp-server id mismatch with path');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.ftpServers.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
}

export async function deleteFtpServer(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  requireFeature(workspace, 'ftp-upload');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.ftpServers.delete(id);
}
