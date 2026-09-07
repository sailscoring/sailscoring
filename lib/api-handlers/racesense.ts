import 'server-only';

import { BadRequestError, UpstreamError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { fetchRaceSenseRegatta, RaceSensePlayerError } from '@/lib/racesense-player';
import { parseRaceSensePlayerRef, type RaceSenseRegatta } from '@/lib/racesense-regatta';

// Reading the player's data is part of the RaceSense import, so it sits
// behind the same operator-managed feature. Enforced here, not just by
// hiding the button: the route reaches a third party on the caller's behalf
// and could be hit directly.

/**
 * The regatta behind a player URL or a bare regatta id. Not cached: the
 * document is the live regatta, and the whole point of reading it is to
 * see the race that just finished.
 */
export async function getRaceSenseRegatta(
  workspace: WorkspaceContext,
  refParam: string,
): Promise<RaceSenseRegatta> {
  requireFeature(workspace, 'racesense-import');

  const ref = parseRaceSensePlayerRef(refParam);
  if (!ref) {
    throw new BadRequestError(
      'That isn’t a RaceSense player URL. It looks like https://player.vakaros.com/watch/<regatta id>/<division>.',
    );
  }

  try {
    return await fetchRaceSenseRegatta(ref.regattaId);
  } catch (err) {
    if (err instanceof RaceSensePlayerError) throw new UpstreamError(err.message, 'racesense-player');
    throw err;
  }
}
