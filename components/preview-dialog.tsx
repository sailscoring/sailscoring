'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import * as repos from '@/lib/api-repository';
import { buildFleetHtmlFiles, fleetHtmlFilename, triggerDownload } from '@/lib/results-export';
import type { Fleet, Series } from '@/lib/types';

type FleetHtmlFile = { fleetName: string; isDefault: boolean; html: string };

export interface PreviewDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
  /** Hand off to the Publish flow (parent closes this and opens PublishDialog).
   *  Omit when the viewer can't publish — the Publish button is hidden. */
  onPublish?: () => void;
}

/**
 * In-app preview of the published results page (#163). Renders exactly what
 * Publish / FTP / Download would produce — `buildFleetHtmlFiles` is the shared
 * source of truth — in an `<iframe srcdoc>`. Client-side only: builds on open,
 * uploads nothing. The Download button serves the in-memory build (no rebuild);
 * Publish hands off to the PublishDialog.
 */
export function PreviewDialog({ series, fleets, open, onClose, onPublish }: PreviewDialogProps) {
  const [files, setFiles] = useState<FleetHtmlFile[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'idle' | 'error'>('loading');

  // Rebuild each time the dialog opens so the preview reflects the latest
  // edits. Syncing with the external open signal, so the writes are expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setFiles(null);
    setSelected(0);
    buildFleetHtmlFiles(repos, series.id)
      .then((built) => {
        if (cancelled) return;
        setFiles(built);
        setPhase(built && built.length > 0 ? 'idle' : 'error');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, series.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const current = files?.[selected] ?? null;

  // Render via a blob URL rather than `srcdoc`. A srcdoc document inherits its
  // base URL from the embedding app page, so the results' in-page race-column
  // links (`href="#r1"`) would resolve against the app URL and navigate the
  // frame back into the app instead of scrolling. A blob URL gives the frame
  // its own document URL, so fragment links stay inside the preview.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  // Object-URL lifecycle is an external resource the effect owns, so the
  // setState here is the intended synchronisation (and needs revoke cleanup,
  // which useMemo can't do).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!current) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([current.html], { type: 'text/html' }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [current]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[90vh] max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl flex-col sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle>Preview results</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          {files && files.length > 1 && (
            <Select value={String(selected)} onValueChange={(v) => setSelected(Number(v))}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {files.map((f, i) => (
                  <SelectItem key={f.fleetName} value={String(i)}>
                    {f.fleetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!current}
              onClick={() => current && triggerDownload(fleetHtmlFilename(series.name, current), current.html)}
            >
              Download
            </Button>
            {onPublish && (
              <Button size="sm" onClick={onPublish}>
                Publish
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-white">
          {phase === 'loading' && (
            <p className="p-4 text-sm text-muted-foreground">Building preview…</p>
          )}
          {phase === 'error' && (
            <p className="p-4 text-sm text-muted-foreground">
              Nothing to preview yet — add competitors and race results first.
            </p>
          )}
          {phase === 'idle' && current && blobUrl && (
            <iframe
              title="Results preview"
              src={blobUrl}
              className="h-full w-full"
              // Not sandboxed: this is the exact self-contained, script-free
              // artifact we already serve publicly (renderSeriesHtml escapes
              // user fields), so embedding it carries no extra risk — and an
              // un-sandboxed frame keeps the footer "Open in Sail Scoring" link
              // working.
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
