import { z } from 'zod';

import type { SplitFleetConfig } from '@/lib/split-fleets';

import { uuidSchema } from './common';

const fleetSpecSchema = z.object({
  label: z.string().min(1),
  color: z.string(),
});

export const splitFleetConfigSchema = z.object({
  qualifyingFleets: z.array(fleetSpecSchema).min(2).max(4),
  finalFleets: z.array(fleetSpecSchema).min(2).max(4),
  plannedDays: z.array(
    z.object({ label: z.string(), races: z.number().int().min(0) }),
  ),
  discardThresholds: z.array(
    z.object({
      minRaces: z.number().int().positive(),
      discardCount: z.number().int().positive(),
    }),
  ),
  maxFinalDiscards: z.number().int().min(0),
  medal: z
    .object({
      size: z.number().int().positive(),
      raceCount: z.number().int().positive(),
      multiplier: z.number().positive(),
    })
    .optional(),
});

/** Body for POST /api/v1/series/:id/split-fleets/rounds — one assignment
 *  ceremony commit. The server creates the fleets, memberships, and the
 *  physical races for `stageRaceNumbers`, and stores the round. */
export const splitRoundCommitSchema = z.object({
  stage: z.enum(['qualifying', 'final', 'medal']),
  fromStageRace: z.number().int().positive(),
  method: z.enum(['seeded', 'rank-pattern', 'split', 'medal-select', 'manual']),
  basis: z
    .object({ throughStageRace: z.number().int().min(0), capturedAt: z.number() })
    .nullable()
    .default(null),
  /** Fleets to create, in SI/tier order. */
  fleets: z.array(fleetSpecSchema).min(1),
  /** competitorId → index into `fleets`. */
  assignments: z.record(uuidSchema, z.number().int().min(0)),
  stageRaceNumbers: z.array(z.number().int().positive()).default([]),
  date: z.string().default(''),
});

/** Body for POST …/rounds/:roundId/races — add stage races to a round. */
export const splitStageRacesSchema = z.object({
  stageRaceNumbers: z.array(z.number().int().positive()).min(1),
  /** Restrict creation to these of the round's fleets (default: all). */
  fleetIds: z.array(uuidSchema).optional(),
  date: z.string().default(''),
});

const _configFromZod: SplitFleetConfig = undefined as unknown as z.infer<
  typeof splitFleetConfigSchema
>;
void _configFromZod;
