import { z } from 'zod';

import type { RaceStart } from '@/lib/types';

import { uuidSchema, versionSchema, wallClockSchema } from './common';

export const raceStartSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  fleetIds: z.array(uuidSchema),
  // Optional: a membership-only start declares fleets with no gun time.
  startTime: wallClockSchema.optional(),
  // Split-fleet series: the stage race this start's fleets are sailing, and
  // the companion-race offset (see RaceStart in lib/types.ts).
  stage: z.enum(['qualifying', 'final', 'medal']).optional(),
  stageRaceNumber: z.number().int().positive().optional(),
  firstPlaceOffset: z.number().int().min(0).optional(),
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
