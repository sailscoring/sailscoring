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
  fleet: z.string().trim().min(1).max(80).optional(),
});

/** Create a ranking: a name is enough — buckets start empty-ish. */
export const rankingCreateSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(120),
});

/** Full update: name, config, the public toggle, and — while the ranking is
 *  private — the public-page slug. Format/uniqueness are checked in the
 *  handler so each rejection carries a specific `code`. */
export const rankingUpdateSchema = z.object({
  name: z.string().trim().min(1, 'a name is required').max(120),
  config: rankingConfigSchema,
  published: z.boolean(),
  slug: z.string().trim().toLowerCase().optional(),
});
