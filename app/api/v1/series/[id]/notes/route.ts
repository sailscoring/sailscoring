import { setSeriesNotes } from '@/lib/api-handlers/series';
import type { Series } from '@/lib/types';
import { workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

// PATCH /api/v1/series/:id/notes — the explanatory note carried by published
// pages, series-wide or per page. Its own endpoint so the note doesn't travel
// through the general PUT, which carries the whole row back from a publish
// dialog and refuses a finalised series — results a scorer is still entitled
// to publish, and to annotate when they do.
export const PATCH = workspaceRoute<Params, Series>(
  async (req, { workspace, params }) => {
    const body = await req.json();
    return setSeriesNotes(workspace, params.id, body);
  },
  { requires: 'score' },
);
