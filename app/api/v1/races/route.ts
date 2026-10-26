import { listRacesBetween } from '@/lib/api-handlers/races';
import { workspaceRoute } from '../_lib/handler';

export const dynamic = 'force-dynamic';

/** The races dated `from` to `to` (`to` defaults to `from`) across the
 *  workspace's live series, each with its series' name and its starts. */
export const GET = workspaceRoute<Record<string, never>, unknown>(async (req, { workspace }) => {
  const q = req.nextUrl.searchParams;
  return listRacesBetween(workspace, q.get('from'), q.get('to'));
});
