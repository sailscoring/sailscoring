import { preflight, servePublishedResource } from '@/lib/public-api/serve';

export const dynamic = 'force-dynamic';

/** The published results API (ADR-015): a publication and its resources. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; resource?: string[] }> },
): Promise<Response> {
  const { id, resource = [] } = await params;
  return servePublishedResource(req, id, resource);
}

export function OPTIONS(): Response {
  return preflight();
}
