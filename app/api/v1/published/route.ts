import { listPublished } from '@/lib/api-handlers/publish';
import type { PublishedListItem } from '@/lib/types';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

// Every publication in the workspace — the "Published" management listing
// (#164). Includes orphans (series deleted), which only this surface manages.
export const GET = workspaceRoute<Record<string, never>, PublishedListItem[]>(
  async (_req, { workspace }) => listPublished(workspace),
);
