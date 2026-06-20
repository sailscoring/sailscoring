import { z } from 'zod';

import type { Race } from '@/lib/types';

import { epochMsSchema, isoDateSchema, uuidSchema, versionSchema } from './common';

export const raceSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  raceNumber: z.number().int().positive(),
  name: z.string().nullable().default(null),
  date: isoDateSchema,
  createdAt: epochMsSchema,
  version: versionSchema,
});

export const raceInputSchema = raceSchema.extend({
  id: uuidSchema.optional(),
});

/** Body for POST /api/v1/series/:id/races/reorder — the full set of race ids
 *  in their new order. The races are renumbered 1..n to match. */
export const racesReorderSchema = z.object({
  orderedIds: z.array(uuidSchema),
});

const _raceFromZod: Race = undefined as unknown as z.infer<typeof raceSchema>;
const _raceFromTs: z.infer<typeof raceSchema> = undefined as unknown as Race;
void _raceFromZod;
void _raceFromTs;
