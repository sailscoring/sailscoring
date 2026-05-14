import { z } from 'zod';

import type { RaceStart } from '@/lib/types';

import { uuidSchema, versionSchema, wallClockSchema } from './common';

export const raceStartSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  fleetIds: z.array(uuidSchema),
  startTime: wallClockSchema,
  version: versionSchema,
});

export const raceStartInputSchema = raceStartSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `RaceStartRepository.saveMany`. */
export const raceStartsBulkInputSchema = z.object({
  starts: z.array(raceStartInputSchema),
});

const _raceStartFromZod: RaceStart = undefined as unknown as z.infer<typeof raceStartSchema>;
const _raceStartFromTs: z.infer<typeof raceStartSchema> = undefined as unknown as RaceStart;
void _raceStartFromZod;
void _raceStartFromTs;
