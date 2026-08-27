import { z } from 'zod';

import type { Finish, FinishTrackData, ResultCode, PenaltyCode } from '@/lib/types';

import { uuidSchema, versionSchema, wallClockSchema } from './common';

export const resultCodeSchema = z.enum([
  'DNC',
  'DNS',
  'OCS',
  'NSC',
  'DNF',
  'RET',
  'DSQ',
  'DNE',
  'UFD',
  'BFD',
  'RDG',
]);

export const penaltyCodeSchema = z.enum(['ZFP', 'SCP', 'DPI']);

export const redressMethodSchema = z.enum(['all_races', 'all_races_excl_dnc', 'races_before', 'stated']);

/** RaceSense track data riding on a finish row. Every field optional — the
 *  export omits each race by race — and finite, so a corrupt cell can't
 *  smuggle NaN/Infinity into stored rows. */
export const finishTrackDataSchema = z.object({
  dtlAtStartM: z.number().finite().optional(),
  distanceKm: z.number().finite().optional(),
  maxSpeedKts: z.number().finite().optional(),
});

export const finishSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  competitorId: uuidSchema.nullable(),
  unknownSailNumber: z.string().optional(),
  matchedOn: z.enum(['bow', 'alternative']).optional(),
  enteredSailNumber: z.string().optional(),
  sortOrder: z.number().int().nullable(),
  tiedWithPrevious: z.boolean(),
  finishTime: wallClockSchema.optional(),
  // Seconds, fractional part allowed. Non-negative: an elapsed time is a
  // duration, and a negative one is a transcription error, not a boat that
  // finished before the gun.
  elapsedSecs: z.number().finite().nonnegative().optional(),
  trackData: finishTrackDataSchema.optional(),
  resultCode: resultCodeSchema.nullable(),
  startPresent: z.boolean().nullable(),
  penaltyCode: penaltyCodeSchema.nullable(),
  penaltyOverride: z.number().nullable(),
  penaltyOverrideByFleet: z.record(z.string(), z.number()).optional(),
  // Free text, capped so a published race cell stays a cell. DPI only; the
  // engine never reads it.
  penaltyLabel: z.string().max(24).optional(),
  redressMethod: redressMethodSchema.nullable(),
  redressExcludeRaceIds: z.array(uuidSchema).nullable(),
  redressIncludeRaceIds: z.array(uuidSchema).nullable(),
  redressIncludeAllLater: z.boolean(),
  redressPoints: z.number().nullable(),
  redressPointsByFleet: z.record(z.string(), z.number()).optional(),
  version: versionSchema,
});

export const finishInputSchema = finishSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `FinishRepository.saveMany`. */
export const finishesBulkInputSchema = z.object({
  finishes: z.array(finishInputSchema),
});

const _trackDataFromZod: FinishTrackData = undefined as unknown as z.infer<typeof finishTrackDataSchema>;
const _trackDataFromTs: z.infer<typeof finishTrackDataSchema> = undefined as unknown as FinishTrackData;
void _trackDataFromZod;
void _trackDataFromTs;

const _finishFromZod: Finish = undefined as unknown as z.infer<typeof finishSchema>;
const _finishFromTs: z.infer<typeof finishSchema> = undefined as unknown as Finish;
void _finishFromZod;
void _finishFromTs;

const _resultCodeFromZod: ResultCode = undefined as unknown as z.infer<typeof resultCodeSchema>;
const _resultCodeFromTs: z.infer<typeof resultCodeSchema> = undefined as unknown as ResultCode;
void _resultCodeFromZod;
void _resultCodeFromTs;

const _penaltyCodeFromZod: PenaltyCode = undefined as unknown as z.infer<typeof penaltyCodeSchema>;
const _penaltyCodeFromTs: z.infer<typeof penaltyCodeSchema> = undefined as unknown as PenaltyCode;
void _penaltyCodeFromZod;
void _penaltyCodeFromTs;
