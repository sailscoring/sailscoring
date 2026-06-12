'use client';

/**
 * "Carried forward from …" note for a follow-on series: names the
 * predecessor the competitors and starting handicaps were rolled over
 * from, linking back to it. Renders nothing while the predecessor is
 * loading, and stays hidden if it's gone (trashed or deleted) — the
 * lineage is then history the workspace can no longer show.
 */
import Link from 'next/link';

import { useSeries } from '@/hooks/use-series';

export function FollowOnProvenanceNote({
  previousSeriesId,
}: {
  previousSeriesId: string;
}) {
  const { data: predecessor } = useSeries(previousSeriesId);
  if (!predecessor) return null;
  return (
    <p
      className="text-sm text-muted-foreground"
      data-testid="follow-on-provenance"
    >
      Competitors and starting handicaps carried forward from{' '}
      <Link
        href={`/series/${predecessor.id}/competitors`}
        className="underline underline-offset-2"
      >
        {predecessor.name}
      </Link>
      .
    </p>
  );
}
