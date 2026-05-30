'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { ValidationApiError } from '@/lib/api-client';
import {
  getPublication,
  publishSeries,
  unpublishSeries,
} from '@/lib/api-repository';
import { fleetSubPath } from '@/lib/publishing';
import type { Fleet, PublicationStatus, Series } from '@/lib/types';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

export interface PublishDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
}

/** Sanitise free-typed slug input to the allowed character set. */
function sanitizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Join names as `A`, `A and B`, or `A, B and C` for prose. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return 'another series';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * In-app results publishing (ADR-008 Phase 9/10, the bilge replacement — #153).
 * Publish is explicit and point-in-time. The slug is editable at first publish
 * and frozen after; the dialog shows the resulting public URL(s) as you edit
 * it, so you see where it'll land before publishing.
 */
export function PublishDialog({ series, fleets, open, onClose }: PublishDialogProps) {
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [slug, setSlug] = useState('');
  const [phase, setPhase] = useState<
    'loading' | 'idle' | 'publishing' | 'unpublishing'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);

  // Load publication state each time the dialog opens. Syncing with the
  // external open signal, so the state writes here are expected.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setNeedsJoin(false);
    getPublication(series.id)
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setSlug(s.published?.slug ?? s.suggestedSlug);
        setPhase('idle');
      })
      .catch(() => {
        if (!cancelled) setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [open, series.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const published = status?.published ?? null;
  const isPublished = published !== null;
  const workspaceSlug = status?.workspaceSlug ?? '';

  // Per-fleet URLs. Once published, the server's actual URLs; before that, a
  // live preview derived from the fleets and the slug being typed.
  const previewPages = useMemo(() => {
    if (published) return published.pages;
    const base = `${APP_URL}/p/${workspaceSlug}/${slug || '…'}`;
    const isSingleDefault = fleets.length <= 1;
    const entries = isSingleDefault
      ? [{ fleetName: fleets[0]?.name ?? 'Standings', subPath: 'standings' }]
      : fleets.map((f) => ({ fleetName: f.name, subPath: fleetSubPath(f.name, false) }));
    return entries.map((e) => ({ fleetName: e.fleetName, url: `${base}/${e.subPath}` }));
  }, [published, fleets, workspaceSlug, slug]);

  const pendingEdits = published
    ? Math.max(0, (series.version ?? 1) - published.publishedVersion)
    : 0;

  async function handlePublish(join = false) {
    setPhase('publishing');
    setError(null);
    try {
      const result = await publishSeries(
        series.id,
        isPublished ? {} : { slug, join },
      );
      setStatus((s) => (s ? { ...s, published: result } : s));
      setNeedsJoin(false);
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      if (e instanceof ValidationApiError) {
        const issues = e.issues as
          | { code?: string; sharedWith?: string[]; fleetName?: string }
          | undefined;
        if (issues?.code === 'slug-shared') {
          setNeedsJoin(true);
          const names = issues.sharedWith ?? [];
          setError(
            `This URL already has results from ${formatNameList(names)}. Publish “${series.name}” alongside them?`,
          );
          return;
        }
        if (issues?.code === 'subpath-collision') {
          setNeedsJoin(false);
          setError(
            issues.fleetName
              ? `The fleet “${issues.fleetName}” clashes with one already published at this URL. Rename it, then try again.`
              : 'A fleet clashes with one already published at this URL. Rename it, then try again.',
          );
          return;
        }
        if (issues?.code === 'invalid-slug') {
          setError('Use lowercase letters and numbers, separated by hyphens.');
          return;
        }
      }
      setError(e instanceof Error ? e.message : 'Publish failed.');
    }
  }

  async function handleUnpublish() {
    if (
      !confirm(
        `Unpublish "${series.name}"? The public page will stop working and its URL frees up.`,
      )
    ) {
      return;
    }
    setPhase('unpublishing');
    setError(null);
    try {
      await unpublishSeries(series.id);
      // Back to the first-publish state: the slug input returns, pre-filled
      // with the suggestion, so re-publishing is a click away.
      setStatus((s) => (s ? { ...s, published: null } : s));
      setSlug(status?.suggestedSlug ?? '');
      setPhase('idle');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : 'Unpublish failed.');
    }
  }

  const isLoading = phase === 'loading';
  const isPublishing = phase === 'publishing';
  const isUnpublishing = phase === 'unpublishing';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Publish results</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3 min-w-0">
            {isPublished ? (
              <p className="text-xs text-muted-foreground">
                Last published {new Date(published.publishedAt).toLocaleString()}
                {pendingEdits > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {' · '}
                    {pendingEdits} edit{pendingEdits === 1 ? '' : 's'} since — re-publish to update
                  </span>
                )}
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="publish-slug">URL slug</Label>
                <Input
                  id="publish-slug"
                  value={slug}
                  onChange={(e) => { setSlug(sanitizeSlug(e.target.value)); setNeedsJoin(false); setError(null); }}
                  placeholder="autumn-league-2026"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Published under <span className="font-mono">/p/{workspaceSlug}/{slug || '…'}</span>. Fixed once published.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              {previewPages.map((p) => (
                <div key={p.url} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 overflow-hidden">
                    {previewPages.length > 1 && (
                      <p className="text-xs font-medium mb-0.5">{p.fleetName}</p>
                    )}
                    {/* direction: rtl makes the ellipsis clip the (shared) start of
                        the URL and keep the distinguishing end (slug/fleet) visible;
                        text-align: left keeps it left-aligned when it fits. The URL is
                        a single LTR run so its character order is unaffected. */}
                    {isPublished ? (
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        title={p.url}
                        className="text-xs font-mono truncate block hover:underline"
                        style={{ direction: 'rtl', textAlign: 'left' }}
                      >
                        {p.url}
                      </a>
                    ) : (
                      <span
                        title={p.url}
                        className="text-xs font-mono truncate block text-muted-foreground"
                        style={{ direction: 'rtl', textAlign: 'left' }}
                      >
                        {p.url}
                      </span>
                    )}
                  </div>
                  {isPublished && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigator.clipboard.writeText(p.url)}>
                      Copy
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {isPublished && !needsJoin && (
            <Button
              variant="destructive"
              onClick={handleUnpublish}
              disabled={isPublishing || isUnpublishing}
            >
              {isUnpublishing ? 'Unpublishing…' : 'Unpublish'}
            </Button>
          )}
          {needsJoin ? (
            <Button onClick={() => handlePublish(true)} disabled={isPublishing}>
              {isPublishing ? 'Publishing…' : 'Publish into existing event'}
            </Button>
          ) : (
            <Button onClick={() => handlePublish(false)} disabled={isLoading || isPublishing || isUnpublishing || (!isPublished && !slug)}>
              {isPublishing ? 'Publishing…' : isPublished ? 'Re-publish' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
