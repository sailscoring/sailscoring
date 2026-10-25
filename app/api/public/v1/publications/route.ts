import { listPublicationsPublic } from '@/lib/api-handlers/public-v1';
import { publicPreflight, publicRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

/** Every publication in the workspace. Each is served, with no token, at
 *  `/publications/{id}`. */
export const GET = publicRoute(async (_req, { workspace }) => listPublicationsPublic(workspace), {
  scope: 'read',
  requires: 'read',
});

export const OPTIONS = publicPreflight;
