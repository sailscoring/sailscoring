import type { MetadataRoute } from 'next';

/**
 * No crawling of the app domain, at all.
 *
 * Everything here is served by a function: the public results tree (`/p/...`)
 * reads Postgres and Blob storage on every request, and the rest of the app
 * is behind the login gate anyway. A crawler walking the publication tree —
 * seasons, folders, series, fleet pages, per-race pages, and one page per
 * competitor identity — therefore costs real compute and database traffic for
 * pages nobody asked for. That cost is the reason this file exists.
 *
 * The trade is discoverability: results published here will not appear in
 * search. Sailors reach them by link, which is how a results page is shared
 * in practice. Search-engine presence belongs to the marketing site
 * (`sailscoring.ie`), which is static and free to crawl.
 *
 * This governs pages served from this domain only. HTML downloaded or
 * FTP-published to a club's own server carries no robots directive from us —
 * whether those copies are indexed is the club's call, on the club's
 * bandwidth.
 *
 * Compliant crawlers obey this; the ones that don't are a firewall problem,
 * not a robots.txt problem.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
