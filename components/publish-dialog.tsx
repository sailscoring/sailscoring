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
import {
  describeGroupMembers,
  fleetPagesSuppressed,
  producesPage,
  resolvePublishingGroups,
} from '@/lib/publishing-groups';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import { useUpdateSeries } from '@/hooks/use-series';
import { useFeatures } from '@/components/features-provider';
import { FtpPublishPane } from '@/components/ftp-publish-pane';
import type { Fleet, PublicationStatus, Series } from '@/lib/types';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

export interface PublishDialogProps {
  series: Series;
  fleets: Fleet[];
  open: boolean;
  onClose: () => void;
  /** Whether FTP upload is available (feature-gated + manage-workspace). When
   *  true the dialog offers a persistent switch to the FTP destination. */
  canFtp: boolean;
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

/** One page row's state in the dialog — a fleet, or a combined page (its
 *  name-keyed publishing group). A page already published is *frozen*: its
 *  sub-path is fixed (like the slug) and shown read-only. A not-yet-published
 *  page is editable, seeded with the derived default sub-path. */
interface FleetRow {
  name: string;
  frozen: boolean;
  /** Frozen pages only: the live page URL, for the link + Copy. */
  publishedUrl: string | null;
  /** Combined pages only: membership + detail summary, e.g.
   *  `all fleets · standings only`. */
  caption?: string;
}

/** A fleet listed while individual fleet pages are switched off — shown so
 *  nothing reads as vanished, but not selectable or path-editable. */
interface SuppressedRow {
  name: string;
  /** Combined page(s) the fleet appears on; empty = on none (not published). */
  groupNames: string[];
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
export function PublishDialog({ series, fleets, open, onClose, canFtp }: PublishDialogProps) {
  const updateSeries = useUpdateSeries();
  const { has } = useFeatures();
  // The prize sheet (#240) publishes as one more name-keyed page, "Prizes".
  const hasPrizes = has('prizes') && (series.prizes?.length ?? 0) > 0;
  // Destination mode. Persisted per-series (`series.publishMode`) so the dialog
  // reopens where the scorer left it; clamped to Sail Scoring when FTP isn't
  // available so a workspace that loses the feature isn't stranded in FTP mode.
  const [mode, setMode] = useState<'sailscoring' | 'ftp'>('sailscoring');
  // Sub-series publish one page per (block, fleet) with server-derived
  // `{block}/{leaf}` paths, so the per-fleet URL editors don't apply.
  const { data: subSeriesList } = useSubSeriesBySeries(series.id);
  const hasBlocks = (subSeriesList?.length ?? 0) > 0;
  // Combined pages (#255): defined on the Settings tab, *reflected* here.
  // Shown whenever config exists — the feature gate hides only the editor.
  // Single-fleet series have nothing to combine (mirrors the build); on a
  // block series a group publishes one page per sub-series, like a fleet.
  const resolvedGroups = useMemo(
    () =>
      fleets.length > 1
        ? resolvePublishingGroups(series.publishingGroups, fleets).filter(producesPage)
        : [],
    [series.publishingGroups, fleets],
  );
  // With individual fleet pages off, every fleet publishes only through the
  // combined pages (inert while none are configured).
  const suppressed = useMemo(
    () =>
      fleetPagesSuppressed(series.publishIndividualFleetPages, resolvedGroups)
        ? new Set(fleets.map((f) => f.id))
        : new Set<string>(),
    [series.publishIndividualFleetPages, fleets, resolvedGroups],
  );
  // The names that publish as pages this round: combined pages first, then
  // the fleets that keep a standalone page, then the prize sheet — mirroring
  // the build order. Pages are name-keyed, so groups and the prize sheet ride
  // the same selection/sub-path machinery.
  const pageNames = useMemo(
    () => [
      ...resolvedGroups.map((r) => r.group.name.trim()),
      ...fleets.filter((f) => !suppressed.has(f.id)).map((f) => f.name),
      ...(hasPrizes ? ['Prizes'] : []),
    ],
    [resolvedGroups, fleets, suppressed, hasPrizes],
  );
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
  // (default) fleet, otherwise the kebab-cased name — mirrors the server. The
  // prize sheet defaults to `prizes` regardless of the fleet count (when
  // co-publishing the server disambiguates to `{series-slug}-prizes`).
  const defaultSubPath = useMemo(() => {
    const single = fleets.length <= 1;
    return (name: string) =>
      name === 'Prizes' ? 'prizes' : single ? 'standings' : fleetSubPath(name, false);
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
        for (const name of pageNames) {
          const isPub = publishedByName.has(name);
          // First publish: everything ticked. Re-publish: only what's already
          // live, so re-publishing never silently adds a newly-created page.
          if (!pub || isPub) initSelected.add(name);
          // Editable sub-path only for not-yet-published pages.
          if (!isPub) initSubPaths[name] = defaultSubPath(name);
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

  // Seed the destination mode from the series each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    const stored = series.publishMode ?? 'sailscoring';
    setMode(stored === 'ftp' && canFtp ? 'ftp' : 'sailscoring');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Flip destination and persist the choice so it sticks for next time. Fire
  // and forget — a preference write shouldn't block the UI, and a failure just
  // means the dialog reopens in the previous mode.
  function switchMode(next: 'sailscoring' | 'ftp') {
    if (next === mode || (next === 'ftp' && !canFtp)) return;
    setMode(next);
    updateSeries.mutate({ id: series.id, patch: () => ({ publishMode: next }) });
  }

  const rows = useMemo<FleetRow[]>(() => {
    const publishedByName = new Map(
      (published?.pages ?? []).map((p) => [p.fleetName, p.url]),
    );
    const captionByGroupName = new Map(
      resolvedGroups.map((r) => [
        r.group.name.trim(),
        `${describeGroupMembers(r)} · ${r.group.detail === 'standings' ? 'standings only' : 'full detail'}`,
      ]),
    );
    const prizeCount = series.prizes?.length ?? 0;
    return pageNames.map((name) => ({
      name,
      frozen: publishedByName.has(name),
      publishedUrl: publishedByName.get(name) ?? null,
      ...(captionByGroupName.has(name)
        ? { caption: captionByGroupName.get(name)! }
        : hasPrizes && name === 'Prizes'
          ? { caption: `prize list · ${prizeCount} prize${prizeCount === 1 ? '' : 's'}` }
          : {}),
    }));
  }, [pageNames, resolvedGroups, published, hasPrizes, series.prizes]);

  // Fleets while individual pages are off: listed dimmed so the scorer sees
  // where each fleet went — its combined page(s), or a warning when no
  // combined page covers it (it isn't published at all).
  const suppressedRows = useMemo<SuppressedRow[]>(() => {
    if (suppressed.size === 0) return [];
    return fleets
      .filter((f) => suppressed.has(f.id))
      .map((f) => ({
        name: f.name,
        groupNames: resolvedGroups
          .filter((r) => r.fleets.some((m) => m.id === f.id))
          .map((r) => r.group.name.trim()),
      }));
  }, [fleets, suppressed, resolvedGroups]);

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
    // The prizes page has its own row below — the preview is the results page.
    const page =
      published?.pages.find((p) => p.fleetName !== 'Prizes') ?? published?.pages[0];
    return {
      fleetName: page?.fleetName ?? fleets[0]?.name ?? 'Standings',
      // With sub-series there are several pages; link the series index that
      // lists them all rather than one block's page.
      url: hasBlocks ? urlPrefix : page?.url ?? `${urlPrefix}/${singlePath || 'standings'}`,
    };
  }, [published, fleets, urlPrefix, singlePath, hasBlocks]);

  // Client-side guard so the button reflects what the server would reject. The
  // single default page needs a non-empty sub-path while it's still editable
  // (unpublished); once published its path is frozen and always valid. For the
  // multi-fleet UI, the pages that will be live afterwards are the ticked ones
  // plus any already-published fleet (which stays live even when unticked) — we
  // need at least one, with distinct sub-paths.
  const prizesFrozen = (published?.pages ?? []).some((p) => p.fleetName === 'Prizes');

  const validation = useMemo(() => {
    if (!multiFleet) {
      // The prize sheet makes even a single-fleet series multi-page: its own
      // (editable) sub-path must be present and distinct from the results page.
      const prizesTicked = hasPrizes && selected.has('Prizes') && !prizesFrozen;
      if (prizesTicked && !(subPaths['Prizes'] ?? '')) return 'Give the prize list a URL.';
      if (isPublished || hasBlocks) return null;
      if (!singlePath) return 'Give the page a URL.';
      if (prizesTicked && subPaths['Prizes'] === singlePath) {
        return 'The prize list and the results page share a URL. Make them unique.';
      }
      return null;
    }
    const live = rows.filter((r) => r.frozen || selected.has(r.name));
    if (live.length === 0) return 'Select at least one fleet to publish.';
    if (hasBlocks) return null; // paths are server-derived per block
    const seen = new Set<string>();
    for (const r of live) {
      const seg = segmentFor(r);
      if (!seg) return `Give “${r.name}” a URL.`;
      if (seen.has(seg)) return `Two fleets share the URL “${seg}”. Make them unique.`;
      seen.add(seg);
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiFleet, isPublished, hasBlocks, singlePath, rows, selected, subPaths, published]);

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
        if (!hasBlocks) {
          for (const r of rows) {
            if (r.frozen || !selected.has(r.name)) continue;
            const seg = segmentFor(r);
            if (seg !== defaultSubPath(r.name)) overrides[r.name] = seg;
          }
        }
        selection = { fleets: fleetNames, subPaths: overrides };
      } else if (hasPrizes) {
        // The prize sheet makes a single-fleet series multi-page. The lone
        // fleet page's name can be synthetic and unknown here, so it can't go
        // in `fleets` — untick prizes via the dedicated `prizes: false` flag
        // instead, and pass the prizes sub-path override when edited.
        const overrides: Record<string, string> = {};
        if (selected.has('Prizes')) {
          const seg = subPaths['Prizes'] ?? '';
          if (!prizesFrozen && seg !== defaultSubPath('Prizes')) overrides['Prizes'] = seg;
        }
        selection = {
          ...(selected.has('Prizes') ? {} : { prizes: false }),
          ...(Object.keys(overrides).length > 0 ? { subPaths: overrides } : {}),
          ...(!isPublished && !hasBlocks ? { defaultSubPath: singlePath } : {}),
        };
      } else if (!isPublished && !hasBlocks) {
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
      // with the suggestion, and every page ticked again.
      setStatus((s) => (s ? { ...s, published: null } : s));
      setSlug(status?.suggestedSlug ?? '');
      setSelected(new Set(pageNames));
      setSubPaths(
        Object.fromEntries(pageNames.map((name) => [name, defaultSubPath(name)])),
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
          {canFtp && (
            <div
              role="group"
              aria-label="Publish destination"
              className="mt-1 inline-flex self-start rounded-md bg-muted p-0.5 text-sm"
            >
              {(
                [
                  ['sailscoring', 'Sail Scoring pages'],
                  ['ftp', 'Your website (FTP)'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => switchMode(value)}
                  className={`rounded px-3 py-1 font-medium transition-colors ${
                    mode === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        {mode === 'ftp' ? (
          <FtpPublishPane series={series} fleets={fleets} onClose={onClose} />
        ) : (
        <>
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
                    <span className="flex-1">{resolvedGroups.length > 0 ? 'Page' : 'Fleet'}</span>
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
                          {row.caption && (
                            <span
                              className="shrink-0 max-w-44 truncate text-xs text-muted-foreground"
                              title={row.caption}
                            >
                              {row.caption}
                            </span>
                          )}
                          {hasBlocks ? (
                            <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                              one page per sub-series
                            </span>
                          ) : row.frozen ? (
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
                          {row.frozen && !hasBlocks && (
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
                    {/* Fleets while individual pages are off: visible so
                        nothing reads as vanished, but not selectable — they
                        publish through the combined pages (or, uncovered,
                        not at all). */}
                    {suppressedRows.map((row) => {
                      const note = row.groupNames.length > 0
                        ? `→ in ${row.groupNames.join(', ')}`
                        : 'not on any combined page — not published';
                      return (
                        <div
                          key={`suppressed-${row.name}`}
                          className="flex items-center gap-2 opacity-50"
                          data-testid={`suppressed-fleet-${row.name}`}
                        >
                          <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span
                            className="w-36 shrink-0 truncate text-sm"
                            title={row.name}
                          >
                            {row.name}
                          </span>
                          <span
                            className="flex-1 min-w-0 truncate text-xs text-muted-foreground"
                            title={note}
                          >
                            {note}
                          </span>
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
            ) : hasBlocks ? (
              <p className="text-xs text-muted-foreground truncate" title={`${urlPrefix}/`}>
                Each sub-series publishes its own page under{' '}
                <span className="font-mono">/p/{workspaceSlug}/{slug || '…'}/</span>
              </p>
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

            {/* The prize sheet on a single-fleet series: one extra optional
                page below the lone results page (multi-fleet series list it
                as an ordinary row above). */}
            {!multiFleet && hasPrizes && (() => {
              const prizesUrl =
                (published?.pages ?? []).find((p) => p.fleetName === 'Prizes')?.url ??
                `${urlPrefix}/${subPaths['Prizes'] || 'prizes'}`;
              const checked = selected.has('Prizes');
              return (
                <div className={`flex items-center gap-2 ${!checked && !prizesFrozen ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle('Prizes')}
                    className="h-4 w-4 shrink-0"
                    aria-label="Publish Prizes"
                  />
                  <span className="w-36 shrink-0 truncate text-sm">Prizes</span>
                  {prizesFrozen ? (
                    <a
                      href={prizesUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={prizesUrl}
                      className="flex-1 min-w-0 truncate text-xs font-mono hover:underline"
                    >
                      {lastSegment(prizesUrl)}
                    </a>
                  ) : (
                    <Input
                      value={subPaths['Prizes'] ?? ''}
                      onChange={(e) => {
                        const v = sanitizeSlug(e.target.value);
                        setSubPaths((p) => ({ ...p, Prizes: v }));
                        setError(null);
                      }}
                      disabled={!checked}
                      placeholder="prizes"
                      aria-label="URL for Prizes"
                      className="flex-1 min-w-0 h-7 text-xs font-mono"
                    />
                  )}
                  {prizesFrozen && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => navigator.clipboard.writeText(prizesUrl)}
                    >
                      Copy
                    </Button>
                  )}
                </div>
              );
            })()}

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
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
