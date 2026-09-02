'use client';

import { Loader2 } from 'lucide-react';

import { useWorkspaceActivity } from '@/hooks/use-activity';
import { useSeriesList } from '@/hooks/use-series';
import { Button } from '@/components/ui/button';
import { ActivityEntryRow } from '@/components/activity/activity-entry-row';

/**
 * The workspace Activity tab's feed. Entries that belong to a series still in
 * the workspace link to it; workspace-level entries, and entries for a series
 * since deleted, stand on their summary alone — it names the series.
 */
export function WorkspaceActivity() {
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useWorkspaceActivity();
  const { data: seriesList } = useSeriesList();

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
      </p>
    );
  }
  if (isError) {
    return <p className="text-sm text-muted-foreground">Couldn’t load activity.</p>;
  }

  const entries = data?.pages.flatMap((p) => p.items) ?? [];
  if (entries.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
        data-testid="workspace-activity-empty"
      >
        Nothing has happened in this workspace yet.
      </div>
    );
  }

  const seriesById = new Map((seriesList ?? []).map((s) => [s.id, { id: s.id, name: s.name }]));

  return (
    <div className="space-y-4">
      <ul className="divide-y bg-card border rounded-lg px-5" data-testid="workspace-activity">
        {entries.map((entry) => (
          <ActivityEntryRow
            key={entry.id}
            entry={entry}
            series={entry.seriesId ? seriesById.get(entry.seriesId) ?? null : null}
          />
        ))}
      </ul>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading…' : 'Show older'}
          </Button>
        </div>
      )}
    </div>
  );
}
