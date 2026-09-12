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
