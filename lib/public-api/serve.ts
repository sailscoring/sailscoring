import 'server-only';

import { createHash } from 'node:crypto';

import { readPublishedObject } from '../blob-storage';
import { publishedApiCacheTag } from '../published-cache';
import { publishedResourceKey } from './store';

/**
 * Serving the published results API (ADR-015). Read-only and
 * unauthenticated; every response is JSON with an open CORS header.
 *
 * No database: a resource is found from its URL alone — the publication id
 * names its storage — so a request is one storage read, and an unknown id or
 * resource is a 404 from storage rather than a query. The CDN takes the
 * polling, as for the `/p` JSON: browsers revalidate every request against
 * the ETag, the CDN holds each response for a floor of a minute, and writing
 * a publication's view purges its tag.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FLEET_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RACE_NUMBER = /^[1-9]\d{0,3}$/;

const CACHE_CONTROL = 'public, no-cache';
const CDN_CACHE_CONTROL = 'public, s-maxage=60';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'ETag',
};

/** The resource path below a publication a URL names, or null when the URL
 *  names nothing the API serves. */
export function resourcePath(segments: readonly string[]): string | null {
  const [first, second, ...rest] = segments;
  if (rest.length > 0) return null;
  if (first === undefined) return '';
  if (second === undefined) {
    return first === 'standings' || first === 'races' || first === 'competitors' ? first : null;
  }
  if (first === 'standings' && FLEET_KEY.test(second)) return `standings/${second}`;
  if (first === 'races' && RACE_NUMBER.test(second)) return `races/${second}`;
  return null;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      ...CORS,
      ...headers,
    },
  });
}

/** The answer to a CORS preflight. A poller sending `If-None-Match` from a
 *  page needs one, as that header is not one browsers send unasked. */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'If-None-Match',
      'access-control-max-age': '86400',
    },
  });
}

export async function servePublishedResource(
  req: Request,
  publicationId: string,
  segments: readonly string[],
): Promise<Response> {
  const tag = { 'Vercel-CDN-Cache-Control': CDN_CACHE_CONTROL };
  // Every parameter is refused, so varying one cannot be used to walk past
  // the CDN and reach storage on every request.
  const params = [...new URL(req.url).searchParams.keys()];
  if (params.length > 0) {
    return json(400, { error: `unknown query parameter: ${params[0]}` }, tag);
  }
  const path = resourcePath(segments);
  if (!UUID.test(publicationId) || path === null) {
    return json(404, { error: 'not found' }, tag);
  }
  const cacheTag = { ...tag, 'Vercel-Cache-Tag': publishedApiCacheTag(publicationId) };
  const text = await readPublishedObject(publishedResourceKey(publicationId, path));
  if (text === null) return json(404, { error: 'not found' }, cacheTag);

  const etag = `"${createHash('sha256').update(text).digest('hex').slice(0, 32)}"`;
  if (req.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': CACHE_CONTROL, ...CORS },
    });
  }
  return new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': CACHE_CONTROL,
      ...cacheTag,
      ...CORS,
      etag,
    },
  });
}
