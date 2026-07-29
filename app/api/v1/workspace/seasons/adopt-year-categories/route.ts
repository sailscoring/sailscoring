import { adoptYearCategories } from '@/lib/api-handlers/seasons';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (_req, { workspace }) => {
    return adoptYearCategories(workspace);
  },
);
