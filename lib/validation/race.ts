import { z } from 'zod';

import type { Race } from '@/lib/types';

import { epochMsSchema, isoDateSchema, uuidSchema, versionSchema } from './common';

export const raceSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  raceNumber: z.number().int().positive(),
  date: isoDateSchema,
  createdAt: epochMsSchema,
  subSeriesId: uuidSchema.nullable().optional(),
  version: versionSchema,
});

export const raceInputSchema = raceSchema.extend({
  id: uuidSchema.optional(),
});

const _raceFromZod: Race = undefined as unknown as z.infer<typeof raceSchema>;
const _raceFromTs: z.infer<typeof raceSchema> = undefined as unknown as Race;
void _raceFromZod;
void _raceFromTs;
