import { getSeriesPublicationPublic, publishPublic, unpublishPublic } from '@/lib/api-handlers/public-v1';
import { publishInput } from '@/lib/validation/public-api-v1-authenticated';
import { publicPreflight, publicRoute, readBody } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = publicRoute<Params>(
  async (_req, { workspace, params }) => getSeriesPublicationPublic(workspace, params.id),
  { scope: 'read', requires: 'read' },
);

export const POST = publicRoute<Params>(
  async (req, { workspace, params }) => publishPublic(workspace, params.id, await readBody(req, publishInput)),
  { scope: 'publish', requires: 'score' },
);

export const DELETE = publicRoute<Params>(
  async (_req, { workspace, params }) => unpublishPublic(workspace, params.id),
  { scope: 'publish', requires: 'score' },
);

export const OPTIONS = publicPreflight;
