import {
  deleteFtpServer,
  getFtpServer,
  putFtpServer,
} from '@/lib/api-handlers/ftp-servers';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return getFtpServer(workspace, params.id);
});

export const PUT = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return putFtpServer(workspace, params.id, body);
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteFtpServer(workspace, params.id);
});
