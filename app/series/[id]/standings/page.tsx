'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo, seriesRepo, ftpServerRepo } from '@/lib/dexie-repository';
import { getDiscardCount } from '@/lib/scoring';
import { calculateStandings, calculateRaceScores } from '@/lib/scoring';
import { renderSeriesHtml, assembleSeriesResultsData } from '@/lib/results-renderer';
import { uploadViaScupper } from '@/lib/scupper';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import type { Standing, DiscardThreshold } from '@/lib/types';

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

async function buildHtml(seriesId: string): Promise<string | null> {
  const [series, competitors, races] = await Promise.all([
    seriesRepo.get(seriesId),
    competitorRepo.listBySeries(seriesId),
    raceRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const allFinishes = await finishRepo.listBySeries(seriesId, competitors.map((c) => c.id));
  const standings = calculateStandings(competitors, races, allFinishes, series.discardThresholds, series.dnfScoring);

  const competitorsById = new Map(competitors.map((c) => [c.id, c]));
  const raceScoresByRaceId = new Map(
    races.map((race) => {
      const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
      const scores = calculateRaceScores(finishesForRace, competitors, series.dnfScoring);
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
    { name: series.name, venue: series.venue, venueLogoUrl: series.venueLogoUrl, eventLogoUrl: series.eventLogoUrl },
    races,
    standings,
    raceScoresByRaceId,
    competitorsById,
    new Date(),
  );

  return renderSeriesHtml(data);
}

async function exportHtml(seriesId: string) {
  const html = await buildHtml(seriesId);
  if (!html) return;

  const series = await seriesRepo.get(seriesId);
  const slug = series?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';
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

type UploadState =
  | 'idle'
  | 'uploading'
  | { success: true }
  | { success: false; error: string };

function FtpUploadDialog({
  seriesId,
  open,
  onClose,
}: {
  seriesId: string;
  open: boolean;
  onClose: () => void;
}) {
  const ftpServers = useLiveQuery(() => ftpServerRepo.list(), []);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [ftpPath, setFtpPath] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  useEffect(() => {
    if (open) setUploadState('idle');
  }, [open]);

  async function handleUpload() {
    const serverId = parseInt(selectedServerId);
    const server = ftpServers?.find((s) => s.id === serverId);
    if (!server || !ftpPath.trim()) return;

    setUploadState('uploading');

    const html = await buildHtml(seriesId);
    if (!html) {
      setUploadState({ success: false, error: 'No results to upload.' });
      return;
    }

    const result = await uploadViaScupper({
      ftpHost: server.host,
      ftpPort: server.port,
      ftpUsername: server.username,
      ftpPassword: server.password,
      ftpPath: ftpPath.trim(),
      ftps: server.ftps,
      html,
    });

    setUploadState(result.ok ? { success: true } : { success: false, error: result.error });
  }

  const noServers = ftpServers !== undefined && ftpServers.length === 0;
  const uploading = uploadState === 'uploading';
  const succeeded = typeof uploadState === 'object' && uploadState.success;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload via FTP</DialogTitle>
        </DialogHeader>

        {noServers ? (
          <p className="text-sm text-muted-foreground">
            No FTP servers configured.{' '}
            <Link href="/settings" className="underline" onClick={onClose}>
              Add one in Settings.
            </Link>
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Server</Label>
              <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a server…" />
                </SelectTrigger>
                <SelectContent>
                  {ftpServers?.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ftp-path">Path</Label>
              <Input
                id="ftp-path"
                value={ftpPath}
                onChange={(e) => setFtpPath(e.target.value)}
                placeholder="/public_html/results/fleet-a.html"
              />
            </div>
            {typeof uploadState === 'object' && uploadState.success && (
              <p className="text-sm text-green-600 dark:text-green-400">Uploaded successfully.</p>
            )}
            {typeof uploadState === 'object' && !uploadState.success && (
              <p className="text-sm text-destructive">{uploadState.error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {succeeded ? 'Close' : 'Cancel'}
          </Button>
          {!noServers && (
            <Button
              onClick={handleUpload}
              disabled={!selectedServerId || !ftpPath.trim() || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const [showFtpDialog, setShowFtpDialog] = useState(false);

  const series = useLiveQuery(
    async () => (await seriesRepo.get(seriesId)) ?? null,
    [seriesId],
  );
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

  useGlobalKeyDown((e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) return;
    if (e.key === 'x') {
      e.preventDefault();
      exportHtml(seriesId);
    } else if (e.key === 'f') {
      e.preventDefault();
      setShowFtpDialog(true);
    }
  });

  if (
    series === undefined ||
    competitors === undefined ||
    races === undefined ||
    allFinishes === undefined
  ) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
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

  const discardThresholds: DiscardThreshold[] = series.discardThresholds ?? [];
  const standings = calculateStandings(competitors, races, allFinishes, discardThresholds, series.dnfScoring ?? 'seriesEntries');
  const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
  const discardCount = getDiscardCount(races.length, discardThresholds);

  return (
    <div className="space-y-4 overflow-x-auto">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races.length} race{races.length === 1 ? '' : 's'} · Low Point ·{' '}
          {discardCount > 0
            ? `${discardCount} discard${discardCount > 1 ? 's' : ''}`
            : 'No discards'}{' '}
          · {competitors.length} competitors
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFtpDialog(true)} title="Upload via FTP (f)">
            Upload via FTP
          </Button>
          <Button size="sm" onClick={() => exportHtml(seriesId)} title="Export HTML (x)">
            Export HTML
          </Button>
        </div>
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
            {hasDiscards && (
              <TableHead className="w-20 text-center font-semibold">Nett</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {standings.map((standing) => (
            <StandingRow
              key={standing.competitor.id}
              standing={standing}
              raceCount={races.length}
              hasDiscards={hasDiscards}
            />
          ))}
        </TableBody>
      </Table>

      <FtpUploadDialog
        seriesId={seriesId}
        open={showFtpDialog}
        onClose={() => setShowFtpDialog(false)}
      />
    </div>
  );
}

function StandingRow({
  standing,
  raceCount,
  hasDiscards,
}: {
  standing: Standing;
  raceCount: number;
  hasDiscards: boolean;
}) {
  const { rank, competitor, racePoints, raceCodes, totalPoints, netPoints, raceDiscards } = standing;

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
      {racePoints.map((points, i) => {
        const isDiscard = raceDiscards[i] ?? false;
        const code = raceCodes[i];
        return (
          <TableCell
            key={i}
            className={cn(
              'text-center tabular-nums',
              isDiscard && 'line-through text-muted-foreground',
            )}
          >
            {code !== null ? (
              <span className={cn('text-xs', !isDiscard && 'text-muted-foreground')}>
                {points}
                <span className="ml-0.5">({code})</span>
              </span>
            ) : (
              points
            )}
          </TableCell>
        );
      })}
      {/* Pad with dashes for races not yet sailed */}
      {Array.from({ length: raceCount - racePoints.length }).map((_, i) => (
        <TableCell key={`empty-${i}`} className="text-center text-muted-foreground">
          —
        </TableCell>
      ))}
      <TableCell className="text-center font-semibold tabular-nums">
        {totalPoints}
      </TableCell>
      {hasDiscards && (
        <TableCell className="text-center font-semibold tabular-nums">
          {netPoints}
        </TableCell>
      )}
    </TableRow>
  );
}
