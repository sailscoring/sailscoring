import { z } from 'zod';

import { DEFAULT_VOCABULARY } from '@/lib/split-fleets';
import type { SplitFleetConfig } from '@/lib/split-fleets';

import { uuidSchema } from './common';

const fleetSpecSchema = z.object({
  label: z.string().min(1),
  color: z.string(),
});

export const splitFleetConfigSchema = z.object({
  // One qualifying fleet is the unbanded championship: it never splits, so
  // there are no final fleets to size (see `split`).
  qualifyingFleets: z.array(fleetSpecSchema).min(1).max(4),
  finalFleets: z.array(fleetSpecSchema).max(4),
  split: z.union([z.object({ kind: z.literal('equal-blocks') }), z.object({ kind: z.literal('none') })]),
  discardThresholds: z.array(
    z.object({
      minRaces: z.number().int().positive(),
      discardCount: z.number().int().positive(),
    }),
  ),
  vocabulary: z
    .enum(['opening-medal', 'qualification-final'])
    .default(DEFAULT_VOCABULARY),
  medal: z.object({
    size: z.number().int().positive(),
    multiplier: z.union([z.literal(1), z.literal(2)]),
    carryTransform: z
      .object({ kind: z.literal('divide'), by: z.literal(2), rounding: z.literal('half-up') })
      .optional(),
    tieBreak: z.enum(['last-race', 'medal-race-then-a8']),
  }),
})
  // The two halves of the split answer have to agree. A championship that
  // bands its fleet needs at least two fleets to band into; one that never
  // bands must not carry any, or the editor would offer sizes for a stage
  // that is never sailed.
  .refine(
    (c) => (c.split.kind === 'none' ? c.finalFleets.length === 0 : c.finalFleets.length >= 2),
    {
      message:
        'a championship that splits needs at least two fleets to split into, and one that never splits needs none',
      path: ['finalFleets'],
    },
  );

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
  /** How those races' fleets finish (see `FinishSheets`); absent, as the
   *  championship's races so far have. */
  finishSheets: z.enum(['combined', 'per-fleet']).optional(),
  date: z.string().default(''),
  /** Non-round fleets the scorer agreed to remove as part of this ceremony
   *  (the "also remove these fleets" checkbox). Each must belong to the
   *  series, be owned by no round, and be referenced by no race start. */
  deleteFleetIds: z.array(uuidSchema).max(50).default([]),
});

/** Body for POST …/rounds/:roundId/races — add stage races to a round.
 *  Each stage race number becomes a start per fleet; alternatively `starts`
 *  names each fleet's own stage race number, for fleets that are out of step
 *  (Gold F2 + Silver F2 + Bronze F1). The medal stage always races apart;
 *  otherwise `finishSheets` says whether those starts share one race or take
 *  a race each, and absent, the championship's races so far decide. */
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
    finishSheets: z.enum(['combined', 'per-fleet']).optional(),
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
