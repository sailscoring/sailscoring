'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getPublication, publishSeries } from '@/lib/api-repository';
import type { PublishResult, Series } from '@/lib/types';

type PublishState = 'loading' | 'idle' | 'publishing' | { error: string };

export interface PublishDialogProps {
  series: Series;
  open: boolean;
  onClose: () => void;
}

/**
 * In-app results publishing (ADR-008 Phase 9, the bilge replacement). Publish
 * is an explicit, point-in-time action: the server renders the current
 * standings, stores them, and returns the public `/p/{slug}` URL(s). Editing
 * the series afterwards does not auto-publish — the dialog surfaces how many
 * edits have landed since the last publish so the scorer knows to re-publish.
 */
export function PublishDialog({ series, open, onClose }: PublishDialogProps) {
  const [state, setState] = useState<PublishState>('loading');
  const [published, setPublished] = useState<PublishResult | null>(null);

  // Load the current publication each time the dialog opens. Syncing with the
  // external open signal, so the state writes in this effect are expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState('loading');
    getPublication(series.id)
      .then((p) => {
        if (cancelled) return;
        setPublished(p);
        setState('idle');
      })
      .catch(() => {
        if (!cancelled) setState('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [open, series.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handlePublish() {
    setState('publishing');
    try {
      const result = await publishSeries(series.id);
      setPublished(result);
      setState('idle');
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Publish failed.' });
    }
  }

  const isLoading = state === 'loading';
  const isPublishing = state === 'publishing';
  const hasError = typeof state === 'object';
  const pendingEdits = published
    ? Math.max(0, (series.version ?? 1) - published.publishedVersion)
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : published ? (
          <div className="space-y-3 min-w-0">
            <p className="text-xs text-muted-foreground">
              Last published {new Date(published.publishedAt).toLocaleString()}
              {pendingEdits > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {' · '}
                  {pendingEdits} edit{pendingEdits === 1 ? '' : 's'} since — re-publish to update
                </span>
              )}
            </p>
            <div className="space-y-1.5">
              {published.pages.map((p) => (
                <div key={p.url} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {published.pages.length > 1 && (
                      <p className="text-xs font-medium mb-0.5">{p.fleetName}</p>
                    )}
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono truncate block hover:underline"
                    >
                      {p.url}
                    </a>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => navigator.clipboard.writeText(p.url)}
                  >
                    Copy
                  </Button>
                </div>
              ))}
            </div>
            {hasError && (
              <p className="text-sm text-destructive">{(state as { error: string }).error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Publish this series&rsquo; current standings to a public web page.
              You can re-publish any time to update it.
            </p>
            {hasError && (
              <p className="text-sm text-destructive">{(state as { error: string }).error}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handlePublish} disabled={isLoading || isPublishing}>
            {isPublishing ? 'Publishing…' : published ? 'Re-publish' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
