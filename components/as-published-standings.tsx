'use client';

import { useQuery } from '@tanstack/react-query';

import type { AsPublishedFleetView } from '@/lib/api-handlers/archive';
import { getAsPublishedResults } from '@/lib/api-repository';
import type {
  AsPublishedFleetResults,
  AsPublishedRow,
} from '@/lib/archive-kit/types';
import { cn } from '@/lib/utils';
import { queryKeys } from '@/hooks/query-keys';
import { Button } from '@/components/ui/button';

/**
 * The in-app Standings tab for an as-published series (ADR-010): the stored
 * tables, exactly as originally published — same data the public pages
 * render, read-only by nature. Per-race detail tables stay on the public
 * pages (a DBSC class carries forty of them); the summary standings are what
 * a scorer opens this tab for.
 */

export function useAsPublishedResults(seriesId: string) {
  return useQuery<{ fleets: AsPublishedFleetView[] }>({
    queryKey: queryKeys.series.asPublishedResults(seriesId),
    queryFn: () => getAsPublishedResults(seriesId),
  });
}

function hasRanks(results: AsPublishedFleetResults): boolean {
  return results.rows.some((r) => r.rank != null || r.rankLabel !== '');
}

function RowCells({
  row,
  showRank,
}: {
  row: AsPublishedRow;
  showRank: boolean;
}) {
  return (
    <>
      {showRank && (
        <td className="px-2 py-1 font-medium tabular-nums">{row.rankLabel}</td>
      )}
      {row.leadCells.map((value, i) => (
        <td key={`l${i}`} className="px-2 py-1">
          {value}
        </td>
      ))}
      {row.raceCells.map((cell, i) => (
        <td
          key={`r${i}`}
          className={cn(
            'px-2 py-1 tabular-nums whitespace-nowrap',
            cell.discard && 'text-muted-foreground',
          )}
        >
          {cell.text}
        </td>
      ))}
      {row.summaryCells.map((value, i) => (
        <td key={`s${i}`} className="px-2 py-1 tabular-nums font-medium">
          {value}
        </td>
      ))}
    </>
  );
}

function FleetTable({ fleet }: { fleet: AsPublishedFleetView }) {
  const { results } = fleet;
  const showRank = hasRanks(results);
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">{fleet.fleetName}</h2>
        {results.caption && (
          <span className="text-xs text-muted-foreground">{results.caption}</span>
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm" data-testid="as-published-standings">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              {showRank && <th className="px-2 py-2 font-medium">Rank</th>}
              {results.leadColumns.map((c, i) => (
                <th key={`l${i}`} className="px-2 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              {results.raceHeaders.map((r, i) => (
                <th key={`r${i}`} className="px-2 py-2 font-medium whitespace-nowrap">
                  {r.label}
                </th>
              ))}
              {results.summaryColumns.map((c, i) => (
                <th key={`s${i}`} className="px-2 py-2 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((row, i) => (
              <tr key={i} className="border-b last:border-b-0">
                <RowCells row={row} showRank={showRank} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(results.raceTables?.length ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Per-race detail ({results.raceTables!.length} race
          {results.raceTables!.length === 1 ? '' : 's'}) is on the public page.
        </p>
      )}
    </section>
  );
}

export function AsPublishedStandings({ seriesId }: { seriesId: string }) {
  const { data, isError, refetch } = useAsPublishedResults(seriesId);

  if (data === undefined) {
    if (isError) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load the archived results. Check your connection and
            try again.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (data.fleets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No archived results stored.</p>
    );
  }

  return (
    <div className="space-y-8">
      {data.fleets.map((fleet) => (
        <FleetTable key={fleet.fleetId} fleet={fleet} />
      ))}
    </div>
  );
}
