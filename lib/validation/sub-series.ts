import { z } from 'zod';

import type { SubSeries } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

const subSeriesNameSchema = z.string().trim().min(1).max(80);

export const subSeriesSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: subSeriesNameSchema,
  displayOrder: z.number().int(),
  startingHandicapSource: z.enum(['base', 'continue']).optional(),
  continueFromSubSeriesId: uuidSchema.nullish(),
  version: versionSchema,
});

/**
 * POST /api/v1/series/:id/sub-series — the "start a new sub-series here"
 * gesture. The new block runs from `firstRaceId` to the end of the block
 * that contained it (or of the whole race list when the series has no
 * sub-series yet). Omitting `firstRaceId` groups every race into the new
 * block when none exist, or appends an empty block when some do.
 * `initialName` names the block created for the races before `firstRaceId`
 * on the first split — required exactly then.
 */
export const subSeriesCreateInputSchema = z.object({
  name: subSeriesNameSchema,
  firstRaceId: uuidSchema.optional(),
  initialName: subSeriesNameSchema.optional(),
});

export const subSeriesInputSchema = subSeriesSchema.extend({
  id: uuidSchema.optional(),
});

const _subSeriesFromZod: SubSeries = undefined as unknown as z.infer<typeof subSeriesSchema>;
const _subSeriesFromTs: z.infer<typeof subSeriesSchema> = undefined as unknown as SubSeries;
void _subSeriesFromZod;
void _subSeriesFromTs;
