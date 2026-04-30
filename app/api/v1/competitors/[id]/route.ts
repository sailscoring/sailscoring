import {
  deleteCompetitorFlat,
  getCompetitorFlat,
} from '@/lib/api-handlers/competitors';
import { NotFoundError, workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  const competitor = await getCompetitorFlat(workspace, params.id);
  if (!competitor) throw new NotFoundError('competitor');
  return competitor;
});

export const DELETE = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  await deleteCompetitorFlat(workspace, params.id);
});
