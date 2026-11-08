import { z } from 'zod';

import type { RaceRatingOverride } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

export const ratingFieldSchema = z.enum(['ircTcc', 'pyNumber', 'vprsTcc', 'fixedTcf', 'ytcNumber']);

const raceRatingOverrideObject = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  competitorId: uuidSchema,
  field: ratingFieldSchema,
  value: z.number(),
  certificate: z.literal('secondary').optional(),
  version: versionSchema,
});

/** Only an IRC rating has a secondary certificate to name. */
const certificateIsIrc = (o: { field: string; certificate?: 'secondary' }) =>
  o.certificate === undefined || o.field === 'ircTcc';
const certificateIsIrcMessage = { message: 'Only an IRC rating can name a certificate.' };

export const raceRatingOverrideSchema = raceRatingOverrideObject.refine(certificateIsIrc, certificateIsIrcMessage);

export const raceRatingOverrideInputSchema = raceRatingOverrideObject
  .extend({ id: uuidSchema.optional() })
  .refine(certificateIsIrc, certificateIsIrcMessage);

/** Bulk-write payload. Mirrors `RaceRatingOverrideRepository.saveMany`. */
export const raceRatingOverridesBulkInputSchema = z.object({
  overrides: z.array(raceRatingOverrideInputSchema),
});

const _fromZod: RaceRatingOverride = undefined as unknown as z.infer<typeof raceRatingOverrideSchema>;
const _fromTs: z.infer<typeof raceRatingOverrideSchema> = undefined as unknown as RaceRatingOverride;
void _fromZod;
void _fromTs;
