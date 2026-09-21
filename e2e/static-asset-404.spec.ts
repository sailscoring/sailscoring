import { test, expect } from './fixtures';

/**
 * Missing static assets are answered cheaply, and the icons clients ask for
 * by convention are actually served.
 *
 * A file-shaped path that doesn't exist used to fall through to the app
 * router and render the full 404 page — an uncached invocation shipping
 * ~28 KB of chrome to a link previewer that wanted an icon. A fallback
 * rewrite in `next.config.ts` now routes those to an empty, cacheable 404.
 * The point of these assertions is that nothing which *does* exist got
 * caught by that rewrite.
 */

const SERVED = [
  // Next publishes the icon at `/apple-icon.png`; iOS asks at these two root
  // paths whatever the head says.
  ['/apple-touch-icon.png', 'image/png'],
  ['/apple-touch-icon-precomposed.png', 'image/png'],
  ['/favicon.ico', /icon/],
  ['/icon.svg', 'image/svg+xml'],
  ['/apple-icon.png', 'image/png'],
  ['/robots.txt', /text\/plain/],
  // From the public directory, including a nested path and a name with a dot
  // in it — the shapes the rewrite's pattern could plausibly have swallowed.
  ['/sail-scoring-wordmark.svg', 'image/svg+xml'],
  ['/canonical-logos/1720.small.png', 'image/png'],
  ['/help/shots/a53-scoring.webp', 'image/webp'],
] as const;

for (const [path, type] of SERVED) {
  test(`${path} is served`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(type);
    expect((await res.body()).byteLength).toBeGreaterThan(0);
  });
}

// The probes seen in the firewall log: icon sizes never declared, manifests
// the app doesn't publish, and a plain miss.
const MISSING = [
  '/favicon-32x32.png',
  '/site.webmanifest',
  '/manifest.json',
  '/browserconfig.xml',
  '/sitemap.xml',
  '/no-such-asset.png',
  '/deep/path/to/nothing.css',
];

for (const path of MISSING) {
  test(`${path} 404s with an empty, cacheable body`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(404);
    expect((await res.body()).byteLength).toBe(0);
    // Cacheable, so the CDN answers the repeats. A deploy purges the cache,
    // so an asset added later isn't shadowed by a cached miss.
    expect(res.headers()['cache-control']).toContain('public');
  });
}

test('a missing page still renders the 404 page, not the asset stub', async ({ request }) => {
  // Only file-shaped paths take the cheap route: a mistyped page URL is a
  // person who needs telling where they are.
  const res = await request.get('/help/no-such-chapter', { maxRedirects: 0 });
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('<html');
});
