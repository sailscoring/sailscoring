import { z } from 'zod';

import type { Finish, ResultCode, PenaltyCode } from '@/lib/types';

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

export const redressMethodSchema = z.enum(['all_races', 'races_before', 'stated']);

export const finishSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  competitorId: uuidSchema.nullable(),
  unknownSailNumber: z.string().optional(),
  sortOrder: z.number().int().nullable(),
  finishTime: wallClockSchema.optional(),
  resultCode: resultCodeSchema.nullable(),
  startPresent: z.boolean().nullable(),
  penaltyCode: penaltyCodeSchema.nullable(),
  penaltyOverride: z.number().nullable(),
  redressMethod: redressMethodSchema.nullable(),
  redressExcludeRaces: z.array(z.number().int()).nullable(),
  redressIncludeRaces: z.array(z.number().int()).nullable(),
  redressIncludeAllLater: z.boolean(),
  redressPoints: z.number().nullable(),
  version: versionSchema,
});

export const finishInputSchema = finishSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `FinishRepository.saveMany`. */
export const finishesBulkInputSchema = z.object({
  finishes: z.array(finishInputSchema),
});

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
