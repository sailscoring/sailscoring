import { z } from 'zod';

import type { SubSeries } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

const subSeriesNameSchema = z.string().trim().min(1).max(80);

const raceFleetExclusionSchema = z.object({
  raceId: uuidSchema,
  fleetId: uuidSchema,
});

export const subSeriesSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: subSeriesNameSchema,
  displayOrder: z.number().int(),
  raceIds: z.array(uuidSchema),
  // Absent = all the series' fleets; a list scopes the sub-series to a subset.
  fleetIds: z.array(uuidSchema).optional(),
  raceFleetExclusions: z.array(raceFleetExclusionSchema).optional(),
  startingHandicapSource: z.enum(['base', 'continue']).optional(),
  continueFromSubSeriesId: uuidSchema.nullish(),
  version: versionSchema,
});

/**
 * POST /api/v1/series/:id/sub-series — create a sub-series (a named selection
 * of races). `raceIds` is the initial selection (may be empty and edited later
 * via PUT). Fleet scoping, exclusions, and the carry source are all optional.
 */
export const subSeriesCreateInputSchema = z.object({
  name: subSeriesNameSchema,
  raceIds: z.array(uuidSchema).optional(),
  fleetIds: z.array(uuidSchema).optional(),
  raceFleetExclusions: z.array(raceFleetExclusionSchema).optional(),
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
