import 'server-only';

import { unstable_cache } from 'next/cache';

import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { fetchYtcRatings, type YtcRatings } from '@/lib/ytc-rating';
import { forceSourceRefresh } from './handicap-source-refresh';

// YTC is a gated feature. The fetch reaches an external site, so the gate is
// enforced server-side — not just by hiding the UI — since the route could be
// hit directly.

// The listing is identical for every workspace, so the parsed result is cached
// globally. Scorers seed handicaps a handful of times per series, so sub-day
// freshness isn't needed; a 6h window keeps load off the source.
const REVALIDATE_SECONDS = 6 * 60 * 60;

const getCachedRatings = unstable_cache(() => fetchYtcRatings(), ['ytc-rating'], {
  revalidate: REVALIDATE_SECONDS,
  tags: ['ytc-rating'],
});

export async function getYtcRatings(
  workspace: WorkspaceContext,
  opts?: { refresh?: boolean },
): Promise<YtcRatings> {
  requireFeature(workspace, 'ytc');
  // A scorer who knows a certificate was reissued this morning can say so
  // rather than wait out the window.
  if (opts?.refresh) {
    await forceSourceRefresh(workspace, {
      tag: 'ytc-rating',
      key: 'ytc-rating',
      label: 'the YTC listing',
    });
  }
  return getCachedRatings();
}
