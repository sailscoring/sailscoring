import 'server-only';

import { unstable_cache } from 'next/cache';

import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  fetchVprsClubIndex,
  fetchVprsRatings,
  type VprsClub,
  type VprsRatings,
} from '@/lib/vprs-rating';

// VPRS scoring (and this rating source) is gated behind the `vprs` feature
// (#175, #155). The fetches reach an external site, so the gate is enforced
// server-side — not just by hiding the UI — since these routes could be hit
// directly.

// VPRS ratings change through the season (certificates are issued week to
// week), so unlike the once-a-year RYA PY list this is refreshed periodically.
// A 6h window keeps load off vprs.org while staying fresh enough — a scorer
// seeds handicaps a handful of times per series.
const REVALIDATE_SECONDS = 6 * 60 * 60;

// The club *index* is small and identical for every workspace; cache it
// globally. Individual club listings are only fetched (and cached) when a
// scorer actually picks that club — see getVprsClubRatings.
const getCachedClubs = unstable_cache(() => fetchVprsClubIndex(), ['vprs-clubs'], {
  revalidate: REVALIDATE_SECONDS,
  tags: ['vprs-rating'],
});

export async function getVprsClubs(
  workspace: WorkspaceContext,
): Promise<{ clubs: VprsClub[] }> {
  requireFeature(workspace, 'vprs');
  return { clubs: await getCachedClubs() };
}

export async function getVprsClubRatings(
  workspace: WorkspaceContext,
  clubId: string,
): Promise<VprsRatings> {
  requireFeature(workspace, 'vprs');
  if (!clubId) throw new BadRequestError('a VPRS club id is required');

  // Resolve the id against the cached index rather than trusting a caller-
  // supplied URL — we only ever fetch listings the index actually advertises
  // (and it gives us the canonical, absolute URL to fetch).
  const club = (await getCachedClubs()).find((c) => c.id === clubId);
  if (!club) throw new BadRequestError(`unknown VPRS club: ${clubId}`);

  // Cache per club, keyed by id, so the first scorer to pick a club warms it
  // and the rest reuse it within the window.
  return unstable_cache(() => fetchVprsRatings(club.url), ['vprs-rating', clubId], {
    revalidate: REVALIDATE_SECONDS,
    tags: ['vprs-rating'],
  })();
}
