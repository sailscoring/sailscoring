import { z } from 'zod';

import type { RaceRatingOverride } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

export const ratingFieldSchema = z.enum(['ircTcc', 'pyNumber', 'vprsTcc']);

export const raceRatingOverrideSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  competitorId: uuidSchema,
  field: ratingFieldSchema,
  value: z.number(),
  version: versionSchema,
});

export const raceRatingOverrideInputSchema = raceRatingOverrideSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `RaceRatingOverrideRepository.saveMany`. */
export const raceRatingOverridesBulkInputSchema = z.object({
  overrides: z.array(raceRatingOverrideInputSchema),
});

const _fromZod: RaceRatingOverride = undefined as unknown as z.infer<typeof raceRatingOverrideSchema>;
const _fromTs: z.infer<typeof raceRatingOverrideSchema> = undefined as unknown as RaceRatingOverride;
void _fromZod;
void _fromTs;
