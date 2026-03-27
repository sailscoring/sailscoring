'use client';

import { use } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo, seriesRepo } from '@/lib/dexie-repository';
import { calculateStandings, calculateRaceScores } from '@/lib/scoring';
import { renderSeriesHtml, assembleSeriesResultsData } from '@/lib/results-renderer';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

async function exportHtml(seriesId: string) {
  const [series, competitors, races] = await Promise.all([
    seriesRepo.get(seriesId),
    competitorRepo.listBySeries(seriesId),
    raceRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return;

  const allFinishes = await finishRepo.listBySeries(seriesId, competitors.map((c) => c.id));
  const standings = calculateStandings(competitors, races, allFinishes);

  const competitorsById = new Map(competitors.map((c) => [c.id, c]));
  const raceScoresByRaceId = new Map(
    races.map((race) => {
      const finishesForRace = allFinishes.filter((f) =>
        races.find((r) => r.id === race.id) && f.raceId === race.id,
      );
      const scores = calculateRaceScores(finishesForRace, competitors);
      const scoreMap = new Map(
        [...scores.entries()].map(([id, s]) => [
          id,
          { points: s.points, place: s.place, resultCode: s.resultCode },
        ]),
      );
      return [race.id, scoreMap] as const;
    }),
  );

  const data = assembleSeriesResultsData(
    { name: series.name, venue: series.venue },
    races,
    standings,
    raceScoresByRaceId,
    competitorsById,
    new Date(),
  );

  const html = renderSeriesHtml(data);
  const slug = series.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug + '.htm';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  return (
    <div className="space-y-4 overflow-x-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races.length} race{races.length === 1 ? '' : 's'} · Low Point ·{' '}
          {competitors.length} competitors
        </p>
        <Button variant="outline" size="sm" onClick={() => exportHtml(seriesId)}>
          Export HTML
        </Button>
      </div>

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
  const { rank, competitor, racePoints, raceCodes, totalPoints } = standing;

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
          {raceCodes[i] !== null ? (
            <span className="text-muted-foreground text-xs">
              {points}
              <span className="ml-0.5">({raceCodes[i]})</span>
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
