import type { PublishPage } from './publish-pages';
import type { FtpServer, Series } from './types';

/**
 * Which configured server the FTP destination opens on.
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

/** Whether a page has been uploaded to this club's site before: `ftpPaths`
 *  carries an entry for it, under its page key or the older bare fleet-id
 *  key. A path the pane merely prefilled from the legacy single path doesn't
 *  count — only what an upload (or the path-threading script) actually
 *  stored. */
function wasUploaded(page: PublishPage, stored: Record<string, string>): boolean {
  if (stored[page.key] !== undefined) return true;
  return page.fleetId ? stored[page.fleetId] !== undefined : false;
}

/**
 * Which pages the FTP destination opens with ticked.
 *
 * Two rules, in order. The first is the Sail Scoring destination's, reading
 * the record FTP keeps instead of the publication: everything on a series
 * that has never been uploaded to, and afterwards only the pages that have
 * gone out before — so a newly created page is never swept into an upload
 * unnoticed. The second remembers the scorer unticking a page that had gone
 * out before, which is the only thing the first can't express.
 */
export function resolveFtpPageSelection(
  pages: PublishPage[],
  ftpPaths: Record<string, string> | undefined,
  excluded?: string[],
): Set<string> {
  const stored = ftpPaths ?? {};
  const left = new Set(excluded ?? []);
  const uploaded = pages.filter((p) => wasUploaded(p, stored));
  const base = uploaded.length > 0 ? uploaded : pages;
  return new Set(base.filter((p) => !left.has(p.key)).map((p) => p.key));
}
