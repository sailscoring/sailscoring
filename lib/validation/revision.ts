import { z } from 'zod';

/**
 * Validation for the embedded revision-history import (#166).
 *
 * Per-revision metadata is validated structurally; the snapshots ride in the
 * opaque base64 `revisionSnapshots` blob (whole-array zstd), decompressed and
 * sanitised server-side, so it's just checked to be a string here.
 */
const fileRevisionSchema = z.object({
  kind: z.enum(['auto', 'named', 'revert', 'publish', 'saved']),
  label: z.string().nullable(),
  summary: z.string().nullable(),
  createdAt: z.string(),
  actor: z
    .object({
      displayName: z.string().optional(),
      email: z.string().optional(),
    })
    .nullable(),
});

export const seriesRevisionsImportSchema = z.object({
  revisions: z.array(fileRevisionSchema),
  revisionSnapshots: z.string(),
});

/** A user-named checkpoint (#166). The label is required and trimmed. */
export const checkpointInputSchema = z.object({
  label: z.string().trim().min(1).max(100),
});
