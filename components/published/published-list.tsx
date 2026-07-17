'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Copy, ExternalLink, Trash2 } from 'lucide-react';

import { usePublishedList, useUnpublish } from '@/hooks/use-published';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { groupWorkspaceListing } from '@/lib/published-index';
import { cn } from '@/lib/utils';
import type { PublishedListItem } from '@/lib/types';

/** Join names as `A`, `A and B`, or `A, B and C` for prose. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type Filter = 'all' | 'stale' | 'orphaned';

function Row({
  item,
  canUnpublish,
  onUnpublish,
  unpublishPending,
}: {
  item: PublishedListItem;
  canUnpublish: boolean;
  onUnpublish: (item: PublishedListItem) => void;
  unpublishPending: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border rounded-md px-3 py-2 bg-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {item.seriesId !== null ? (
            <Link href={`/series/${item.seriesId}`} className="hover:underline">
              {item.title}
            </Link>
          ) : (
            item.title
          )}
          {item.orphaned && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · series deleted
            </span>
          )}
          {item.sharedWith.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              · shares URL with {formatNameList(item.sharedWith)}
            </span>
          )}
        </p>
        {/* direction: rtl clips the shared start of the URL and keeps the
            distinguishing slug visible; the URL is one LTR run so its
            character order is unaffected. Mirrors the publish dialog. */}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          title={item.url}
          className="text-xs font-mono truncate block text-muted-foreground hover:underline"
          style={{ direction: 'rtl', textAlign: 'left' }}
        >
          {item.url}
        </a>
        <p className="text-xs text-muted-foreground mt-0.5">
          Published {new Date(item.publishedAt).toLocaleString()}
          {item.fleetCount > 1 && <span> · {item.fleetCount} fleets</span>}
          {item.editsSincePublish > 0 && (
            <span className="text-amber-600 dark:text-amber-400">
              {' · '}
              {item.editsSincePublish} edit
              {item.editsSincePublish === 1 ? '' : 's'} since
            </span>
          )}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        <Button variant="ghost" size="icon" asChild aria-label={`Open ${item.title}`}>
          <a href={item.url} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigator.clipboard.writeText(item.url)}
          aria-label={`Copy URL for ${item.title}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
        {canUnpublish && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onUnpublish(item)}
            disabled={unpublishPending}
            aria-label={`Unpublish ${item.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The workspace Published tab: every published results page — live and
 * orphaned (its series deleted) — partitioned exactly like the public
 * `/p/{ws}` listing (active category sections, archived under "Past results"
 * by year), with the management extras the public page doesn't have: search,
 * stale/orphan filters, edits-since badges, and Unpublish. The authoring
 * mirror of the public index, and the only surface that can manage orphaned
 * snapshots.
 */
export function PublishedList() {
  const { data: published } = usePublishedList();
  const unpublish = useUnpublish();
  // Unpublishing is part of the publish (score) job; the list itself is a read.
  const canUnpublish = useWorkspacePermissions().can('score');

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showPast, setShowPast] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useShortcuts([
    {
      key: '/',
      description: 'Search published pages',
      handler: () => searchRef.current?.focus(),
    },
  ]);

  const items = useMemo(() => published ?? [], [published]);
  const staleCount = items.filter((i) => i.editsSincePublish > 0).length;
  const orphanCount = items.filter((i) => i.orphaned).length;

  // Search over what the eye scans for: the series name and the public URL.
  const q = query.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (filter === 'stale' && i.editsSincePublish === 0) return false;
    if (filter === 'orphaned' && !i.orphaned) return false;
    if (q === '') return true;
    return i.title.toLowerCase().includes(q) || i.slug.toLowerCase().includes(q);
  });
  const orphans = visible.filter((i) => i.orphaned);
  const { active, past } = groupWorkspaceListing(visible.filter((i) => !i.orphaned));

  // Narrowing overrides the "Past results" collapse — hiding matches behind a
  // closed toggle would read as "no results".
  const narrowing = q !== '' || filter !== 'all';
  const pastCount = past.reduce((n, g) => n + g.items.length, 0);
  const pastOpen = narrowing || showPast;

  // Flat (no section headings) when the whole workspace is one uncategorised
  // active bucket — the common single-club, no-categories case. Decided on the
  // full list so the page's shape doesn't change as a search narrows it.
  const wholeListing = groupWorkspaceListing(items.filter((i) => !i.orphaned));
  const flat =
    orphanCount === 0 &&
    wholeListing.past.length === 0 &&
    wholeListing.active.length <= 1 &&
    (wholeListing.active.length === 0 || wholeListing.active[0].categoryName === null);

  async function handleUnpublish(item: PublishedListItem) {
    const shared = item.sharedWith.length > 0;
    const message = item.orphaned
      ? `Permanently remove the saved results page "${item.title}"? Its series was already deleted, so this is the final copy.`
      : shared
        ? `Unpublish "${item.title}"? Its fleets are removed from ${item.url}; the page stays live for ${formatNameList(item.sharedWith)}.`
        : `Unpublish "${item.title}"? The public page at ${item.url} will stop working and the URL frees up.`;
    if (!confirm(message)) return;
    await unpublish.mutateAsync(item.id);
  }

  const rows = (list: PublishedListItem[]) => (
    <div className="space-y-2">
      {list.map((item) => (
        <Row
          key={item.id}
          item={item}
          canUnpublish={canUnpublish}
          onUnpublish={handleUnpublish}
          unpublishPending={unpublish.isPending}
        />
      ))}
    </div>
  );

  const filterButton = (value: Filter, label: string, count?: number) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => setFilter(filter === value ? 'all' : value)}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        filter === value
          ? 'bg-primary text-primary-foreground border-primary'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
      {count !== undefined && ` (${count})`}
    </button>
  );

  if (published === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing published yet. Publish a series from the Publish button on its
        Standings tab.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {items.length} page{items.length === 1 ? '' : 's'} published
        {staleCount > 0 && (
          <span>
            {' · '}
            <span className="text-amber-600 dark:text-amber-400">
              {staleCount} with edits since publish
            </span>
          </span>
        )}
        {orphanCount > 0 && ` · ${orphanCount} orphaned`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles and URLs…"
          aria-label="Search published pages"
          className="h-8 max-w-xs text-sm"
        />
        {filterButton('stale', 'Edits since publish', staleCount)}
        {orphanCount > 0 && filterButton('orphaned', 'Series deleted', orphanCount)}
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No pages match.</p>
      )}

      {flat ? (
        rows(active[0]?.items ?? [])
      ) : (
        <div className="space-y-6">
          {active.map((g) => (
            <section key={g.categoryName ?? 'uncategorized'} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
                {g.categoryName ?? 'Uncategorized'}
              </h2>
              {rows(g.items)}
            </section>
          ))}

          {pastCount > 0 && (
            <div className="border-t pt-4">
              {!narrowing && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                  aria-expanded={pastOpen}
                  onClick={() => setShowPast((v) => !v)}
                >
                  {pastOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Past results ({pastCount})
                </button>
              )}
              {narrowing && (
                <h2 className="text-sm font-semibold text-muted-foreground">
                  Past results
                </h2>
              )}
              {pastOpen && (
                <div className="mt-3 space-y-6">
                  {past.map((g) => (
                    <section key={g.year ?? 'undated'} className="space-y-2">
                      <h3 className="text-xs font-medium text-muted-foreground">
                        {g.year ?? 'Undated'}
                      </h3>
                      {rows(g.items)}
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {orphans.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                Series deleted
              </h2>
              <p className="text-xs text-muted-foreground">
                These pages outlived their series. Each stays live until you
                remove it here — removal is permanent, as the series is gone.
              </p>
              {rows(orphans)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
