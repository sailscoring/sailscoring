/**
 * The two non-ready states of a series tab page, so the Loading… and
 * Series-not-found strings exist exactly once. Pairs with
 * `useSeriesData`'s status union; `status="loading"` also serves pages
 * with their own loading guards.
 */
export function SeriesTabFallback({ status }: { status: 'loading' | 'missing' }) {
  return (
    <p className="text-muted-foreground">
      {status === 'loading' ? 'Loading…' : 'Series not found.'}
    </p>
  );
}
