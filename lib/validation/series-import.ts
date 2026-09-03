import { z } from 'zod';

/**
 * ADR-009 M2 — body schema for `POST /api/v1/series/import`.
 *
 * Only the envelope is validated here: `content` is the document's raw text,
 * and `format` says which document it is — a scorer's `.sailscoring` file, or
 * the sanitized `.sailscoring.json` a publication serves beside its pages
 * (ADR-012). The structural validation and version migration live in the
 * parser for each (`parseSeriesFile`, `parsePublicExport`), which the handler
 * runs: restating either full, versioned shape in Zod would only invite drift.
 *
 * `format` defaults to the file, so the CLI's existing `{ content }` body
 * (ADR-009 M2) keeps meaning what it always did.
 */
export const seriesImportInputSchema = z.object({
  content: z.string().min(1),
  format: z.enum(['sailscoring', 'public-export']).default('sailscoring'),
});

export type SeriesImportInput = z.infer<typeof seriesImportInputSchema>;
