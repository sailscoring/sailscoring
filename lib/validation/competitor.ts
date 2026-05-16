import { z } from 'zod';

import type { Competitor } from '@/lib/types';

import { epochMsSchema, uuidSchema, versionSchema } from './common';

export const genderSchema = z.enum(['M', 'F', '']);

export const competitorSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  fleetIds: z.array(uuidSchema),
  sailNumber: z.string(),
  boatName: z.string().optional(),
  boatClass: z.string().optional(),
  name: z.string(),
  owner: z.string().optional(),
  helm: z.string().optional(),
  crewName: z.string().optional(),
  club: z.string(),
  gender: genderSchema,
  age: z.number().int().nullable(),
  createdAt: epochMsSchema,
  ircTcc: z.number().optional(),
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
  pyNumber: z.number().optional(),
  nhcStartingTcf: z.number().optional(),
  echoStartingTcf: z.number().optional(),
});

export const handicapBulkUpdateSchema = z.object({
  updates: z.array(handicapUpdateSchema).min(1),
});

const _competitorFromZod: Competitor = undefined as unknown as z.infer<typeof competitorSchema>;
const _competitorFromTs: z.infer<typeof competitorSchema> = undefined as unknown as Competitor;
void _competitorFromZod;
void _competitorFromTs;
