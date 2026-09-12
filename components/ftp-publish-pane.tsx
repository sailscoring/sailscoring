'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { DialogFooter } from '@/components/ui/dialog';
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
import * as repos from '@/lib/api-repository';
import { useRecordFtpUpload, useUpdateSeriesPublishPrefs } from '@/hooks/use-series';
import { useFtpServers } from '@/hooks/use-ftp-servers';
import { useFeatures } from '@/components/features-provider';
import { uploadViaScupper } from '@/lib/scupper';
import { relativeSubPath } from '@/lib/publishing';
import { resolveFtpPageSelection, resolveFtpServerId } from '@/lib/ftp-publish';
import {
  CHAMPIONSHIP_PAGE,
  RACE_RESULTS_PAGE,
  type PublishPage,
} from '@/lib/publish-pages';
import {
  buildFleetHtmlFiles,
  derivePrefillPaths,
  fleetFtpPath,
  seriesSlug,
} from '@/lib/results-export';
import type { Series } from '@/lib/types';

type UploadState =
  | 'idle'
  | 'uploading'
  | { success: true; count: number; unplaced: string[] }
  | { success: false; error: string };

/** Whether two tick sets hold the same pages — lets the re-seed below leave
 *  state untouched when it recomputes the same answer. */
function sameKeys(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k));
}

export interface FtpPublishPaneProps {
  series: Series;
  /** The pages this series publishes — the same list the Sail Scoring pane
   *  lists, handed down so the two destinations cannot drift apart. */
  pages: PublishPage[];
  /** What the dialog calls the lone default page, when there is one. */
  lonePageLabel: string;
  onClose: () => void;
}

/**
 * The FTP destination of the Publish dialog: upload the rendered results HTML
 * to a club's own web server (via the scupper relay). Rendered inside the
 * shared Publish dialog shell when the series is in `ftp` publish mode, so it
 * owns its own body + footer but no Dialog wrapper. Since it mounts only while
 * FTP mode is active, it seeds its per-page paths on mount rather than on an
 * external open signal.
 *
 * One row per published page — a fleet's results, a combined page, a
 * championship's standings, the prize sheet, the entry list — each with the
 * remote path it goes to. The destination is all this pane decides: which
 * pages exist is `resolvePublishPages`' answer, shared with the in-app
 * destination and with the build.
 */
export function FtpPublishPane({ series, pages, lonePageLabel, onClose }: FtpPublishPaneProps) {
  const updatePublishPrefs = useUpdateSeriesPublishPrefs();
  const recordUpload = useRecordFtpUpload();
  const { data: ftpServers } = useFtpServers();
  const { has } = useFeatures();
  const [selectedServerId, setSelectedServerId] = useState('');
  const [paths, setPaths] = useState<Record<string, string>>(() =>
    derivePrefillPaths(pages, series.ftpPaths, series.ftpPath ?? ''),
  );
  const [selected, setSelected] = useState<Set<string>>(() =>
    resolveFtpPageSelection(pages, series.ftpPaths, series.ftpPagesExcluded),
  );
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  // A series with one page has nothing to choose between: the lone path is
  // the upload, with no tick box to leave it out of.
  const isSinglePage = pages.length <= 1;

  // Open on the server the series remembers, once the server list resolves.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ftpServers) return;
    setSelectedServerId(resolveFtpServerId(ftpServers, series));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftpServers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // `pages` waits on the sub-series and split-fleet state, so it can arrive
  // incomplete and grow while the pane is open. Re-seed from the series until
  // the scorer touches a tick box: a seed taken against half the list ticks
  // pages the record says to leave back, and pages that show up afterwards
  // would otherwise sit unticked with a disabled path box, indistinguishable
  // from a deliberate untick.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    const ticked = resolveFtpPageSelection(pages, series.ftpPaths, series.ftpPagesExcluded);
    setSelected((prev) => (sameKeys(prev, ticked) ? prev : ticked));
    // Their paths with them, without disturbing anything already typed.
    setPaths((prev) => ({
      ...derivePrefillPaths(pages, series.ftpPaths, series.ftpPath ?? ''),
      ...prev,
    }));
  }, [pages, series.ftpPaths, series.ftpPath, series.ftpPagesExcluded]);

  /** Picking a server remembers it there and then. Waiting for a successful
   *  upload to record the choice loses it whenever the upload doesn't finish
   *  — and never records it at all on a series whose paths were filled in
   *  some other way. The host rides along as the cross-workspace fallback.
   *  Fire-and-forget like the destination toggle, and through the same
   *  publish-prefs write: choosing where results will go is not an edit to
   *  the series. */
  function pickServer(id: string) {
    setSelectedServerId(id);
    const server = ftpServers?.find((s) => s.id === id);
    if (!server) return;
    updatePublishPrefs.mutate({
      id: series.id,
      prefs: { ftpServerId: server.id, ftpHost: server.host },
    });
  }

  function setPath(key: string, value: string) {
    setPaths((prev) => ({ ...prev, [key]: value }));
  }

  const allSelected = pages.length > 0 && pages.every((p) => selected.has(p.key));

  function toggle(key: string) {
    touched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    touched.current = true;
    setSelected(allSelected ? new Set() : new Set(pages.map((p) => p.key)));
  }

  /** The path a page will be uploaded to, trimmed as typed. */
  const pathFor = (page: PublishPage): string => (paths[page.key] ?? '').trim();

  /** Pages going out this round: ticked (or the lone page), with a path. */
  const uploading = isSinglePage
    ? pages.filter((p) => pathFor(p))
    : pages.filter((p) => selected.has(p.key) && pathFor(p));

  async function handleUpload() {
    const server = ftpServers?.find((s) => s.id === selectedServerId);
    if (!server) return;
    // A page ticked with no path blocks the upload rather than going out
    // somewhere unintended; unticked pages are skipped and block nothing.
    if (isSinglePage) {
      if (uploading.length === 0) return;
    } else {
      const ticked = pages.filter((p) => selected.has(p.key));
      if (ticked.length === 0 || ticked.some((p) => !pathFor(p))) return;
    }

    setUploadState('uploading');

    // Pages bound for a club site reference the published data file when the
    // series has one (ADR-012) — the payload stops taxing club-site viewers
    // too. A never-published series stays self-contained, as does one whose
    // publication carries no data file.
    const status = await repos.getPublication(series.id).catch(() => null);
    const dataUrl = status?.published?.dataUrl;
    // A championship's standings page deep-links its race results, which this
    // destination knows the address of: both paths are right here.
    const championshipPath = pages.find((p) => p.name === CHAMPIONSHIP_PAGE);
    const raceResultsPage = pages.find((p) => p.name === RACE_RESULTS_PAGE);
    const raceResultsHref =
      championshipPath && raceResultsPage && pathFor(championshipPath) && pathFor(raceResultsPage)
        ? relativeSubPath(pathFor(championshipPath), pathFor(raceResultsPage))
        : undefined;
    const build = await buildFleetHtmlFiles(
      repos,
      series.id,
      undefined,
      {
        // The same pages, with the same content, as the in-app destination:
        // the workspace's features decide, not where the HTML is going.
        includePrizes: has('prizes'),
        includeEntryList: has('entry-list'),
        includeTrackData: has('racesense-import'),
        includePageNotes: has('page-notes'),
        ...(raceResultsHref ? { raceResultsHref } : {}),
        ...(dataUrl ? { dataPath: new URL(dataUrl).pathname } : {}),
      },
    );
    if (!build) {
      setUploadState({ success: false, error: 'No results to upload.' });
      return;
    }

    // Match each built file to its page by name — the same key the in-app
    // publication stores its pages under. A series with sub-series yields
    // several files per page; each block's page goes to the page's configured
    // path with a block suffix before the extension (frostbites.html →
    // frostbites-winter.html).
    const pageByName = new Map(pages.map((p) => [p.name, p]));
    const uploadedPaths: Record<string, string> = {};
    const unplaced = new Set<string>();
    let uploaded = 0;
    for (const file of build.files) {
      const page = pageByName.get(file.fleetName);
      // A page nobody offered a path for — the synthetic "Unknown" fleet of a
      // series whose competitors are in no fleet. Reported below rather than
      // dropped in silence.
      if (!page) {
        unplaced.add(file.fleetName);
        continue;
      }
      // Skip pages the scorer unticked — they keep their prior uploaded page
      // and their saved path (persistence below merges, never overwrites).
      if (!isSinglePage && !selected.has(page.key)) continue;
      const basePath = pathFor(page);
      if (!basePath) continue;
      const path = file.subSeriesName
        ? fleetFtpPath(basePath, file.subSeriesName, false)
        : basePath;
      const result = await uploadViaScupper({
        ftpHost: server.host,
        ftpPort: server.port,
        ftpUsername: server.username,
        ftpPassword: server.password,
        ftpPath: path,
        ftps: server.ftps,
        html: file.html,
      });
      if (!result.ok) {
        setUploadState({ success: false, error: result.error });
        return;
      }
      uploaded += 1;
      uploadedPaths[page.key] = basePath;
    }

    if (uploaded === 0) {
      // Every page was either unticked or produced nothing — say so, rather
      // than reporting an upload that put no file on the server.
      setUploadState({
        success: false,
        error:
          unplaced.size > 0
            ? `Nothing was uploaded — no path is configured for ${[...unplaced].join(', ')}.`
            : 'Nothing was uploaded — no page selected here has results yet.',
      });
      return;
    }

    // Report the upload to the server, which is the only account of it there
    // will be: the scupper call above ran here in the browser, so nothing
    // server-side witnessed it. That record is both halves — the verbatim
    // per-page paths, so the next dialog open reproduces exactly what was
    // typed, and the publishing entry, so the History tab shows when
    // results last went out to the club and offers the state that went.
    //
    // Merging the paths and stamping the version are the server's job: it
    // holds the freshest row. The files are already on the club's server, so
    // a rejected write must report that the record didn't stick rather than
    // leave the dialog sitting on "Uploading…".
    try {
      await recordUpload.mutateAsync({
        id: series.id,
        serverId: server.id,
        host: server.host,
        paths: uploadedPaths,
        // What the scorer left out this round, so the next open leaves it out
        // too. Replaced rather than merged: this is the tick state as it
        // stood, and a page that isn't listed here no longer exists.
        excluded: isSinglePage
          ? []
          : pages.filter((p) => !selected.has(p.key)).map((p) => p.key),
        pageCount: uploaded,
      });
    } catch {
      setUploadState({
        success: false,
        error:
          `Uploaded ${uploaded} page${uploaded === 1 ? '' : 's'}, but couldn't record it ` +
          'on the series — the paths and server here were not saved.',
      });
      return;
    }
    setUploadState({ success: true, count: uploaded, unplaced: [...unplaced] });
  }

  // Edits landed since the last successful upload — mirrors the in-app
  // publish indicator (series.version − the version that upload reflected).
  const pendingEdits =
    series.ftpLastUploadedAt != null
      ? Math.max(0, (series.version ?? 1) - (series.ftpUploadedVersion ?? (series.version ?? 1)))
      : 0;

  const noServers = ftpServers !== undefined && ftpServers.length === 0;
  const inFlight = uploadState === 'uploading';
  const succeeded = typeof uploadState === 'object' && uploadState.success;
  const canUpload =
    !!selectedServerId &&
    !inFlight &&
    (isSinglePage
      ? uploading.length > 0
      : pages.some((p) => selected.has(p.key)) &&
        pages.every((p) => !selected.has(p.key) || !!pathFor(p)));

  /** What a page is called in this pane: the lone default page takes the
   *  dialog's own label for it, since its fleet name is often synthetic. */
  const labelFor = (page: PublishPage): string =>
    page.isDefault && page.kind === 'fleet' ? lonePageLabel : page.name;

  return (
    <>
      {series.ftpLastUploadedAt != null && (
        <p className="text-xs text-muted-foreground">
          Last uploaded {new Date(series.ftpLastUploadedAt).toLocaleString()}
          {pendingEdits > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {' · '}
              {pendingEdits} edit{pendingEdits === 1 ? '' : 's'} since — re-upload to update
            </span>
          )}
        </p>
      )}
      {noServers ? (
        <p className="text-sm text-muted-foreground">
          No FTP servers configured.{' '}
          <Link href="/workspace" className="underline" onClick={onClose}>
            Add one in Workspace Settings.
          </Link>
        </p>
      ) : (
        <form id="ftp-upload-form" onSubmit={(e) => { e.preventDefault(); handleUpload(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Server</Label>
            <Select value={selectedServerId} onValueChange={pickServer}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a server…" />
              </SelectTrigger>
              <SelectContent>
                {ftpServers?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.ftps ? 'ftps' : 'ftp'}://{s.host}:{s.port}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isSinglePage ? (
            <div className="space-y-1.5">
              <Label htmlFor="ftp-path-0">Path</Label>
              <Input
                id="ftp-path-0"
                value={pages[0] ? (paths[pages[0].key] ?? '') : ''}
                onChange={(e) => pages[0] && setPath(pages[0].key, e.target.value)}
                placeholder="/public_html/results/series.html"
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-1">
              {/* One line per page — checkbox · name · path — mirroring the
                  Sail Scoring destination's page list. */}
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground pb-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 shrink-0"
                  aria-label="All pages"
                />
                <span className="flex-1">Page</span>
                <span>Path</span>
              </label>
              <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                {pages.map((page) => {
                  const checked = selected.has(page.key);
                  const label = labelFor(page);
                  return (
                    <div
                      key={page.key}
                      className={`flex items-center gap-2 ${checked ? '' : 'opacity-50'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(page.key)}
                        className="h-4 w-4 shrink-0"
                        aria-label={`Upload ${label}`}
                      />
                      <span className="w-36 shrink-0 truncate text-sm" title={label}>
                        {label}
                      </span>
                      <Input
                        value={paths[page.key] ?? ''}
                        onChange={(e) => setPath(page.key, e.target.value)}
                        placeholder={`/public_html/results/series-${seriesSlug(page.name)}.html`}
                        disabled={!checked}
                        aria-label={`${label} path`}
                        className="flex-1 min-w-0 h-7 text-xs font-mono"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {typeof uploadState === 'object' && uploadState.success && (
            <p className="text-sm text-green-600 dark:text-green-400">
              Uploaded {uploadState.count} page{uploadState.count === 1 ? '' : 's'}.
              {uploadState.unplaced.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' '}
                  {uploadState.unplaced.join(', ')} had no path here and stayed behind.
                </span>
              )}
            </p>
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
            {inFlight ? 'Uploading…' : 'Upload'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
