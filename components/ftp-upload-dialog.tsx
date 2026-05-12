'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { useRepos } from '@/lib/repos';
import { useUpdateSeries } from '@/hooks/use-series';
import { useFtpServers } from '@/hooks/use-ftp-servers';
import { uploadViaScupper } from '@/lib/scupper';
import {
  buildFleetHtmlFiles,
  derivePrefillPaths,
  seriesSlug,
} from '@/lib/results-export';
import type { Fleet, Series } from '@/lib/types';

type UploadState =
  | 'idle'
  | 'uploading'
  | { success: true }
  | { success: false; error: string };

export interface FtpUploadDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
}

export function FtpUploadDialog({
  series,
  fleets,
  open,
  onClose,
}: FtpUploadDialogProps) {
  const repos = useRepos();
  const updateSeries = useUpdateSeries();
  const { data: ftpServers } = useFtpServers();
  const [selectedServerId, setSelectedServerId] = useState('');
  const [fleetPaths, setFleetPaths] = useState<string[]>(['']);
  const [uploadState, setUploadState] = useState<UploadState>('idle');

  const isSingleDefault = fleets.length <= 1;

  // Reset state and pre-fill paths from series when dialog opens. Syncs with
  // an external signal (parent-controlled `open`), so setState-in-effect is
  // expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setUploadState('idle');
    setFleetPaths(
      derivePrefillPaths(fleets, series.ftpPaths, series.ftpPath ?? '', isSingleDefault),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-select the server whose host matches the series' saved ftpHost.
  useEffect(() => {
    if (!open || !ftpServers) return;
    if (series.ftpHost) {
      const match = ftpServers.find((s) => s.host === series.ftpHost);
      setSelectedServerId(match?.id ?? '');
    } else {
      setSelectedServerId('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ftpServers]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setPath(index: number, value: string) {
    setFleetPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  async function handleUpload() {
    const server = ftpServers?.find((s) => s.id === selectedServerId);
    if (!server || fleetPaths.some((p) => !p.trim())) return;

    setUploadState('uploading');

    const fleetFiles = await buildFleetHtmlFiles(repos, series.id);
    if (!fleetFiles) {
      setUploadState({ success: false, error: 'No results to upload.' });
      return;
    }

    // Match each fleetFile back to its fleet id by name. buildFleetHtmlFiles
    // returns one entry per fleet in fleet order, so the indices align — but
    // be explicit so a future refactor that drops empty fleets stays correct.
    const fleetByName = new Map(fleets.map((f) => [f.name, f]));

    const uploadedPaths: Record<string, string> = {};
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
      const fleet = fleetByName.get(fleetFiles[i].fleetName);
      if (fleet) uploadedPaths[fleet.id] = path;
    }

    // Persist verbatim per-fleet paths so the next dialog open reproduces
    // exactly what the user typed (#131). Merge into existing ftpPaths so
    // fleets that weren't uploaded this round retain their prior entry.
    const mergedPaths = { ...(series.ftpPaths ?? {}), ...uploadedPaths };
    await updateSeries.mutateAsync({
      id: series.id,
      patch: { ftpHost: server.host, ftpPaths: mergedPaths },
    });
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
