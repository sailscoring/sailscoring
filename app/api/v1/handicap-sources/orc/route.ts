import { getOrcCertificates } from '@/lib/api-handlers/orc-certificates';
import { wantsRefresh } from '@/lib/api-handlers/handicap-source-refresh';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?country=<code>` selects which country's active certificates to fetch;
// `?family=<ORC|NS|DH>` the certificate family (standard when absent).
// `?refresh=1` forces a refetch, bypassing the six-hour cache (#594). It takes
// `manage-workspace` and is throttled, because it reaches someone else's
// server.
export const GET = workspaceRoute(async (req, { workspace }) => {
  const params = new URL(req.url).searchParams;
  return getOrcCertificates(
    workspace,
    params.get('country') ?? '',
    params.get('family') ?? '',
    { refresh: wantsRefresh(params.get('refresh')) },
  );
});
