import { z } from 'zod';

import { isoDateSchema } from './common';

/**
 * Body schema for `POST /api/v1/series/{id}/follow-on`.
 *
 * Both fields are optional: a missing/blank `name` falls back to the
 * server-side `suggestFollowOnName` proposal, and a missing `startDate`
 * leaves the new series undated (the scorer sets it later in Settings).
 */
export const seriesFollowOnInputSchema = z.object({
  name: z.string().optional(),
  startDate: isoDateSchema.optional(),
});

export type SeriesFollowOnInput = z.infer<typeof seriesFollowOnInputSchema>;
