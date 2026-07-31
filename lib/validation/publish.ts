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
 *   - `defaultSubPath` — URL sub-path for a single-fleet series' lone default
 *     page (the one the server would otherwise derive as `standings`, or the
 *     series slug when co-publishing). Keyed by `isDefault` rather than by fleet
 *     name, because that page's fleet name can be synthetic ("Unknown" for an
 *     implicit default fleet) and isn't known to the client. Same lifecycle as a
 *     `subPaths` override: honoured only while unpublished.
 *   - `prizes` — `false` skips the prize sheet (#240) this round without
 *     naming any fleet, for the single-page dialog whose lone fleet page has
 *     no client-known name to put in `fleets`. Like an unticked fleet, a live
 *     prizes page carries over untouched. Multi-fleet selections instead
 *     tick/untick the name-keyed "Prizes" row via `fleets`.
 *   - `season` — the season the publication files under (ADR-011). Pinned on
 *     the slug's folder metadata at first publish, so a block series
 *     publishing under its own top-level folder still groups into its season.
 *     Ignored on re-publish.
 *   - `folder` — the event folder the pages were prefixed into (ADR-011),
 *     so its display label can be pinned to the series name (first publisher
 *     wins; a joiner never renames the folder). Ignored on re-publish.
 */
export const publishInputSchema = z.object({
  slug: z.string().optional(),
  join: z.boolean().optional(),
  fleets: z.array(z.string()).optional(),
  subPaths: z.record(z.string(), z.string()).optional(),
  defaultSubPath: z.string().optional(),
  prizes: z.boolean().optional(),
  season: z.string().trim().max(40).optional(),
  folder: z.string().trim().max(60).optional(),
});

export type PublishInput = z.infer<typeof publishInputSchema>;
