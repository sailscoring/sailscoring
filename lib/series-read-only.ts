import type { Series } from '@/lib/types';

/**
 * Whether the server refuses writes to this series: it is archived, an
 * as-published archive, or its results are marked final. Callers that skip a
 * write for a read-only series check this rather than one of the flags, so a
 * new read-only state can't leave a write path behind.
 */
export function isSeriesReadOnly(
  series: Pick<Series, 'archived' | 'asPublished' | 'resultsStatus'>,
): boolean {
  return (
    (series.archived ?? false) ||
    (series.asPublished ?? false) ||
    series.resultsStatus === 'final'
  );
}
