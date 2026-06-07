import { createLogo, listLogos } from '@/lib/api-handlers/logos';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

export const GET = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    // `?from={workspaceId}` lists another workspace the caller belongs to,
    // for the cross-workspace copy picker (Phase 4).
    const from = req.nextUrl.searchParams.get('from') ?? undefined;
    return listLogos(workspace, from);
  },
);

export const POST = workspaceRoute<Record<string, never>, unknown>(
  async (req, { workspace }) => {
    const body = await req.json();
    return createLogo(workspace, body);
  },
);
