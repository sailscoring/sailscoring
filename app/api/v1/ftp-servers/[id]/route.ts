import {
  deleteFtpServer,
  getFtpServer,
  putFtpServer,
} from '@/lib/api-handlers/ftp-servers';
import { parseIfMatch, workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// FTP server rows carry credentials, so even the reads demand
// `manage-workspace` rather than the GET default.
export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getFtpServer(workspace, params.id);
}, { requires: 'manage-workspace' });

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putFtpServer(workspace, params.id, body, { expectedVersion: parseIfMatch(req) });
}, { requires: 'manage-workspace' });

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFtpServer(workspace, params.id);
}, { requires: 'manage-workspace' });
