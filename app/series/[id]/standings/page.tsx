'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo, seriesRepo, ftpServerRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
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
import { uploadToBilge, lookupPrefix, checkPublishStatus, publishedUrl, fetchPolicy } from '@/lib/bilge';
import { slugify, isValidPrefix } from '@/lib/bilge-slug';
import type { Standing, DiscardThreshold, Series, BilgeBundle } from '@/lib/types';

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
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slug + '.htm';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type PublishState =
  | 'idle'
  | 'publishing'
  | 'checking'
  | { error: string };

function BilgePublishDialog({
  series,
  open,
  onClose,
}: {
  series: Series;
  open: boolean;
  onClose: () => void;
}) {
  const bundle = series.bilgeBundle;

  // Setup view state
  const [prefix, setPrefix] = useState(() => slugify(series.name) || 'results');
  const [email, setEmail] = useState('');
  const [prefixAvailable, setPrefixAvailable] = useState<boolean | null>(null);
  const [checkingPrefix, setCheckingPrefix] = useState(false);

  // Shared publish state
  const [publishState, setPublishState] = useState<PublishState>('idle');

  // Retention days from policy — null = no expiry, undefined = not yet fetched
  const [retentionDays, setRetentionDays] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setPublishState('idle');
      if (!bundle) {
        setPrefix(slugify(series.name) || 'results');
        setEmail('');
        setPrefixAvailable(null);
      } else {
        fetchPolicy().then((p) => setRetentionDays(p.retentionDays));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Debounced prefix availability check
  useEffect(() => {
    if (!open || bundle || !prefix || !isValidPrefix(prefix)) {
      setPrefixAvailable(null);
      return;
    }
    setCheckingPrefix(true);
    setPrefixAvailable(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await lookupPrefix(prefix, controller.signal);
      setCheckingPrefix(false);
      setPrefixAvailable(!result.found);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, bundle, prefix]);

  async function handlePublish() {
    setPublishState('publishing');

    const html = await buildHtml(series.id);
    if (!html) {
      setPublishState({ error: 'No results to publish.' });
      return;
    }

    const uuid = bundle?.uuid ?? crypto.randomUUID();
    const slug = bundle?.slug ?? `${prefix}/standings`;
    const result = await uploadToBilge({
      uuid,
      slug,
      email: bundle ? undefined : email,
      html,
    });

    if (result.status === 'error') {
      setPublishState({ error: result.message ?? result.code });
      return;
    }

    const updatedBundle: BilgeBundle = {
      uuid,
      prefix: bundle?.prefix ?? prefix,
      slug,
      email: bundle ? bundle.email : email,
      status: result.status,
      publishedUrl: result.status === 'published' ? result.url : (bundle?.publishedUrl ?? null),
      lastPublishedAt: Date.now(),
    };

    await db.series.update(series.id, { bilgeBundle: updatedBundle });
    setPublishState('idle');
  }

  async function handleCheckStatus() {
    if (!bundle) return;
    setPublishState('checking');
    const live = await checkPublishStatus(bundle.slug);
    if (live) {
      const url = publishedUrl(bundle.slug);
      await db.series.update(series.id, {
        bilgeBundle: { ...bundle, status: 'published', publishedUrl: url },
      });
    }
    setPublishState('idle');
  }

  const isPublishing = publishState === 'publishing';
  const isChecking = publishState === 'checking';
  const hasError = typeof publishState === 'object';

  const prefixValid = isValidPrefix(prefix);
  const canPublish = !isPublishing && (
    bundle
      ? true
      : prefixValid && !!email.trim()
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
        </DialogHeader>

        {bundle ? (
          // Manage view — bundle already configured
          <form id="bilge-publish-form" onSubmit={(e) => { e.preventDefault(); handlePublish(); }} className="space-y-3 min-w-0">
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground truncate">
                Published at{' '}
                <span className="font-mono text-xs">{bundle.slug}</span>
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Status:</span>
                {bundle.status === 'published' ? (
                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Published</span>
                ) : bundle.status === 'pending' ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pending verification</span>
                ) : (
                  <span className="text-xs text-muted-foreground">Unpublished</span>
                )}
              </div>
              {bundle.lastPublishedAt !== null && (
                <p className="text-xs text-muted-foreground">
                  {new Date(bundle.lastPublishedAt).toLocaleString()}
                  {retentionDays != null && (
                    <>{' · Expires '}{new Date(bundle.lastPublishedAt + retentionDays * 86_400_000).toLocaleDateString()}</>
                  )}
                </p>
              )}
            </div>

            {bundle.status === 'published' && bundle.publishedUrl && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <a
                    href={bundle.publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono truncate block hover:underline"
                  >
                    {bundle.publishedUrl}
                  </a>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => navigator.clipboard.writeText(bundle.publishedUrl!)}
                >
                  Copy
                </Button>
              </div>
            )}

            {bundle.status === 'pending' && (
              <p className="text-sm text-muted-foreground">
                Check your email for a verification link. Once verified, re-publish to make it live.
              </p>
            )}

            {hasError && (
              <p className="text-sm text-destructive">{(publishState as { error: string }).error}</p>
            )}
          </form>
        ) : (
          // Setup view — first publish
          <form id="bilge-publish-form" onSubmit={(e) => { e.preventDefault(); handlePublish(); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bilge-prefix">URL prefix</Label>
              <Input
                id="bilge-prefix"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="hyc-autumn-league-2026"
                autoFocus
              />
              {prefix && !prefixValid && (
                <p className="text-xs text-destructive">
                  Use only lowercase letters, numbers, and hyphens (e.g. hyc-autumn-2026).
                </p>
              )}
              {prefixValid && (
                <p className="text-xs text-muted-foreground">
                  {checkingPrefix
                    ? 'Checking…'
                    : prefixAvailable === true
                    ? '✓ Available'
                    : prefixAvailable === false
                    ? 'Already in use — choose another prefix.'
                    : null}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bilge-email">Your email</Label>
              <Input
                id="bilge-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="scorer@example.com"
              />
              <p className="text-xs text-muted-foreground">
                A verification link will be sent on first publish. Not stored in the series file.
              </p>
            </div>
            {hasError && (
              <p className="text-sm text-destructive">{(publishState as { error: string }).error}</p>
            )}
          </form>
        )}

        <DialogFooter className="sm:justify-between">
          <a
            href={`${process.env.NEXT_PUBLIC_BILGE_URL}/l/`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:underline self-center"
          >
            bilge.sailscoring.ie
          </a>
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {bundle?.status === 'pending' && (
            <Button variant="outline" onClick={handleCheckStatus} disabled={isChecking}>
              {isChecking ? 'Checking…' : 'Check status'}
            </Button>
          )}
          <Button
            type="submit"
            form="bilge-publish-form"
            disabled={!canPublish}
          >
            {isPublishing ? 'Publishing…' : bundle ? 'Re-publish' : 'Publish'}
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type UploadState =
  | 'idle'
  | 'uploading'
  | { success: true }
  | { success: false; error: string };

function FtpUploadDialog({
  series,
  open,
  onClose,
}: {
  series: Series;
  open: boolean;
  onClose: () => void;
}) {
  const ftpServers = useLiveQuery(() => ftpServerRepo.list(), []);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [ftpPath, setFtpPath] = useState('');
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  // Reset state and pre-fill from series when dialog opens.
  useEffect(() => {
    if (!open) return;
    setUploadState('idle');
    setFtpPath(series.ftpPath ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-select the server whose host matches the series' saved ftpHost.
  useEffect(() => {
    if (!open || !ftpServers) return;
    if (series.ftpHost) {
      const match = ftpServers.find((s) => s.host === series.ftpHost);
      setSelectedServerId(match?.id !== undefined ? String(match.id) : '');
    } else {
      setSelectedServerId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ftpServers]);

  async function handleUpload() {
    const serverId = parseInt(selectedServerId);
    const server = ftpServers?.find((s) => s.id === serverId);
    if (!server || !ftpPath.trim()) return;

    setUploadState('uploading');

    const html = await buildHtml(series.id);
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

    if (result.ok) {
      await db.series.update(series.id, { ftpHost: server.host, ftpPath: ftpPath.trim() });
    }
    setUploadState(result.ok ? { success: true } : { success: false, error: result.error });
  }

  const noServers = ftpServers !== undefined && ftpServers.length === 0;
  const uploading = uploadState === 'uploading';
  const succeeded = typeof uploadState === 'object' && uploadState.success;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
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
          <form id="ftp-upload-form" onSubmit={(e) => { e.preventDefault(); handleUpload(); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Server</Label>
              <Select value={selectedServerId} onValueChange={setSelectedServerId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a server…" />
                </SelectTrigger>
                <SelectContent>
                  {ftpServers?.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.ftps ? 'ftps' : 'ftp'}://{s.host}:{s.port}
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
                autoFocus
              />
            </div>
            {typeof uploadState === 'object' && uploadState.success && (
              <p className="text-sm text-green-600 dark:text-green-400">Uploaded successfully.</p>
            )}
            {typeof uploadState === 'object' && !uploadState.success && (
              <p className="text-sm text-destructive">{uploadState.error}</p>
            )}
          </form>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {succeeded ? 'Close' : 'Cancel'}
          </Button>
          {!noServers && (
            <Button
              type="submit"
              form="ftp-upload-form"
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
  const [showBilgeDialog, setShowBilgeDialog] = useState(false);

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
    } else if (e.key === 'p') {
      e.preventDefault();
      setShowBilgeDialog(true);
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
          <Button size="sm" variant="outline" onClick={() => setShowBilgeDialog(true)} title="Publish (p)">
            Publish
          </Button>
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

      <BilgePublishDialog
        series={series}
        open={showBilgeDialog}
        onClose={() => setShowBilgeDialog(false)}
      />
      <FtpUploadDialog
        series={series}
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
