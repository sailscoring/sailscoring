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
 *   - `fleets` — the fleet names to publish/update now (selective publishing).
 *     Omitted means "all fleets". A fleet left out is skipped this round, not
 *     retracted: an already-published one keeps its current live page. An empty
 *     array on a first publish (nothing live to keep) is rejected.
 *   - `subPaths` — per-fleet URL sub-path overrides, keyed by fleet name. Lets
 *     a scorer keep a clean fleet name ("Puppeteers HPH") while pointing it at
 *     a disambiguated URL ("tuesday-puppeteers-hph"). Honoured only while a
 *     fleet is unpublished; once published its sub-path is frozen like the
 *     slug. Format/uniqueness are checked in the handler for a specific `code`.
 */
export const publishInputSchema = z.object({
  slug: z.string().optional(),
  join: z.boolean().optional(),
  fleets: z.array(z.string()).optional(),
  subPaths: z.record(z.string(), z.string()).optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;
