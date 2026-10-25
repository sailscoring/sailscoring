import { publicApiOpenApi } from '@/lib/public-api/openapi';

export const dynamic = 'force-dynamic';

/** The public API's OpenAPI 3.1 description: the published results (ADR-015) and the authenticated calls beside them (ADR-016). */
export function GET(req: Request): Response {
  return new Response(JSON.stringify(publicApiOpenApi(new URL(req.url).origin), null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
}
