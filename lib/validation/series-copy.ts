import { z } from 'zod';

/**
 * ADR-008 Phase 7 — body schema for `POST /api/v1/series/{id}/copy`.
 *
 * Source workspace is implied by `workspaceRoute` (the active workspace
 * the user is signed into). The handler verifies membership in the
 * target workspace before copying.
 *
 * `name` is optional — when omitted, the handler defaults to
 * "Copy of <Original>". Leading/trailing whitespace is trimmed; an empty
 * trimmed string falls back to the default too.
 */
export const seriesCopyInputSchema = z.object({
  targetWorkspaceId: z.string().min(1),
  name: z.string().optional(),
});

export type SeriesCopyInput = z.infer<typeof seriesCopyInputSchema>;
