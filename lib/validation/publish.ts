import { z } from 'zod';

/**
 * Publish request body (ADR-008 Phase 9/10). All fields optional:
 *   - `slug` — chosen series slug at first publish; ignored on re-publish
 *     (the slug is frozen). Format/uniqueness are checked in the handler so it
 *     can return a specific `code`.
 *   - `join` — confirms publishing into a slug that already has results from
 *     other series (a slug is a shared namespace). Without it, a first publish
 *     into an occupied slug is rejected with `slug-shared` so the caller can
 *     confirm.
 */
export const publishInputSchema = z.object({
  slug: z.string().optional(),
  join: z.boolean().optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;
