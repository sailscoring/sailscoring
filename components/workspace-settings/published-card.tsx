'use client';

import { Copy, ExternalLink, Trash2 } from 'lucide-react';

import { usePublishedList, useUnpublish } from '@/hooks/use-published';
import { Button } from '@/components/ui/button';
import type { PublishedListItem } from '@/lib/types';

/** Join names as `A`, `A and B`, or `A, B and C` for prose. */
function formatNameList(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The workspace "Published" management page (#164): every published results
 * page for the active workspace — live and orphaned (its series deleted) — with
 * the public URL, when it was last published, how many series edits have landed
 * since, and an Unpublish action. The authoring mirror of the public `/p/{ws}`
 * index, and the only surface that can manage orphaned snapshots.
 */
export function PublishedCard() {
  const { data: published } = usePublishedList();
  const unpublish = useUnpublish();

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

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-medium">Published results</h2>

      {published === undefined && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {published !== undefined && published.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing published yet.</p>
      )}

      {published !== undefined && published.length > 0 && (
        <div className="space-y-2">
          {published.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 border rounded-md px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {item.title}
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
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  aria-label={`Open ${item.title}`}
                >
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
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleUnpublish(item)}
                  disabled={unpublish.isPending}
                  aria-label={`Unpublish ${item.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Unpublishing takes the public page down and frees its URL. Pages whose
        series was deleted stay listed here until you remove them.
      </p>
    </div>
  );
}
