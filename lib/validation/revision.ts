import { z } from 'zod';

/**
 * Validation for the embedded revision-history import (#166).
 *
 * The per-revision `snapshot` is a full `.sailscoring` payload that's stored
 * verbatim as `jsonb` and only ever re-served, so it's validated as an opaque
 * object rather than re-deriving the whole file schema here. The structural
 * fields that drive behaviour (kind, timestamp) are checked.
 */
const fileRevisionSchema = z.object({
  kind: z.enum(['auto', 'named', 'revert']),
  label: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string(),
  actor: z
    .object({
      displayName: z.string().optional(),
      email: z.string().optional(),
    })
    .nullable(),
  snapshot: z.record(z.string(), z.unknown()),
});

export const seriesRevisionsImportSchema = z.object({
  revisions: z.array(fileRevisionSchema),
});
