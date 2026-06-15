import { z } from 'zod';

/**
 * ADR-009 M2 — body schema for `POST /api/v1/series/import`.
 *
 * Only the envelope is validated here: `content` is the raw `.sailscoring`
 * file text. The structural validation and version migration live in
 * `parseSeriesFile` (lib/series-file.ts), which the handler runs — duplicating
 * the full, versioned SeriesFile shape in Zod would just invite drift.
 */
export const seriesImportInputSchema = z.object({
  content: z.string().min(1),
});

export type SeriesImportInput = z.infer<typeof seriesImportInputSchema>;
