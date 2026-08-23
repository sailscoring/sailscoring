import { getOrcCertificates } from '@/lib/api-handlers/orc-certificates';
import { workspaceRoute } from '../../_lib/handler';

export const dynamic = 'force-dynamic';

// `?country=<code>` selects which country's active certificates to fetch;
// `?family=<ORC|NS|DH>` the certificate family (standard when absent).
export const GET = workspaceRoute(async (req, { workspace }) => {
  const params = new URL(req.url).searchParams;
  return getOrcCertificates(
    workspace,
    params.get('country') ?? '',
    params.get('family') ?? '',
  );
});
