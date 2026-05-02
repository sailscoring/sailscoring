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

const _competitorFromZod: Competitor = undefined as unknown as z.infer<typeof competitorSchema>;
const _competitorFromTs: z.infer<typeof competitorSchema> = undefined as unknown as Competitor;
void _competitorFromZod;
void _competitorFromTs;
