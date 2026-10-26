import type { PublishPage } from './publish-pages';
import { relativeSubPath } from './publishing';
import { seriesSlug } from './series-name';
import type { FtpServer, Series } from './types';

/**
 * Which configured server a series uploads to.
 *
 * The series remembers its server by id, written as soon as the scorer picks
 * one. Two fallbacks cover series that predate that: the host string an
 * upload stamped on the series, and — for a workspace with a single server,
 * which is the common club case — that server. Returns '' when nothing
 * resolves, which is the Select's placeholder state.
 */
export function resolveFtpServerId(
  servers: FtpServer[],
  series: Pick<Series, 'ftpServerId' | 'ftpHost'>,
): string {
  if (series.ftpServerId) {
    const byId = servers.find((s) => s.id === series.ftpServerId);
    if (byId) return byId.id;
  }
  if (series.ftpHost) {
    const byHost = servers.find((s) => s.host === series.ftpHost);
    if (byHost) return byHost.id;
  }
  return servers.length === 1 ? servers[0].id : '';
}

/**
 * The remote path each page uploads to, keyed by page key — only the pages
 * that have one. A page missing from the answer stays off the club's site.
 *
 * Read from the series' stored paths: under the page's own key, else under
 * the bare fleet id a fleet's page was keyed by before pages had keys. The
 * lone default page also takes the legacy single `ftpPath` of a series
 * configured before per-page paths existed. Nothing is derived beyond that:
 * a path the scorer never typed is a guess, and a guess here puts a file on
 * someone else's web server.
 */
export function configuredFtpPaths(
  pages: PublishPage[],
  series: Pick<Series, 'ftpPaths' | 'ftpPath'>,
): Record<string, string> {
  const stored = series.ftpPaths ?? {};
  const paths: Record<string, string> = {};
  for (const page of pages) {
    const path = (
      stored[page.key] ??
      (page.fleetId ? stored[page.fleetId] : undefined) ??
      (page.isDefault ? series.ftpPath : undefined) ??
      ''
    ).trim();
    if (path) paths[page.key] = path;
  }
  return paths;
}

/**
 * The path a page's file goes to. A series with sub-series builds one file
 * per block for each page, and each block's goes to the page's path with the
 * block's name before the extension (frostbites.html → frostbites-winter.html).
 */
export function ftpFilePath(basePath: string, subSeriesName?: string): string {
  if (!subSeriesName) return basePath;
  const suffix = '-' + seriesSlug(subSeriesName);
  const lastDot = basePath.lastIndexOf('.');
  const lastSlash = basePath.lastIndexOf('/');
  if (lastDot > lastSlash) return basePath.slice(0, lastDot) + suffix + basePath.slice(lastDot);
  return basePath + suffix;
}

/**
 * Where a link on a page bound for the club's site should point to another
 * page of the same publication: the target's own copy on the club's site
 * when it has one, relative to the linking page, and the target's published
 * Sail Scoring URL when it doesn't.
 */
export function ftpLinkHref(
  fromFtpPath: string,
  targetFtpPath: string | undefined,
  targetPublishedUrl: string,
): string {
  return targetFtpPath ? relativeSubPath(fromFtpPath, targetFtpPath) : targetPublishedUrl;
}

/**
 * A published page as it goes to a club's own site: every root-relative URL
 * made absolute against the app. A published page is served from the app, so
 * `/logos/{id}` (a library logo) resolves there; on the club's domain it
 * resolves to nothing.
 */
export function absolutizeRootRelativeUrls(html: string, appBase: string): string {
  if (!appBase) return html;
  return html.replace(/(\s(?:src|href)=")\/(?!\/)/g, `$1${appBase}/`);
}
