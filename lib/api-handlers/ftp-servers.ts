import 'server-only';

import { NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { ftpServerInputSchema } from '@/lib/validation/ftp-server';
import type { FtpServer } from '@/lib/types';

export async function listFtpServers(
  workspace: WorkspaceContext,
): Promise<FtpServer[]> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.ftpServers.list();
}

export async function getFtpServer(
  workspace: WorkspaceContext,
  id: string,
): Promise<FtpServer> {
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
  const input = ftpServerInputSchema.parse(body);
  const id = input.id ?? pathId;
  if (id !== pathId) throw new NotFoundError('ftp-server id mismatch with path');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.ftpServers.save(
    { ...input, id },
    { expectedVersion: opts?.expectedVersion },
  );
}

export async function deleteFtpServer(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.ftpServers.delete(id);
}
