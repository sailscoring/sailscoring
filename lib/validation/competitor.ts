import { z } from 'zod';

import type { Competitor } from '@/lib/types';

import { epochMsSchema, uuidSchema, versionSchema } from './common';

export const genderSchema = z.enum(['M', 'F', '']);

export const competitorSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  fleetIds: z.array(uuidSchema),
  sailNumber: z.string(),
  bowNumber: z.string().optional(),
  boatName: z.string().optional(),
  boatClass: z.string().optional(),
  names: z.array(z.string()).min(1),
  owners: z.array(z.string()).optional(),
  helms: z.array(z.string()).optional(),
  crewNames: z.array(z.string()).optional(),
  club: z.string(),
  nationality: z.string().regex(/^[A-Z]{3}$/, 'must be a 3-letter uppercase code').optional(),
  gender: genderSchema,
  age: z.number().int().nullable(),
  subdivisions: z.record(z.string(), z.string()).optional(),
  createdAt: epochMsSchema,
  ircTcc: z.number().optional(),
  vprsTcc: z.number().optional(),
  pyNumber: z.number().optional(),
  nhcStartingTcf: z.number().optional(),
  echoStartingTcf: z.number().optional(),
  version: versionSchema,
});

export const competitorInputSchema = competitorSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `CompetitorRepository.saveMany`. */
export const competitorsBulkInputSchema = z.object({
  competitors: z.array(competitorInputSchema),
});

/**
 * Selective batch-delete payload. Mirrors `CompetitorRepository.deleteMany`;
 * ids outside the series are ignored rather than rejected, so a stale
 * selection can't block the rest of the batch.
 */
export const competitorsDeleteInputSchema = z.object({
  ids: z.array(uuidSchema).min(1),
});

/**
 * Bulk field-set payload: write one descriptive field to one value across a
 * set of competitors. `set` carries exactly one member — the Set field dialog
 * edits a single field at a time, and one field per request keeps the
 * activity summary meaningful. An empty-string value clears the field.
 * As with the batch delete, ids outside the series are ignored.
 *
 * `fleet` is the odd one out: membership is a set, so instead of a value it
 * carries an add/remove op against one fleet of the series.
 */
export const competitorsBulkSetSchema = z.object({
  ids: z.array(uuidSchema).min(1),
  set: z
    .object({
      club: z.string().optional(),
      boatClass: z.string().optional(),
      nationality: z
        .string()
        .regex(/^$|^[A-Z]{3}$/, 'must be a 3-letter uppercase code')
        .optional(),
      gender: genderSchema.optional(),
      subdivision: z
        .object({ axisId: z.string().min(1), value: z.string() })
        .optional(),
      fleet: z
        .object({ fleetId: uuidSchema, op: z.enum(['add', 'remove']) })
        .optional(),
    })
    .refine(
      (s) => Object.values(s).filter((v) => v !== undefined).length === 1,
      'set must contain exactly one field',
    ),
});

/**
 * Targeted bulk update for the Update Handicaps dialog (#144). Each row
 * carries an `expectedVersion` for optimistic concurrency; the four
 * handicap fields are independently optional, and only the listed fields
 * are written. Non-handicap fields are untouched.
 *
 * `null` is not accepted on the wire — the dialog only writes when the
 * source has a value, so we never need to clear a handicap to null via
 * this path.
 */
export const handicapUpdateSchema = z.object({
  competitorId: uuidSchema,
  // Required — bulk-update is CAS-only. A row whose `version` cannot be
  // produced (theoretically a freshly-inserted competitor never read back
  // by the client) has nothing to update on this path either.
  expectedVersion: z.number().int().positive(),
  ircTcc: z.number().optional(),
  vprsTcc: z.number().optional(),
  pyNumber: z.number().optional(),
  nhcStartingTcf: z.number().optional(),
  echoStartingTcf: z.number().optional(),
  // Canonical class name written by the RYA PY source alongside the PY number.
  boatClass: z.string().optional(),
  // Fleets to add this competitor to (union with current membership) — the
  // "add a newly-rated boat to the handicap fleet" path (#170). The handler
  // verifies each id is a fleet of the series.
  addFleetIds: z.array(uuidSchema).optional(),
});

export const handicapBulkUpdateSchema = z.object({
  updates: z.array(handicapUpdateSchema).min(1),
  /** When true, a boat whose static rating (ircTcc/pyNumber) changes keeps its
   *  already-scored races on the *old* value via per-race rating overrides
   *  (mid-series rating change). Default false re-scores every race on the new
   *  value (a correction). */
  freezeScoredRaces: z.boolean().optional(),
});

const _competitorFromZod: Competitor = undefined as unknown as z.infer<typeof competitorSchema>;
const _competitorFromTs: z.infer<typeof competitorSchema> = undefined as unknown as Competitor;
void _competitorFromZod;
void _competitorFromTs;
