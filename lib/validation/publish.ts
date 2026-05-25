import { z } from 'zod';

/**
 * Publish request body (ADR-008 Phase 9/10). Both fields optional:
 *   - `slug` — chosen series slug at first publish; ignored on re-publish
 *     (the slug is frozen). Format/uniqueness are checked in the handler so it
 *     can return a specific `code`.
 *   - `overwrite` — confirms taking over a slug held by an orphaned publication.
 */
export const publishInputSchema = z.object({
  slug: z.string().optional(),
  overwrite: z.boolean().optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;
