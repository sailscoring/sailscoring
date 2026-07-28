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
  carry: z.enum(['points', 'net-plus-net', 'rank-seed']),
  split: z.union([
    z.object({ kind: z.literal('equal-blocks') }),
    z.object({ kind: z.literal('fixed-top'), topSize: z.number().int().positive() }),
  ]),
  codeBasis: z.object({
    qualifying: z.enum(['largest-fleet', 'fixed']),
    fixedPoints: z.number().int().positive().optional(),
    final: z.enum(['own-fleet', 'largest-qualifying']),
  }),
  equalization: z.enum(['abandon-extra-races', 'exclude-extra-scores']),
  discardThresholds: z.array(
    z.object({
      minRaces: z.number().int().positive(),
      discardCount: z.number().int().positive(),
    }),
  ),
  maxFinalDiscards: z.number().int().min(0),
  protectLoneFinalRace: z.boolean(),
  reassignmentTieOrder: z.enum(['a8-then-entry-order', 'fleet-order']),
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
  /** Hand-moved boats within `assignments` (editable preview): competitorId
   *  set. Stored on the round as computed-vs-override provenance. */
  overrideCompetitorIds: z.array(uuidSchema).default([]),
  stageRaceNumbers: z.array(z.number().int().positive()).default([]),
  date: z.string().default(''),
});

/** Body for POST …/rounds/:roundId/races — add stage races to a round.
 *  Each stage race number becomes one race (a start sequence) covering the
 *  given fleets. Alternatively `starts` names each fleet's own stage race
 *  number and creates a single combined race — the out-of-step case (Gold
 *  F2 + Silver F2 + Bronze F1 in one sequence). */
export const splitStageRacesSchema = z
  .object({
    stageRaceNumbers: z.array(z.number().int().positive()).default([]),
    /** Restrict creation to these of the round's fleets (default: all). */
    fleetIds: z.array(uuidSchema).optional(),
    /** One combined race with per-fleet stage race numbers. */
    starts: z
      .array(
        z.object({
          fleetId: uuidSchema,
          stageRaceNumber: z.number().int().positive(),
        }),
      )
      .min(1)
      .optional(),
    date: z.string().default(''),
  })
  .refine((v) => (v.starts?.length ?? 0) > 0 || v.stageRaceNumbers.length > 0, {
    message: 'stageRaceNumbers or starts is required',
  });

const _configFromZod: SplitFleetConfig = undefined as unknown as z.infer<
  typeof splitFleetConfigSchema
>;
void _configFromZod;

/** Body for POST …/rounds/:roundId/overrides — one manual placement (late
 *  entry, RC/jury move, redress promotion). */
export const splitOverrideSchema = z.object({
  competitorId: uuidSchema,
  toFleetId: uuidSchema,
});
