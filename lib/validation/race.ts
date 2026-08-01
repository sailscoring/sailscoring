import { z } from 'zod';

import type { Race } from '@/lib/types';

import { COMPASS_POINTS, RACE_NOTES_MAX_LENGTH, WIND_SPEED_MAX } from '@/lib/race-conditions';
import type { CompassPoint } from '@/lib/types';

import {
  OFFICIALS_MAX,
  epochMsSchema,
  isoDateSchema,
  raceOfficialSchema,
  uuidSchema,
  versionSchema,
  wallClockSchema,
} from './common';
import { raceStartInputSchema } from './race-start';

/** Conditions a race was sailed in (#338). Every field optional — the block is
 *  built up as the recording team has the numbers, not all at once. */
export const raceConditionsSchema = z.object({
  windSpeedMin: z.number().min(0).max(WIND_SPEED_MAX).optional(),
  windSpeedMax: z.number().min(0).max(WIND_SPEED_MAX).optional(),
  windDirection: z.enum(COMPASS_POINTS as readonly [CompassPoint, ...CompassPoint[]]).optional(),
  notes: z.string().max(RACE_NOTES_MAX_LENGTH).optional(),
});

export const raceSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  raceNumber: z.number().int().positive(),
  name: z.string().nullable().default(null),
  date: isoDateSchema,
  // Manual last-finisher time ("HH:MM:SS") for races with untimed finishes.
  lastFinisherTime: wallClockSchema.optional(),
  // Per-race scoring options. The policy needs no cross-field check — the
  // enum makes "must count" and "discard first" mutually exclusive by
  // construction. The multiplier is bounded generously: Sailwave allows any
  // non-integer value, so the bounds only exclude the nonsensical.
  discardPolicy: z.enum(['normal', 'mustCount', 'discardFirst']).optional(),
  pointsMultiplier: z.number().positive().max(100).optional(),
  // What the race was sailed in, and who ran it. Wind speeds are bounded but
  // not ordered here — a minimum above the maximum is caught in the dialog,
  // where the scorer can see which of the two they meant; rejecting it at the
  // boundary would only turn a typo into a 400.
  conditions: raceConditionsSchema.optional(),
  officials: z.array(raceOfficialSchema).max(OFFICIALS_MAX).optional(),
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
