import { z } from 'zod';

import type { Race } from '@/lib/types';

import { epochMsSchema, isoDateSchema, uuidSchema, versionSchema, wallClockSchema } from './common';
import { raceStartInputSchema } from './race-start';

export const raceSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  raceNumber: z.number().int().positive(),
  name: z.string().nullable().default(null),
  date: isoDateSchema,
  // Manual last-finisher time ("HH:MM:SS") for races with untimed finishes.
  lastFinisherTime: wallClockSchema.optional(),
  // Split-fleet series (PROTOTYPE — see lib/split-fleets.ts).
  stage: z.enum(['qualifying', 'final', 'medal']).optional(),
  stageRaceNumber: z.number().int().positive().optional(),
  createdAt: epochMsSchema,
  version: versionSchema,
});

export const raceInputSchema = raceSchema.extend({
  id: uuidSchema.optional(),
});

/** Body for POST /api/v1/series/:id/races/reorder — the full set of race ids
 *  in their new order. The races are renumbered 1..n to match. */
export const racesReorderSchema = z.object({
  orderedIds: z.array(uuidSchema),
});

/**
 * Body for POST /api/v1/series/:id/races — bulk-create appended races (the
 * "Add multiple races" generator). `raceNumber` on each race is a client hint
 * only; the server assigns authoritative sequential numbers. `starts` carries
 * the generated start-sequence rows for handicap series, keyed to the races'
 * ids. At least one race is required.
 */
export const racesGenerateSchema = z.object({
  races: z.array(raceInputSchema).min(1),
  starts: z.array(raceStartInputSchema).default([]),
});

const _raceFromZod: Race = undefined as unknown as z.infer<typeof raceSchema>;
const _raceFromTs: z.infer<typeof raceSchema> = undefined as unknown as Race;
void _raceFromZod;
void _raceFromTs;
