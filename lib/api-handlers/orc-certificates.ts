import 'server-only';

import { unstable_cache } from 'next/cache';

import { BadRequestError, UpstreamError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  fetchOrcCertificates,
  OrcSourceError,
  type OrcCertListing,
  type OrcFamily,
} from '@/lib/orc-certificate';
import { forceSourceRefresh } from './handicap-source-refresh';

// ORC scoring (and this certificate source) is gated behind the `orc`
// feature. The fetches reach the ORC API on Sail Scoring's key, so the gate
// is enforced server-side — not just by hiding the UI — since the route could
// be hit directly.

// Certificates are issued and revised through the season, but a scorer seeds
// a series a handful of times. ORC asks API users to cache and says once a
// day is plenty; a certificate issued this morning is what Refresh from
// source is for. Cached per (country, family) — the listing is identical for
// every workspace.
const REVALIDATE_SECONDS = 24 * 60 * 60;

const FAMILIES: ReadonlySet<string> = new Set(['ORC', 'NS', 'DH']);

export async function getOrcCertificates(
  workspace: WorkspaceContext,
  countryParam: string,
  familyParam: string,
  opts?: { refresh?: boolean },
): Promise<OrcCertListing> {
  requireFeature(workspace, 'orc');

  const countryId = countryParam.trim().toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(countryId)) {
    throw new BadRequestError('a 2–3 letter country code is required');
  }
  const family = (familyParam.trim() || 'ORC').toUpperCase();
  if (!FAMILIES.has(family)) {
    throw new BadRequestError(`unknown ORC certificate family: ${familyParam}`);
  }

  // Issued to Sail Scoring on request by ORC (Sailor Services → Developers).
  const apiKey = process.env.ORC_API_KEY;
  if (!apiKey) {
    throw new UpstreamError(
      'ORC certificates aren’t available on this server: it has no ORC API key configured.',
      'orc',
    );
  }

  // Tagged per country and family as well as with the shared tag (#594):
  // refreshing Irish certificates should not throw away every other
  // country's, which a scorer may have waited on and will not think to
  // re-fetch.
  const scopedTag = `orc-certs:${countryId}:${family}`;
  if (opts?.refresh) {
    await forceSourceRefresh(workspace, {
      tag: scopedTag,
      key: scopedTag,
      label: `ORC ${family} certificates for ${countryId}`,
    });
  }

  return unstable_cache(
    async () => {
      try {
        return await fetchOrcCertificates(apiKey, countryId, family as OrcFamily);
      } catch (err) {
        if (err instanceof OrcSourceError) throw new UpstreamError(err.message, 'orc');
        throw err;
      }
    },
    ['orc-certs', countryId, family],
    { revalidate: REVALIDATE_SECONDS, tags: ['orc-certs', scopedTag] },
  )();
}
