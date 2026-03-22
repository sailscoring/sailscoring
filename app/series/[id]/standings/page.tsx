'use client';

import { use } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo } from '@/lib/dexie-repository';
import { calculateStandings } from '@/lib/scoring';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Standing } from '@/lib/types';

function PointsCell({
  points,
  isBest,
  resultCode,
}: {
  points: number;
  isBest: boolean;
  resultCode?: string;
}) {
  const isPenalty = resultCode !== null && resultCode !== undefined;
  return (
    <TableCell
      className={cn(
        'text-center tabular-nums',
        isBest && 'font-semibold',
        isPenalty && 'text-muted-foreground',
      )}
      title={resultCode ?? undefined}
    >
      {points}
      {isPenalty && (
        <span className="text-xs ml-0.5 text-muted-foreground">({resultCode})</span>
      )}
    </TableCell>
  );
}

export default function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);

  const competitors = useLiveQuery(
    () => competitorRepo.listBySeries(seriesId),
    [seriesId],
  );
  const races = useLiveQuery(() => raceRepo.listBySeries(seriesId), [seriesId]);
  const allFinishes = useLiveQuery(
    async () => {
      if (!competitors) return undefined;
      return finishRepo.listBySeries(
        seriesId,
        competitors.map((c) => c.id),
      );
    },
    [seriesId, competitors],
  );

  if (
    competitors === undefined ||
    races === undefined ||
    allFinishes === undefined
  ) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (competitors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No competitors yet. Add competitors to see standings.
      </p>
    );
  }

  if (races.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No races yet. Add races and record results to see standings.
      </p>
    );
  }

  const standings = calculateStandings(competitors, races, allFinishes);

  // Find the minimum race points per competitor (for "best race" highlighting)
  // We highlight the lowest score in each row (not used for discard, just visual)

  return (
    <div className="space-y-4 overflow-x-auto">
      <p className="text-sm text-muted-foreground">
        {races.length} race{races.length === 1 ? '' : 's'} · Low Point ·{' '}
        {competitors.length} competitors
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">Rank</TableHead>
            <TableHead className="w-20">Sail no.</TableHead>
            <TableHead>Helm</TableHead>
            <TableHead>Club</TableHead>
            {races.map((race) => (
              <TableHead key={race.id} className="w-16 text-center">
                R{race.raceNumber}
              </TableHead>
            ))}
            <TableHead className="w-20 text-center font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((standing) => (
            <StandingRow
              key={standing.competitor.id}
              standing={standing}
              raceCount={races.length}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StandingRow({
  standing,
  raceCount,
}: {
  standing: Standing;
  raceCount: number;
}) {
  const { rank, competitor, racePoints, totalPoints } = standing;

  // Highlight rank 1 row
  const isFirst = rank === 1;

  return (
    <TableRow className={cn(isFirst && 'bg-accent/40')}>
      <TableCell className="text-center">
        {rank === 1 ? (
          <Badge variant="default" className="text-xs">
            1st
          </Badge>
        ) : (
          <span className="text-sm">{rank}</span>
        )}
      </TableCell>
      <TableCell className="font-mono">{competitor.sailNumber}</TableCell>
      <TableCell>{competitor.name}</TableCell>
      <TableCell className="text-muted-foreground">{competitor.club}</TableCell>
      {racePoints.map((points, i) => (
        <TableCell key={i} className="text-center tabular-nums">
          {points > raceCount ? (
            <span className="text-muted-foreground text-xs">
              {points}
              <span className="ml-0.5">(DNC)</span>
            </span>
          ) : (
            points
          )}
        </TableCell>
      ))}
      {/* Pad with dashes for races not yet sailed */}
      {Array.from({ length: raceCount - racePoints.length }).map((_, i) => (
        <TableCell key={`empty-${i}`} className="text-center text-muted-foreground">
          —
        </TableCell>
      ))}
      <TableCell className="text-center font-semibold tabular-nums">
        {totalPoints}
      </TableCell>
    </TableRow>
  );
}
