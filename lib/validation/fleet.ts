import { z } from 'zod';

import type { Fleet } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

export const scoringSystemSchema = z.enum([
  'scratch',
  'irc',
  'py',
  'nhc',
  'echo',
]);

// Inline NHC profile (per-fleet override of the stock SWNHC2015 parameters).
// All seven numeric parameters are validated to the ranges the algorithm
// expects: blend rates strictly in (0, 1], SD thresholds strictly positive,
// minFin a positive integer. `name` is carried for forward-compat with the
// named-profile milestone but not surfaced in the UI yet.
export const nhcProfileSchema = z.object({
  name: z.string(),
  alphaP: z.number().gt(0).lte(1),
  alphaN: z.number().gt(0).lte(1),
  alphaPX: z.number().gt(0).lte(1),
  alphaNX: z.number().gt(0).lte(1),
  sdOver: z.number().gt(0),
  sdUnder: z.number().gt(0),
  minFin: z.number().int().gte(1),
});

export const fleetSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: z.string(),
  displayOrder: z.number().int(),
  scoringSystem: scoringSystemSchema,
  echoAlpha: z.number().optional(),
  nhcProfile: nhcProfileSchema.optional(),
  version: versionSchema,
});

export const fleetInputSchema = fleetSchema.extend({
  id: uuidSchema.optional(),
});

/** Bulk-write payload. Mirrors `FleetRepository.saveMany`. */
export const fleetsBulkInputSchema = z.object({
  fleets: z.array(fleetInputSchema),
});

export const ensureFleetInputSchema = z.object({
  name: z.string(),
  scoringSystem: scoringSystemSchema.optional(),
  echoAlpha: z.number().optional(),
  nhcProfile: nhcProfileSchema.optional(),
});

const _fleetFromZod: Fleet = undefined as unknown as z.infer<typeof fleetSchema>;
const _fleetFromTs: z.infer<typeof fleetSchema> = undefined as unknown as Fleet;
void _fleetFromZod;
void _fleetFromTs;
