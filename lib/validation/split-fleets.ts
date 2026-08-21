import { z } from 'zod';

import { DEFAULT_VOCABULARY } from '@/lib/split-fleets';
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
  // Defaulted: configs written before per-fleet races existed mean 'combined'.
  finishSheets: z.enum(['combined', 'per-fleet']).default('combined'),
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
  vocabulary: z
    .enum(['opening-medal', 'qualification-final'])
    .default(DEFAULT_VOCABULARY),
  // Engine-only escape hatch (see `Vocabulary`), and the shape a v33 file's
  // authored wording upgrades into. Passed through rather than rejected so a
  // config written by a build that knows a vocabulary this one doesn't still
  // lands with its words intact.
  vocabularyOverride: z
    .object({
      seriesName: z.string().min(1),
      stages: z.record(
        z.enum(['qualifying', 'final', 'medal']),
        z.object({
          name: z.string().min(1),
          raceNoun: z.string().min(1),
          fleetNoun: z.string().min(1),
        }),
      ),
      prefixes: z.object({
        qualifying: z.string().min(1),
        final: z.string().min(1),
        medal: z.string().min(1),
      }),
      continuousOpeningNumbers: z.boolean(),
    })
    .optional(),
  /** v33's authored wording, accepted on read and folded into `vocabulary` by
   *  `normalizeSplitFleetConfig`. Never written. */
  stageNaming: z
    .object({
      labels: z.object({
        qualifying: z.string().min(1),
        final: z.string().min(1),
        medal: z.string().min(1),
      }),
      prefixes: z.object({
        qualifying: z.string().min(1),
        final: z.string().min(1),
        medal: z.string().min(1),
      }),
      continuousOpeningNumbers: z.boolean(),
    })
    .optional(),
  medal: z
    .object({
      size: z.number().int().positive(),
      raceCount: z.number().int().positive(),
      multiplier: z.number().positive(),
      carryTransform: z
        .object({
          kind: z.literal('divide'),
          by: z.number().positive(),
          rounding: z.enum(['half-up', 'truncate']),
        })
        .optional(),
      tieBreak: z.literal('stage-rank').optional(),
      companionRace: z.enum(['scored-below', 'none']).default('scored-below'),
    })
    .optional(),
});

/** Body for PUT …/split-fleets/state — the whole split-fleet block of a
 *  `.sailscoring` file, replayed wholesale by an in-browser file open/update.
 *  A null config with no rounds clears the series' split-fleet state, which is
 *  what a file carrying no block replays as.
 *
 *  Deliberately looser than `splitRoundCommitSchema`: this is an authoritative
 *  replay of rows this app wrote, not a ceremony. `method` stays a free string
 *  (the file format and the column both hold text) so a file written by a
 *  build that knows a method this one doesn't still lands. */
export const splitFleetStateSchema = z.object({
  config: splitFleetConfigSchema.nullable(),
  rounds: z.array(
    z.object({
      id: uuidSchema,
      stage: z.enum(['qualifying', 'final', 'medal']),
      fromStageRace: z.number().int().min(0),
      fleetIds: z.array(uuidSchema),
      method: z.string().min(1),
      basis: z
        .object({ throughStageRace: z.number().int().min(0), capturedAt: z.number() })
        .nullish()
        .transform((v) => v ?? null),
      overrides: z.record(uuidSchema, uuidSchema).optional(),
      createdAt: z.number().int(),
    }),
  ),
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

/** Body for POST …/split-fleets/abandon-start — abandon one fleet's physical
 *  race: remove the fleet from the race's start sequence and void its rows
 *  on the sheet. The rest of the sequence stands. */
export const splitAbandonStartSchema = z.object({
  raceId: uuidSchema,
  fleetId: uuidSchema,
});
