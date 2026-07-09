import { z } from 'zod';

import { uuidSchema } from './common';

/** One bucket of a ranking config (#209). */
const rankingBucketSchema = z.object({
  id: z.string().trim().min(1).max(60),
  name: z.string().trim().max(80),
  seriesIds: z.array(uuidSchema).max(100),
  countBest: z.number().int().min(1).max(50),
  requiredMin: z.number().int().min(0).max(50),
});

const rankingConfigSchema = z.object({
  buckets: z.array(rankingBucketSchema).min(1).max(10),
  nationality: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'a three-letter national code')
    .optional(),
});

/** Create a ranking: a name is enough — buckets start empty-ish. */
export const rankingCreateSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(120),
});

/** Full update: name, config, and the public toggle. */
export const rankingUpdateSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(120),
  config: rankingConfigSchema,
  published: z.boolean(),
});
