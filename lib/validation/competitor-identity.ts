import { z } from 'zod';

import { uuidSchema } from './common';

/** Rename an identity's canonical label. */
export const identityRenameSchema = z.object({
  label: z.string().trim().min(1, 'a label is required').max(120),
});

/** Split a competitor row off an identity. */
export const identityUnlinkSchema = z.object({
  competitorId: uuidSchema,
});
