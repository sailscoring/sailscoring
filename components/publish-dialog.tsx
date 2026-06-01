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

/** Sanitise free-typed slug / sub-path input to the allowed character set. */
function sanitizeSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Last path segment of a public fleet URL — the part under the shared slug. */
function lastSegment(url: string): string {
  return url.split('/').filter(Boolean).pop() ?? '';
}

/** Join names as `A`, `A and B`, or `A, B and C` for prose. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return 'another series';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One fleet's row state in the dialog. A fleet already published is *frozen*:
 *  its sub-path is fixed (like the slug) and shown read-only. A not-yet-published
 *  fleet is editable, seeded with the derived default sub-path. */
interface FleetRow {
  name: string;
  frozen: boolean;
  /** Frozen fleets only: the live page URL, for the link + Copy. */
  publishedUrl: string | null;
}

/**
 * In-app results publishing (ADR-008 Phase 9/10, the bilge replacement — #153).
 * Publish is explicit and point-in-time. The slug is editable at first publish
 * and frozen after; the dialog shows the resulting public URL(s) as you edit it.
 *
 * Per fleet, the scorer can: choose whether to publish/update it now (untick a
 * work-in-progress fleet to skip it — an already-published one keeps its current
 * live page; Unpublish is what retracts pages), and edit its URL sub-path while
 * it's unpublished (a published fleet's sub-path is frozen). This lets a clean
 * fleet name ("Puppeteers HPH") point at a disambiguated URL segment
 * ("tuesday-puppeteers-hph") when several series share one slug.
 */
export function PublishDialog({ series, fleets, open, onClose }: PublishDialogProps) {
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [slug, setSlug] = useState('');
  // Selected fleet names (the set to publish) and per-fleet editable sub-paths.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subPaths, setSubPaths] = useState<Record<string, string>>({});
  // The lone default page's editable sub-path (single-fleet series). Kept
  // separate from `subPaths` because that page's fleet name can be synthetic
  // ("Unknown") and isn't a reliable key; the server applies it by `isDefault`.
  const [singlePath, setSinglePath] = useState('standings');
  const [phase, setPhase] = useState<
    'loading' | 'idle' | 'publishing' | 'unpublishing'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  const [needsJoin, setNeedsJoin] = useState(false);

  const published = status?.published ?? null;
  const isPublished = published !== null;
  const workspaceSlug = status?.workspaceSlug ?? '';

  // Derived default sub-path for an unpublished fleet: `standings` for a lone
  // (default) fleet, otherwise the kebab-cased name — mirrors the server.
  const defaultSubPath = useMemo(() => {
    const single = fleets.length <= 1;
    return (name: string) => (single ? 'standings' : fleetSubPath(name, false));
  }, [fleets.length]);

  // Load publication state each time the dialog opens, and seed the per-fleet
  // selection + sub-paths from it. Syncing with the external open signal, so the
  // state writes here are expected.
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
        const pub = s.published;
        const publishedByName = new Map(
          (pub?.pages ?? []).map((p) => [p.fleetName, p.url]),
        );
        const initSelected = new Set<string>();
        const initSubPaths: Record<string, string> = {};
        for (const f of fleets) {
          const isPub = publishedByName.has(f.name);
          // First publish: everything ticked. Re-publish: only what's already
          // live, so re-publishing never silently adds a newly-created fleet.
          if (!pub || isPub) initSelected.add(f.name);
          // Editable sub-path only for not-yet-published fleets.
          if (!isPub) initSubPaths[f.name] = defaultSubPath(f.name);
        }
        setStatus(s);
        setSlug(pub?.slug ?? s.suggestedSlug);
        setSelected(initSelected);
        setSubPaths(initSubPaths);
        setSinglePath('standings');
        setPhase('idle');
      })
      .catch(() => {
        if (!cancelled) setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
    // Seeds once per open per series; `fleets`/`defaultSubPath` are stable for a
    // given series, and listing them would re-seed (wiping edits) on every
    // parent re-render that hands us a fresh array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, series.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rows = useMemo<FleetRow[]>(() => {
    const publishedByName = new Map(
      (published?.pages ?? []).map((p) => [p.fleetName, p.url]),
    );
    return fleets.map((f) => ({
      name: f.name,
      frozen: publishedByName.has(f.name),
      publishedUrl: publishedByName.get(f.name) ?? null,
    }));
  }, [fleets, published]);

  // The sub-path each row resolves to (frozen path, or the editable value).
  const segmentFor = (row: FleetRow): string =>
    row.frozen ? lastSegment(row.publishedUrl ?? '') : (subPaths[row.name] ?? '');

  const urlPrefix = `${APP_URL}/p/${workspaceSlug}/${slug || '…'}`;

  // A single-fleet series has one default page. Its sub-path is editable before
  // first publish (seeded `standings`) and frozen after — the same lifecycle as a
  // multi-fleet row, just without the per-fleet selection. Sending it explicitly
  // keeps the URL WYSIWYG: the server no longer silently renames it to the series
  // slug when the page co-publishes into a shared slug.
  const multiFleet = fleets.length > 1;

  // The single default page once published — the server's actual live page, used
  // for the frozen read-only link + Copy.
  const singlePreview = useMemo(() => {
    const page = published?.pages[0];
    return {
      fleetName: page?.fleetName ?? fleets[0]?.name ?? 'Standings',
      url: page?.url ?? `${urlPrefix}/${singlePath || 'standings'}`,
    };
  }, [published, fleets, urlPrefix, singlePath]);

  // Client-side guard so the button reflects what the server would reject. The
  // single default page needs a non-empty sub-path while it's still editable
  // (unpublished); once published its path is frozen and always valid. For the
  // multi-fleet UI, the pages that will be live afterwards are the ticked ones
  // plus any already-published fleet (which stays live even when unticked) — we
  // need at least one, with distinct sub-paths.
  const validation = useMemo(() => {
    if (!multiFleet) {
      if (isPublished) return null;
      return singlePath ? null : 'Give the page a URL.';
    }
    const live = rows.filter((r) => r.frozen || selected.has(r.name));
    if (live.length === 0) return 'Select at least one fleet to publish.';
    const seen = new Set<string>();
    for (const r of live) {
      const seg = segmentFor(r);
      if (!seg) return `Give “${r.name}” a URL.`;
      if (seen.has(seg)) return `Two fleets share the URL “${seg}”. Make them unique.`;
      seen.add(seg);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiFleet, isPublished, singlePath, rows, selected, subPaths, published]);

  const pendingEdits = published
    ? Math.max(0, (series.version ?? 1) - published.publishedVersion)
    : 0;

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.name)));
  }

  async function handlePublish(join = false) {
    setPhase('publishing');
    setError(null);
    try {
      // Multi-fleet: send the selection, plus sub-path overrides for the editable
      // (unfrozen) fleets in it. Only send a path the scorer actually changed —
      // leaving the default lets the server derive it. Single-fleet first publish:
      // send the lone page's sub-path explicitly so its URL is exactly what the
      // dialog shows, never the server's silent shared-slug rename. Re-publish
      // sends neither (the path is frozen). The slug is honoured only on first publish.
      let selection: {
        fleets?: string[];
        subPaths?: Record<string, string>;
        defaultSubPath?: string;
      } = {};
      if (multiFleet) {
        const fleetNames = rows.filter((r) => selected.has(r.name)).map((r) => r.name);
        const overrides: Record<string, string> = {};
        for (const r of rows) {
          if (r.frozen || !selected.has(r.name)) continue;
          const seg = segmentFor(r);
          if (seg !== defaultSubPath(r.name)) overrides[r.name] = seg;
        }
        selection = { fleets: fleetNames, subPaths: overrides };
      } else if (!isPublished) {
        selection = { defaultSubPath: singlePath };
      }
      const result = await publishSeries(series.id, {
        ...(isPublished ? {} : { slug, join }),
        ...selection,
      });
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
          // Single default page joining a shared slug can't keep the clean
          // `standings` path (the founding series holds it). Seed the editable
          // suffix with the series slug so the scorer sees a disambiguated URL
          // they can confirm or tweak, instead of a silent rename.
          if (!multiFleet && singlePath === 'standings' && status?.suggestedSlug) {
            setSinglePath(status.suggestedSlug);
          }
          setError(
            `This URL already has results from ${formatNameList(names)}. Publish “${series.name}” alongside them — check the page URL below first.`,
          );
          return;
        }
        if (issues?.code === 'subpath-collision') {
          setNeedsJoin(false);
          // Same disambiguation seed for the single default page if it still
          // carries the bare `standings` default that just collided.
          if (!multiFleet && singlePath === 'standings' && status?.suggestedSlug) {
            setSinglePath(status.suggestedSlug);
          }
          setError(
            issues.fleetName
              ? `The URL for “${issues.fleetName}” clashes with another fleet at this slug. Change it, then try again.`
              : 'A fleet URL clashes with another at this slug. Change it, then try again.',
          );
          return;
        }
        if (issues?.code === 'invalid-subpath') {
          setError(
            issues.fleetName
              ? `The URL for “${issues.fleetName}” is invalid — use lowercase letters and numbers, separated by hyphens.`
              : 'A fleet URL is invalid — use lowercase letters and numbers, separated by hyphens.',
          );
          return;
        }
        if (issues?.code === 'no-fleets-selected') {
          setError('Select at least one fleet to publish.');
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
      // with the suggestion, and every fleet ticked again.
      setStatus((s) => (s ? { ...s, published: null } : s));
      setSlug(status?.suggestedSlug ?? '');
      setSelected(new Set(fleets.map((f) => f.name)));
      setSubPaths(
        Object.fromEntries(fleets.map((f) => [f.name, defaultSubPath(f.name)])),
      );
      setSinglePath('standings');
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
      <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
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
              </div>
            )}

            {multiFleet ? (
              <>
                <p className="text-xs text-muted-foreground truncate" title={`${urlPrefix}/`}>
                  Fleet pages live under{' '}
                  {isPublished ? (
                    // The series-index page at the bare slug only exists once
                    // something's published, so link it only then.
                    <a
                      href={urlPrefix}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono hover:underline"
                    >
                      /p/{workspaceSlug}/{slug}/
                    </a>
                  ) : (
                    <span className="font-mono">/p/{workspaceSlug}/{slug || '…'}/</span>
                  )}
                </p>
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground pb-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 shrink-0"
                    />
                    <span className="flex-1">Fleet</span>
                    <span>URL</span>
                  </label>
                  <div className="space-y-1 max-h-[50vh] overflow-y-auto">
                    {rows.map((row) => {
                      const checked = selected.has(row.name);
                      const segment = segmentFor(row);
                      const url = `${urlPrefix}/${segment}`;
                      // Dim only an unpublished fleet that's unticked (truly not
                      // going public). A published fleet stays live even when
                      // unticked — unticking just skips updating it — so it
                      // shouldn't read as removed.
                      const dim = !checked && !row.frozen;
                      return (
                        <div
                          key={row.name}
                          className={`flex items-center gap-2 ${dim ? 'opacity-50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(row.name)}
                            className="h-4 w-4 shrink-0"
                            aria-label={`Publish ${row.name}`}
                          />
                          <span
                            className="w-36 shrink-0 truncate text-sm"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                          {row.frozen ? (
                            <a
                              href={row.publishedUrl ?? url}
                              target="_blank"
                              rel="noreferrer"
                              title={row.publishedUrl ?? url}
                              aria-label={row.publishedUrl ?? url}
                              className="flex-1 min-w-0 truncate text-xs font-mono hover:underline"
                            >
                              {segment}
                            </a>
                          ) : (
                            <Input
                              value={segment}
                              onChange={(e) => {
                                const v = sanitizeSlug(e.target.value);
                                setSubPaths((p) => ({ ...p, [row.name]: v }));
                                setError(null);
                              }}
                              disabled={!checked}
                              placeholder={defaultSubPath(row.name)}
                              aria-label={`URL for ${row.name}`}
                              className="flex-1 min-w-0 h-7 text-xs font-mono"
                            />
                          )}
                          {row.frozen && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0"
                              onClick={() => navigator.clipboard.writeText(row.publishedUrl ?? url)}
                            >
                              Copy
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : isPublished ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  {/* direction: rtl makes the ellipsis clip the (shared) start of
                      the URL and keep the distinguishing end visible; text-align:
                      left keeps it left-aligned when it fits. The URL is a single
                      LTR run so its character order is unaffected. */}
                  <a
                    href={singlePreview.url}
                    target="_blank"
                    rel="noreferrer"
                    title={singlePreview.url}
                    className="text-xs font-mono truncate block hover:underline"
                    style={{ direction: 'rtl', textAlign: 'left' }}
                  >
                    {singlePreview.url}
                  </a>
                </div>
                <Button size="sm" variant="outline" className="shrink-0" onClick={() => navigator.clipboard.writeText(singlePreview.url)}>
                  Copy
                </Button>
              </div>
            ) : (
              // First publish of the lone default page: its sub-path is editable,
              // seeded `standings`, so the scorer controls the URL even when the
              // page co-publishes into a shared slug.
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground truncate" title={`${urlPrefix}/`}>
                  Published at <span className="font-mono">/p/{workspaceSlug}/{slug || '…'}/</span>
                </p>
                <Input
                  value={singlePath}
                  onChange={(e) => {
                    setSinglePath(sanitizeSlug(e.target.value));
                    setError(null);
                  }}
                  placeholder="standings"
                  aria-label="Page URL"
                  className="h-8 text-xs font-mono"
                />
              </div>
            )}

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
            <Button onClick={() => handlePublish(true)} disabled={isPublishing || validation !== null}>
              {isPublishing ? 'Publishing…' : 'Publish into existing event'}
            </Button>
          ) : (
            <Button
              onClick={() => handlePublish(false)}
              disabled={
                isLoading ||
                isPublishing ||
                isUnpublishing ||
                (!isPublished && !slug) ||
                validation !== null
              }
            >
              {isPublishing ? 'Publishing…' : isPublished ? 'Re-publish' : 'Publish'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
