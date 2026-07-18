import { z } from 'zod';

import { uuidSchema } from './common';

/** Rename an identity's canonical label. */
export const identityRenameSchema = z.object({
  label: z.string().trim().min(1, 'a label is required').max(120),
});

/** Peel competitor rows off an identity onto a fresh identity (#221). */
export const identitySplitSchema = z.object({
  competitorIds: z.array(uuidSchema).min(1).max(500),
});

/** Merge another identity into this one (#221). */
export const identityMergeSchema = z.object({
  sourceId: uuidSchema,
});

/** Body of POST /competitor-identities/{id}/unlink (#316). */
export const identityUnlinkSchema = z.object({ competitorId: uuidSchema });

/** Undo a merge: recreate the merged-away identity and re-link its rows.
 *  The body is exactly what the merge endpoint returned. */
export const identityRestoreSchema = z.object({
  source: z.object({
    id: uuidSchema,
    slug: z.string().trim().min(1).max(200).nullable(),
    label: z.string().trim().min(1).max(120),
    sailNumber: z.string().max(40),
    club: z.string().max(200).nullable(),
    nationality: z.string().max(10).nullable(),
  }),
  movedCompetitorIds: z.array(uuidSchema).max(500),
});

/** Stamp or clear the review queue's "looks right" mark (#221). */
export const identityReviewedSchema = z.object({
  reviewed: z.boolean(),
});

/** Record two identities as confirmed different sailors (#221). */
export const identityDistinctionSchema = z.object({
  aId: uuidSchema,
  bId: uuidSchema,
});
