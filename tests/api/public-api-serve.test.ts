// @vitest-environment node

/**
 * Serving the published results API: a resource is read from storage by the
 * URL alone, with an ETag a poller can send back, open CORS, and nothing
 * else the URL could vary to get past the CDN.
 *
 * Skipped when DATABASE_URL is unset (the local storage fallback is a table).
 */
import { afterAll, describe, expect, test } from 'vitest';

import { deletePublishedObject, putPublishedHtml } from '@/lib/blob-storage';
import { preflight, resourcePath, servePublishedResource } from '@/lib/public-api/serve';
import { publishedResourceKey } from '@/lib/public-api/store';

const skip = !process.env.DATABASE_URL;

describe('resourcePath', () => {
  test('names the resources the API serves, and nothing else', () => {
    expect(resourcePath([])).toBe('');
    expect(resourcePath(['standings'])).toBe('standings');
    expect(resourcePath(['standings', 'cruisers-1'])).toBe('standings/cruisers-1');
    expect(resourcePath(['races'])).toBe('races');
    expect(resourcePath(['races', '12'])).toBe('races/12');
    expect(resourcePath(['competitors'])).toBe('competitors');
    expect(resourcePath(['schedule'])).toBe('schedule');
    expect(resourcePath(['_view'])).toBeNull();
    expect(resourcePath(['races', '0'])).toBeNull();
    expect(resourcePath(['races', 'x'])).toBeNull();
    expect(resourcePath(['standings', '../_view'])).toBeNull();
    expect(resourcePath(['standings', 'a', 'b'])).toBeNull();
  });
});

describe.skipIf(skip)('servePublishedResource', () => {
  const id = crypto.randomUUID();
  const url = (path: string) => `https://app.example/api/public/v1/publications/${id}${path}`;

  afterAll(async () => {
    await deletePublishedObject(publishedResourceKey(id, 'standings'));
  });

  test('serves a stored resource with an ETag, and 304 when it is sent back', async () => {
    const body = JSON.stringify({ tables: [] });
    await putPublishedHtml(publishedResourceKey(id, 'standings'), body, 'application/json; charset=utf-8');

    const res = await servePublishedResource(new Request(url('/standings')), id, ['standings']);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-expose-headers')).toBe('ETag');
    expect(res.headers.get('vercel-cache-tag')).toBe(`api:${id}`);
    const etag = res.headers.get('etag')!;

    const again = await servePublishedResource(
      new Request(url('/standings'), { headers: { 'if-none-match': etag } }),
      id,
      ['standings'],
    );
    expect(again.status).toBe(304);
  });

  test('a resource nothing has published is a 404', async () => {
    const res = await servePublishedResource(new Request(url('/competitors')), id, ['competitors']);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  test('a malformed id or an unknown path is a 404 without a read', async () => {
    expect((await servePublishedResource(new Request(url('')), 'not-a-uuid', [])).status).toBe(404);
    expect((await servePublishedResource(new Request(url('/fleets')), id, ['fleets'])).status).toBe(404);
  });

  test('a query parameter is refused', async () => {
    const res = await servePublishedResource(new Request(url('/standings?bust=1')), id, ['standings']);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', message: 'unknown query parameter: bust' });
  });

  test('a CORS preflight allows If-None-Match', () => {
    const res = preflight();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toBe('If-None-Match');
  });
});
