import { z } from 'zod';

import type { SubSeries } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

const subSeriesNameSchema = z.string().trim().min(1).max(80);

export const subSeriesSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: subSeriesNameSchema,
  displayOrder: z.number().int(),
  raceIds: z.array(uuidSchema),
  startingHandicapSource: z.enum(['base', 'continue']).optional(),
  continueFromSubSeriesId: uuidSchema.nullish(),
  version: versionSchema,
});

/**
 * POST /api/v1/series/:id/sub-series — create a sub-series (a named selection
 * of races). `raceIds` is the initial selection (may be empty and edited later
 * via PUT). The carry source is optional.
 */
export const subSeriesCreateInputSchema = z.object({
  name: subSeriesNameSchema,
  raceIds: z.array(uuidSchema).optional(),
  startingHandicapSource: z.enum(['base', 'continue']).optional(),
  continueFromSubSeriesId: uuidSchema.nullish(),
});

export const subSeriesInputSchema = subSeriesSchema.extend({
  id: uuidSchema.optional(),
});

const _subSeriesFromZod: SubSeries = undefined as unknown as z.infer<typeof subSeriesSchema>;
const _subSeriesFromTs: z.infer<typeof subSeriesSchema> = undefined as unknown as SubSeries;
void _subSeriesFromZod;
void _subSeriesFromTs;
