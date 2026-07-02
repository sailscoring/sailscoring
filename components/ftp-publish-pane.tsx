'use client';

import { useEffect, useState } from 'react';
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
import { useUpdateSeries } from '@/hooks/use-series';
import { useFtpServers } from '@/hooks/use-ftp-servers';
import { uploadViaScupper } from '@/lib/scupper';
import {
  buildFleetHtmlFiles,
  derivePrefillPaths,
  fleetFtpPath,
  seriesSlug,
} from '@/lib/results-export';
import type { Fleet, Series } from '@/lib/types';

type UploadState =
  | 'idle'
  | 'uploading'
  | { success: true }
  | { success: false; error: string };

export interface FtpPublishPaneProps {
  series: Series;
  fleets: Fleet[];
  onClose: () => void;
}

/**
 * The FTP destination of the Publish dialog: upload the rendered results HTML
 * to a club's own web server (via the scupper relay). Rendered inside the
 * shared Publish dialog shell when the series is in `ftp` publish mode, so it
 * owns its own body + footer but no Dialog wrapper. Since it mounts only while
 * FTP mode is active, it seeds its per-fleet paths on mount rather than on an
 * external open signal.
 */
export function FtpPublishPane({ series, fleets, onClose }: FtpPublishPaneProps) {
  const updateSeries = useUpdateSeries();
  const { data: ftpServers } = useFtpServers();
  const [selectedServerId, setSelectedServerId] = useState('');
  const [fleetPaths, setFleetPaths] = useState<string[]>(() =>
    derivePrefillPaths(fleets, series.ftpPaths, series.ftpPath ?? '', fleets.length <= 1),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(fleets.map((f) => f.id)),
  );
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  const isSingleDefault = fleets.length <= 1;

  // Auto-select the server whose host matches the series' saved ftpHost, once
  // the server list resolves.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!ftpServers) return;
    if (series.ftpHost) {
      const match = ftpServers.find((s) => s.host === series.ftpHost);
      setSelectedServerId(match?.id ?? '');
    } else {
      setSelectedServerId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ftpServers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setPath(index: number, value: string) {
    setFleetPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  const allSelected = fleets.length > 0 && fleets.every((f) => selected.has(f.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(fleets.map((f) => f.id)));
  }

  async function handleUpload() {
    const server = ftpServers?.find((s) => s.id === selectedServerId);
    if (!server) return;
    // A selected fleet must have a path; unticked fleets are skipped and don't
    // block the upload. Single-fleet series have no selection UI — the lone
    // path standing in for the whole thing.
    if (isSingleDefault) {
      if (!(fleetPaths[0] ?? '').trim()) return;
    } else {
      const anySelected = fleets.some((f) => selected.has(f.id));
      const selectedHavePaths = fleets.every(
        (f, i) => !selected.has(f.id) || (fleetPaths[i] ?? '').trim(),
      );
      if (!anySelected || !selectedHavePaths) return;
    }

    setUploadState('uploading');

    const fleetFiles = await buildFleetHtmlFiles(repos, series.id);
    if (!fleetFiles) {
      setUploadState({ success: false, error: 'No results to upload.' });
      return;
    }

    // Match each file back to its fleet by name (the path inputs are per
    // fleet, in fleet order). A series with sub-series yields several files
    // per fleet; each block's page goes to the fleet's configured path with
    // a block suffix before the extension (frostbites.html →
    // frostbites-winter.html).
    const fleetByName = new Map(fleets.map((f) => [f.name, f]));
    const pathByFleetName = new Map(
      fleets.map((f, i) => [f.name, (fleetPaths[i] ?? '').trim()]),
    );

    const uploadedPaths: Record<string, string> = {};
    for (const file of fleetFiles) {
      // Skip fleets the scorer unticked — they keep their prior published page
      // and their saved path (persistence below merges, never overwrites).
      if (!isSingleDefault) {
        const fleet = fleetByName.get(file.fleetName);
        if (!fleet || !selected.has(fleet.id)) continue;
      }
      const basePath =
        pathByFleetName.get(file.fleetName) ?? (fleetPaths[0] ?? '').trim();
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
      const fleet = fleetByName.get(file.fleetName);
      if (fleet) uploadedPaths[fleet.id] = basePath;
    }

    // Persist verbatim per-fleet paths so the next dialog open reproduces
    // exactly what the user typed (#131). Merge into existing ftpPaths so
    // fleets that weren't uploaded this round retain their prior entry —
    // merging into the freshest row, not the prop, so an in-flight save's
    // entries survive.
    await updateSeries.mutateAsync({
      id: series.id,
      patch: (current) => ({
        ftpHost: server.host,
        ftpPaths: { ...(current.ftpPaths ?? {}), ...uploadedPaths },
      }),
    });
    setUploadState({ success: true });
  }

  const noServers = ftpServers !== undefined && ftpServers.length === 0;
  const uploading = uploadState === 'uploading';
  const succeeded = typeof uploadState === 'object' && uploadState.success;
  const canUpload =
    !!selectedServerId &&
    !uploading &&
    (isSingleDefault
      ? !!(fleetPaths[0] ?? '').trim()
      : fleets.some((f) => selected.has(f.id)) &&
        fleets.every((f, i) => !selected.has(f.id) || !!(fleetPaths[i] ?? '').trim()));

  return (
    <>
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
            <Select value={selectedServerId} onValueChange={setSelectedServerId}>
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
            <>
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 shrink-0"
                />
                All fleets
              </label>
              {fleets.map((fleet, i) => {
                const checked = selected.has(fleet.id);
                return (
                  <div
                    key={fleet.id}
                    className={`space-y-1.5 ${checked ? '' : 'opacity-50'}`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(fleet.id)}
                        className="h-4 w-4 shrink-0"
                        aria-label={`Upload ${fleet.name}`}
                      />
                      <Label htmlFor={`ftp-path-${i}`}>{fleet.name} path</Label>
                    </div>
                    <Input
                      id={`ftp-path-${i}`}
                      value={fleetPaths[i] ?? ''}
                      onChange={(e) => setPath(i, e.target.value)}
                      placeholder={`/public_html/results/series-${seriesSlug(fleet.name)}.html`}
                      autoFocus={i === 0}
                      disabled={!checked}
                    />
                  </div>
                );
              })}
            </>
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
    </>
  );
}
