'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo, seriesRepo, ftpServerRepo, fleetRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import { getDiscardCount, calculateFleetStandings, calculateRaceScores } from '@/lib/scoring';
import { renderSeriesHtml, assembleSeriesResultsData } from '@/lib/results-renderer';
import { buildPublicExport } from '@/lib/public-export';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { uploadToBilge, lookupPrefix, checkPublishStatus, publishedUrl, fetchPolicy } from '@/lib/bilge';
import { slugify, isValidPrefix } from '@/lib/bilge-slug';
import type { Standing, DiscardThreshold, Fleet, Series, BilgeBundle } from '@/lib/types';

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

function seriesSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';
}

/** Build one HTML string per fleet. Returns [{fleetName, html}]. */
async function buildFleetHtmlFiles(seriesId: string): Promise<{ fleetName: string; isDefault: boolean; html: string }[] | null> {
  const [series, competitors, races, fleets] = await Promise.all([
    seriesRepo.get(seriesId),
    competitorRepo.listBySeries(seriesId),
    raceRepo.listBySeries(seriesId),
    fleetRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const allFinishes = await finishRepo.listBySeries(seriesId, competitors.map((c) => c.id));
  const { fleetStandings: fleetResults } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
  );

  const isSingleDefault = fleets.length <= 1;

  // Build JSON export once for the whole series (embedded in every fleet's HTML)
  const publicExport = (series.includeJsonExport ?? true)
    ? await buildPublicExport(seriesId)
    : null;

  const seriesInfo = { name: series.name, venue: series.venue, venueLogoUrl: series.venueLogoUrl, eventLogoUrl: series.eventLogoUrl };

  const results: { fleetName: string; isDefault: boolean; html: string }[] = [];

  for (const { fleet, standings } of fleetResults) {
    const fleetCompetitorIds = new Set(standings.map((s) => s.competitor.id));

    // Per-fleet race score maps (only this fleet's competitors)
    const raceScoresByRaceId = new Map(
      races.map((race) => {
        const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
        const finishByCompetitorId = new Map(
          finishesForRace
            .filter((f): f is typeof f & { competitorId: string } => f.competitorId !== null)
            .map((f) => [f.competitorId, f]),
        );
        const fleetCompetitors = competitors.filter((c) => fleetCompetitorIds.has(c.id));
        const scores = calculateRaceScores(finishesForRace, fleetCompetitors, series.dnfScoring ?? 'seriesEntries');
        const scoreMap = new Map(
          [...scores.entries()].map(([id, s]) => [
            id,
            {
              points: s.points,
              place: s.place,
              rank: s.rank,
              resultCode: s.resultCode,
              penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null,
              penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null,
            },
          ]),
        );
        return [race.id, scoreMap] as const;
      }),
    );

    const competitorsById = new Map(competitors.map((c) => [c.id, c]));
    const fleetName = isSingleDefault ? undefined : fleet.name;

    const data = assembleSeriesResultsData(
      seriesInfo,
      races,
      standings,
      raceScoresByRaceId,
      competitorsById,
      new Date(),
      fleetName,
    );

    if (publicExport) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL;
      if (appUrl) {
        const json = JSON.stringify(publicExport);
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
        const b64 = btoa(binary)
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
        data.publicExportJson = json;
        data.openInAppUrl = `${appUrl}/?import=${b64}`;
      }
    }

    results.push({
      fleetName: fleet.name,
      isDefault: isSingleDefault,
      html: renderSeriesHtml(data),
    });
  }

  return results.length > 0 ? results : null;
}

function triggerDownload(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a single fleet's HTML (or the only fleet for single-fleet series). */
async function exportFleetHtml(seriesId: string, fleetName: string) {
  const series = await seriesRepo.get(seriesId);
  const base = seriesSlug(series?.name ?? 'series');
  const files = await buildFleetHtmlFiles(seriesId);
  if (!files) return;
  const file = files.find((f) => f.fleetName === fleetName) ?? files[0];
  const suffix = file.isDefault ? '' : '-' + seriesSlug(file.fleetName);
  triggerDownload(base + suffix + '.html', file.html);
}

/** Derive a per-fleet bilge slug from the bundle prefix. */
function fleetBilgeSlug(prefix: string, fleetName: string, isSingleDefault: boolean): string {
  if (isSingleDefault) return `${prefix}/standings`;
  return `${prefix}/standings-${seriesSlug(fleetName)}`;
}

/** Insert a fleet suffix before the file extension in an FTP path. */
function fleetFtpPath(base: string, fleetName: string, isSingleDefault: boolean): string {
  if (isSingleDefault || !base) return base;
  const suffix = '-' + seriesSlug(fleetName);
  const lastDot = base.lastIndexOf('.');
  const lastSlash = base.lastIndexOf('/');
  if (lastDot > lastSlash) return base.slice(0, lastDot) + suffix + base.slice(lastDot);
  return base + suffix;
}

/** Strip the fleet suffix from a fleet-specific path to recover the base path. */
function stripFleetSuffix(path: string, fleetName: string): string {
  const suffix = '-' + seriesSlug(fleetName);
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  if (lastDot > lastSlash) {
    const stem = path.slice(0, lastDot);
    if (stem.endsWith(suffix)) return stem.slice(0, -suffix.length) + path.slice(lastDot);
  } else if (path.endsWith(suffix)) {
    return path.slice(0, -suffix.length);
  }
  return path;
}

type PublishState =
  | 'idle'
  | 'publishing'
  | 'checking'
  | { error: string };

function BilgePublishDialog({
  series,
  fleets,
  open,
  onClose,
}: {
  series: Series;
  fleets: Fleet[];
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

    const fleetFiles = await buildFleetHtmlFiles(series.id);
    if (!fleetFiles) {
      setPublishState({ error: 'No results to publish.' });
      return;
    }

    const isSingleDefault = fleetFiles.length === 1 && fleetFiles[0].isDefault;
    const uuid = bundle?.uuid ?? crypto.randomUUID();
    const effectivePrefix = bundle?.prefix ?? prefix;

    // Upload first fleet — email only sent on first-ever publish
    const primarySlug = fleetBilgeSlug(effectivePrefix, fleetFiles[0].fleetName, isSingleDefault);
    const firstResult = await uploadToBilge({
      uuid,
      slug: primarySlug,
      email: bundle ? undefined : email,
      html: fleetFiles[0].html,
    });

    if (firstResult.status === 'error') {
      setPublishState({ error: firstResult.message ?? firstResult.code });
      return;
    }

    // Upload remaining fleets (email verification not needed again)
    const fleetUrls: { name: string; url: string | null }[] = [{
      name: fleetFiles[0].fleetName,
      url: firstResult.status === 'published' ? firstResult.url : null,
    }];

    for (const file of fleetFiles.slice(1)) {
      const slug = fleetBilgeSlug(effectivePrefix, file.fleetName, false);
      const result = await uploadToBilge({ uuid, slug, html: file.html });
      fleetUrls.push({
        name: file.fleetName,
        url: result.status === 'published' ? result.url : null,
      });
    }

    const updatedBundle: BilgeBundle = {
      uuid,
      prefix: effectivePrefix,
      slug: primarySlug,
      email: bundle ? bundle.email : email,
      status: firstResult.status === 'published' ? 'published'
            : firstResult.status === 'pending'   ? 'pending'
            :                                      'unpublished',
      publishedUrl: fleetUrls[0].url,
      lastPublishedAt: Date.now(),
      fleets: isSingleDefault ? undefined : fleetUrls,
    };

    await db.series.update(series.id, { bilgeBundle: updatedBundle });
    setPublishState('idle');
  }

  async function handleCheckStatus() {
    if (!bundle) return;
    setPublishState('checking');
    const live = await checkPublishStatus(bundle.slug);
    if (live) {
      const isSingleDefault = !bundle.fleets;
      const updatedFleets = bundle.fleets?.map((f) => ({
        ...f,
        url: publishedUrl(fleetBilgeSlug(bundle.prefix, f.name, false)),
      }));
      await db.series.update(series.id, {
        bilgeBundle: {
          ...bundle,
          status: 'published',
          publishedUrl: publishedUrl(bundle.slug),
          ...(updatedFleets ? { fleets: updatedFleets } : {}),
        },
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

            {bundle.status === 'published' && (
              <div className="space-y-1.5">
                {(bundle.fleets ?? (bundle.publishedUrl ? [{ name: '', url: bundle.publishedUrl }] : [])).map(({ name, url }) =>
                  url ? (
                    <div key={name} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0 overflow-hidden">
                        {name && <p className="text-xs font-medium mb-0.5">{name}</p>}
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono truncate block hover:underline"
                        >
                          {url}
                        </a>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => navigator.clipboard.writeText(url)}
                      >
                        Copy
                      </Button>
                    </div>
                  ) : null
                )}
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
  fleets,
  open,
  onClose,
}: {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
}) {
  const ftpServers = useLiveQuery(() => ftpServerRepo.list(), []);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [fleetPaths, setFleetPaths] = useState<string[]>(['']);
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  const isSingleDefault = fleets.length <= 1;

  // Reset state and pre-fill paths from series when dialog opens.
  useEffect(() => {
    if (!open) return;
    setUploadState('idle');
    const base = series.ftpPath ?? '';
    setFleetPaths(
      fleets.length === 0
        ? [base]
        : fleets.map((f) => fleetFtpPath(base, f.name, isSingleDefault)),
    );
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

  function setPath(index: number, value: string) {
    setFleetPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  async function handleUpload() {
    const serverId = parseInt(selectedServerId);
    const server = ftpServers?.find((s) => s.id === serverId);
    if (!server || fleetPaths.some((p) => !p.trim())) return;

    setUploadState('uploading');

    const fleetFiles = await buildFleetHtmlFiles(series.id);
    if (!fleetFiles) {
      setUploadState({ success: false, error: 'No results to upload.' });
      return;
    }

    for (let i = 0; i < fleetFiles.length; i++) {
      const path = (fleetPaths[i] ?? '').trim();
      if (!path) continue;
      const result = await uploadViaScupper({
        ftpHost: server.host,
        ftpPort: server.port,
        ftpUsername: server.username,
        ftpPassword: server.password,
        ftpPath: path,
        ftps: server.ftps,
        html: fleetFiles[i].html,
      });
      if (!result.ok) {
        setUploadState({ success: false, error: result.error });
        return;
      }
    }

    // Save the base path (strip fleet suffix from first fleet's path for multi-fleet)
    const savedPath = fleetFiles.length > 1 && fleetPaths[0]
      ? stripFleetSuffix(fleetPaths[0].trim(), fleetFiles[0].fleetName)
      : (fleetPaths[0] ?? '').trim();
    await db.series.update(series.id, { ftpHost: server.host, ftpPath: savedPath });
    setUploadState({ success: true });
  }

  const noServers = ftpServers !== undefined && ftpServers.length === 0;
  const uploading = uploadState === 'uploading';
  const succeeded = typeof uploadState === 'object' && uploadState.success;
  const canUpload = !!selectedServerId && fleetPaths.every((p) => p.trim()) && !uploading;

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
            {isSingleDefault ? (
              <div className="space-y-1.5">
                <Label htmlFor="ftp-path-0">Path</Label>
                <Input
                  id="ftp-path-0"
                  value={fleetPaths[0] ?? ''}
                  onChange={(e) => setPath(0, e.target.value)}
                  placeholder="/public_html/results/series.html"
                  autoFocus
                />
              </div>
            ) : (
              fleets.map((fleet, i) => (
                <div key={fleet.id} className="space-y-1.5">
                  <Label htmlFor={`ftp-path-${i}`}>{fleet.name} path</Label>
                  <Input
                    id={`ftp-path-${i}`}
                    value={fleetPaths[i] ?? ''}
                    onChange={(e) => setPath(i, e.target.value)}
                    placeholder={`/public_html/results/series-${seriesSlug(fleet.name)}.html`}
                    autoFocus={i === 0}
                  />
                </div>
              ))
            )}
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
              disabled={!canUpload}
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
  const fleets = useLiveQuery(
    () => fleetRepo.listBySeries(seriesId),
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
      // For single fleet, download immediately. For multi-fleet, 'x' is a no-op
      // (user must pick a fleet from the dropdown — browser blocks multi-download).
      if (isSingleFleet) exportFleetHtml(seriesId, fleets?.[0]?.name ?? '');
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
    fleets === undefined ||
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
  const { fleetStandings: fleetResults, circularRedressRaces } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    discardThresholds,
    series.dnfScoring ?? 'seriesEntries',
  );
  const discardCount = getDiscardCount(races.length, discardThresholds);
  const isSingleFleet = fleets.length <= 1;
  const fleetCountLabel = fleets.length > 1 ? ` · ${fleets.length} fleets` : '';

  return (
    <div className="space-y-4 overflow-x-auto">
      {circularRedressRaces.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Circular redress: two or more boats in{' '}
          {circularRedressRaces.map((n) => `Race ${n}`).join(', ')}{' '}
          have RDG assigned. Assign one result manually to resolve.
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races.length} race{races.length === 1 ? '' : 's'}{fleetCountLabel} · Low Point ·{' '}
          {discardCount > 0
            ? `${discardCount} discard${discardCount > 1 ? 's' : ''}`
            : 'No discards'}{' '}
          · {competitors.length} competitor{competitors.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowBilgeDialog(true)} title="Publish (p)">
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowFtpDialog(true)} title="Upload via FTP (f)">
            Upload via FTP
          </Button>
          {isSingleFleet ? (
            <Button size="sm" onClick={() => exportFleetHtml(seriesId, fleets[0]?.name ?? '')} title="Export HTML (x)">
              Export HTML
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">Export HTML ▾</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {fleets.map((fleet) => (
                  <DropdownMenuItem key={fleet.id} onClick={() => exportFleetHtml(seriesId, fleet.name)}>
                    {fleet.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {fleetResults.map(({ fleet, standings }) => {
        const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
        return (
          <div key={fleet.id} className="space-y-2">
            {!isSingleFleet && (
              <h3 className="text-sm font-semibold pt-2">{fleet.name}</h3>
            )}
            <FleetStandingsTable
              standings={standings}
              races={races}
              hasDiscards={hasDiscards}
            />
          </div>
        );
      })}

      <BilgePublishDialog
        series={series}
        fleets={fleets}
        open={showBilgeDialog}
        onClose={() => setShowBilgeDialog(false)}
      />
      <FtpUploadDialog
        series={series}
        fleets={fleets}
        open={showFtpDialog}
        onClose={() => setShowFtpDialog(false)}
      />
    </div>
  );
}

function FleetStandingsTable({
  standings,
  races,
  hasDiscards,
}: {
  standings: Standing[];
  races: { id: string; raceNumber: number }[];
  hasDiscards: boolean;
}) {
  return (
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
  const { rank, competitor, racePoints, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable } = standing;

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
        const isNonDiscardable = raceNonDiscardable[i] ?? false;
        const code = raceCodes[i];
        const penaltyCode = racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = racePenaltyOverrides?.[i] ?? null;
        const isRedress = raceRedressFlags?.[i] ?? false;
        const penaltyLabel = penaltyCode
          ? penaltyOverride !== null
            ? penaltyCode === 'DPI'
              ? `${penaltyCode}(${penaltyOverride}pts)`
              : `${penaltyCode}(${penaltyOverride}%)`
            : penaltyCode
          : null;
        return (
          <TableCell
            key={i}
            className={cn(
              'text-center tabular-nums',
              isDiscard && 'line-through text-muted-foreground',
            )}
          >
            {isRedress ? (
              <span className="text-xs text-amber-600 dark:text-amber-400" title="Redress given (RDG)">
                {points}<sup>r</sup>
              </span>
            ) : code !== null ? (
              <span
                className={cn(
                  'text-xs',
                  isNonDiscardable
                    ? 'text-destructive font-semibold'
                    : !isDiscard && 'text-muted-foreground',
                )}
                title={isNonDiscardable ? `${code} — cannot be discarded` : undefined}
              >
                {points}
                <span className="ml-0.5">({code})</span>
              </span>
            ) : penaltyLabel !== null ? (
              <span className="text-xs text-amber-600 dark:text-amber-400" title={`${penaltyCode} penalty applied`}>
                {points}
                <span className="ml-0.5">({penaltyLabel})</span>
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
