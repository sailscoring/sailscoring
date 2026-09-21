import 'server-only';

import { unstable_cache } from 'next/cache';

import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { fetchIrcRatings, type IrcRatings } from '@/lib/irc-rating';
import { forceSourceRefresh } from './handicap-source-refresh';

// International IRC TCC import is an experimental, gated feature (#168 follow-up,
// #155). The fetch reaches an external site, so the gate is enforced
// server-side — not just by hiding the UI — since the route could be hit
// directly.

// The worldwide list is identical for every workspace and regenerated nightly,
// so cache the parsed result globally. Scorers seed handicaps once per series,
// so sub-day freshness isn't needed; a 6h window keeps load off the source
// while staying fresh enough.
const REVALIDATE_SECONDS = 6 * 60 * 60;

const getCachedRatings = unstable_cache(() => fetchIrcRatings(), ['irc-rating'], {
  revalidate: REVALIDATE_SECONDS,
  tags: ['irc-rating'],
});

export async function getIrcRatings(
  workspace: WorkspaceContext,
  opts?: { refresh?: boolean },
): Promise<IrcRatings> {
  requireFeature(workspace, 'irc-rating');
  // A scorer who knows the list was regenerated — a boat re-rated after a
  // protest — can say so rather than wait out the window (#594).
  if (opts?.refresh) {
    await forceSourceRefresh(workspace, {
      tag: 'irc-rating',
      key: 'irc-rating',
      label: 'the IRC rating list',
    });
  }
  return getCachedRatings();
}
