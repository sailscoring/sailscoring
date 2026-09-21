/**
 * The cheap end of a missing static asset.
 *
 * A request for a path that looks like a file — `/apple-touch-icon.png`,
 * `/site.webmanifest`, `/favicon-32x32.png` — used to fall through to the
 * app router and render the full 404 page: an uncached function invocation
 * shipping 28 KB of navigation chrome and font links to a link previewer
 * that wanted a 5 KB icon. The probes never stop, because old clients and
 * feed readers ask regardless of what the page's head declares.
 *
 * A `fallback` rewrite in `next.config.ts` sends those paths here instead.
 * Fallback rewrites run after the filesystem, the public directory and every
 * dynamic route have been checked, so nothing that exists is affected — only
 * what would otherwise have been the 404 page.
 *
 * The response is empty and publicly cacheable, so the CDN answers the
 * repeats and the origin sees the probe once. Caching a 404 is safe here
 * because a deployment purges the CDN, so an asset added later is served
 * from the moment it ships rather than after the window expires.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(null, {
    status: 404,
    headers: {
      'cache-control': 'public, max-age=3600, s-maxage=86400',
      'x-robots-tag': 'noindex',
    },
  });
}
