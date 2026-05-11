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

export const fleetSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: z.string(),
  displayOrder: z.number().int(),
  scoringSystem: scoringSystemSchema,
  echoAlpha: z.number().optional(),
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
});

const _fleetFromZod: Fleet = undefined as unknown as z.infer<typeof fleetSchema>;
const _fleetFromTs: z.infer<typeof fleetSchema> = undefined as unknown as Fleet;
void _fleetFromZod;
void _fleetFromTs;
