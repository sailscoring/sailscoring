import 'server-only';

import { unstable_cache } from 'next/cache';

import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  fetchIrishSailingRatings,
  type IrishSailingRatings,
} from '@/lib/irish-sailing-ratings';

// Irish Sailing ratings import is an experimental, gated feature (#168, #155).
// The fetch reaches an external site, so the gate is enforced server-side —
// not just by hiding the UI — since the route could be hit directly.

// The national list is identical for every workspace and regenerated in bulk
// roughly daily, so cache the parsed result globally. Scorers seed handicaps
// once per series, so sub-day freshness isn't needed; a 6h window keeps load
// off sailing.ie while staying fresh enough.
const REVALIDATE_SECONDS = 6 * 60 * 60;

const getCachedRatings = unstable_cache(
  () => fetchIrishSailingRatings(),
  ['irish-sailing-ratings'],
  { revalidate: REVALIDATE_SECONDS, tags: ['irish-sailing-ratings'] },
);

export async function getIrishSailingRatings(
  workspace: WorkspaceContext,
): Promise<IrishSailingRatings> {
  requireFeature(workspace, 'echo');
  return getCachedRatings();
}
