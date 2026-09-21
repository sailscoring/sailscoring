import 'server-only';

import { unstable_cache } from 'next/cache';

import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  fetchOrcCertificates,
  type OrcCertListing,
  type OrcFamily,
} from '@/lib/orc-certificate';
import { forceSourceRefresh } from './handicap-source-refresh';

// ORC scoring (and this certificate source) is gated behind the `orc`
// feature. The fetches reach data.orc.org, so the gate is enforced
// server-side — not just by hiding the UI — since the route could be hit
// directly.

// Certificates are issued and revised through the season, but a scorer seeds
// a series a handful of times; a 6h window keeps load off the ORC database
// while staying fresh enough. Cached per (country, family) — the listing is
// identical for every workspace.
const REVALIDATE_SECONDS = 6 * 60 * 60;

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
    () => fetchOrcCertificates(countryId, family as OrcFamily),
    ['orc-certs', countryId, family],
    { revalidate: REVALIDATE_SECONDS, tags: ['orc-certs', scopedTag] },
  )();
}
