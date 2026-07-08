'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  FolderInput,
  MoreVertical,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  useSeriesList,
  useDeleteSeriesCascade,
  useArchiveSeries,
  useSetSeriesCategory,
  useReorderSeries,
} from '@/hooks/use-series';
import { useTrash, useRestoreFromTrash, usePurgeFromTrash } from '@/hooks/use-trash';
import { usePublicationStatus } from '@/hooks/use-published';
import { useCategories } from '@/hooks/use-categories';
import { useRecentActivity } from '@/hooks/use-activity';
import { formatRelativeTime } from '@/lib/relative-time';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { formatSaveDate } from '@/lib/format-date';
import { KeyboardHelp } from '@/components/keyboard-help';
import { OpenSeriesFlow } from '@/components/open-series-flow';
import { CreateFollowOnSeriesDialog } from '@/components/create-follow-on-series-dialog';
import { useFeatures } from '@/components/features-provider';
import { useOpenSeriesFile } from '@/hooks/use-open-series-file';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SortableList, DragHandle, type SortableRenderProps } from '@/components/ui/sortable-list';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  groupActiveByCategory,
  groupArchivedByYear,
} from '@/lib/series-list';
import type { ActivityEntry, Category, DeletedSeriesEntry, Series } from '@/lib/types';

function SeriesCard({
  series,
  categories,
  recent,
  onArchive,
  onUnarchive,
  onMove,
  onDeleteClick,
  onFollowOn,
  sortable,
}: {
  series: Series;
  categories: Category[];
  recent?: ActivityEntry;
  onArchive: (series: Series) => void;
  onUnarchive: (series: Series) => void;
  onMove: (series: Series, categoryId: string | null) => void;
  onDeleteClick: (series: Series) => void;
  /** Absent when the follow-on-series feature is off for this workspace. */
  onFollowOn?: (series: Series) => void;
  /** Present for active rows that can be drag-reordered. */
  sortable?: SortableRenderProps;
}) {
  const archived = series.archived ?? false;
  const { can } = useWorkspacePermissions();
  return (
    <div
      ref={sortable?.ref}
      style={sortable?.style}
      data-testid="series-row"
      className="flex items-center gap-1 bg-card border rounded-lg px-5 py-4 shadow-sm transition-all hover:bg-accent/50 hover:shadow-md"
    >
      {sortable && (
        <DragHandle {...sortable.handleProps} data-testid={`series-drag-${series.id}`} />
      )}
      <Link
        href={`/series/${series.id}/competitors`}
        className="flex-1 min-w-0"
      >
        <div className="font-medium">{series.name}</div>
        <div className="text-sm text-muted-foreground mt-0.5 flex gap-2">
          {(series.venue || series.startDate) && (
            <span>{[series.venue, series.startDate].filter(Boolean).join(' · ')}</span>
          )}
          {series.lastSavedAt && (
            <span>{formatSaveDate(series.lastSavedAt)}</span>
          )}
        </div>
        {recent && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            {recent.summary}
            {recent.count > 1 ? ` ×${recent.count}` : ''} ·{' '}
            {recent.actor?.displayName ?? recent.actor?.email ?? 'Someone'} ·{' '}
            {formatRelativeTime(recent.createdAt)}
          </div>
        )}
      </Link>
      {/* Every menu action is a manage-series write; the menu hides whole
          for roles without it. */}
      {can('manage-series') && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Actions for ${series.name}`}
            onClick={(e) => e.preventDefault()}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {archived ? (
            <>
              <DropdownMenuItem onClick={() => onUnarchive(series)}>
                <ArchiveRestore className="h-4 w-4" />
                Unarchive
              </DropdownMenuItem>
              {onFollowOn && (
                <DropdownMenuItem onClick={() => onFollowOn(series)}>
                  <CopyPlus className="h-4 w-4" />
                  Create follow-on series…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDeleteClick(series)}
              >
                <Trash2 className="h-4 w-4" />
                Delete…
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <FolderInput className="h-4 w-4" />
                  Move to category
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={series.categoryId ?? 'none'}
                    onValueChange={(v) => onMove(series, v === 'none' ? null : v)}
                  >
                    {categories.map((c) => (
                      <DropdownMenuRadioItem key={c.id} value={c.id}>
                        {c.name}
                      </DropdownMenuRadioItem>
                    ))}
                    <DropdownMenuRadioItem value="none">
                      Uncategorized
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {onFollowOn && (
                <DropdownMenuItem onClick={() => onFollowOn(series)}>
                  <CopyPlus className="h-4 w-4" />
                  Create follow-on series…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onArchive(series)}>
                <Archive className="h-4 w-4" />
                Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
    </div>
  );
}

/** One soft-deleted series in the Trash. A trashed series can't be opened — the
 *  only actions are Recover (back to the archived list) and a guarded permanent
 *  delete. */
function TrashRow({
  entry,
  onRecover,
  onDeleteForever,
  busy,
}: {
  entry: DeletedSeriesEntry;
  onRecover: (entry: DeletedSeriesEntry) => void;
  onDeleteForever: (entry: DeletedSeriesEntry) => void;
  busy: boolean;
}) {
  const { can } = useWorkspacePermissions();
  const who = entry.actor?.displayName ?? entry.actor?.email ?? 'someone';
  return (
    <div className="flex items-center gap-1 bg-card border rounded-lg px-5 py-4 shadow-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-muted-foreground">{entry.name}</div>
        <div className="text-sm text-muted-foreground mt-0.5">
          Deleted {formatRelativeTime(entry.deletedAt)} by {who}
        </div>
        {entry.hadPublication && (
          <div className="text-xs text-muted-foreground mt-1">
            Its published results page is still online but disconnected.
          </div>
        )}
      </div>
      {can('manage-series') && (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onRecover(entry)}
          >
            <RotateCcw className="h-4 w-4" />
            Recover
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Permanently delete ${entry.name}`}
            disabled={busy}
            onClick={() => onDeleteForever(entry)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      )}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();
  const canManage = can('manage-series');
  const { data: seriesList } = useSeriesList();
  const { data: categories } = useCategories();
  const { data: recentById } = useRecentActivity();
  const deleteCascade = useDeleteSeriesCascade();
  const archiveSeries = useArchiveSeries();
  const setSeriesCategory = useSetSeriesCategory();
  const reorderSeries = useReorderSeries();
  const { data: trash } = useTrash();
  const restoreFromTrash = useRestoreFromTrash();
  const purgeFromTrash = usePurgeFromTrash();
  const [pendingDelete, setPendingDelete] = useState<Series | null>(null);
  // The series being rolled into a follow-on (feature-gated menu action).
  const [pendingFollowOn, setPendingFollowOn] = useState<Series | null>(null);
  // The series in the permanent-delete (type-the-name) confirmation, and the
  // current text typed to confirm it.
  const [pendingPurge, setPendingPurge] = useState<DeletedSeriesEntry | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const openFlow = useOpenSeriesFile();

  // Whether the series queued for deletion has a live published page — drives
  // the orphaned-page warning. Only fetched while the dialog is open.
  const { data: pendingPublication } = usePublicationStatus(pendingDelete?.id ?? null);

  // No description: the dialog's static Global section documents `?` itself.
  useShortcuts([{ key: '?', handler: () => setShowHelp(true) }]);

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const seriesId = pendingDelete.id;
    setPendingDelete(null);
    await deleteCascade.mutateAsync(seriesId);
  }

  function handleRecover(entry: DeletedSeriesEntry) {
    restoreFromTrash.mutate(entry.id);
  }

  async function handleConfirmPurge() {
    if (!pendingPurge) return;
    const tombstoneId = pendingPurge.id;
    setPendingPurge(null);
    setPurgeConfirmText('');
    await purgeFromTrash.mutateAsync(tombstoneId);
  }

  function handleArchive(series: Series) {
    archiveSeries.mutate({ id: series.id, archived: true });
  }

  function handleUnarchive(series: Series) {
    archiveSeries.mutate({ id: series.id, archived: false });
  }

  function handleMove(series: Series, categoryId: string | null) {
    setSeriesCategory.mutate({ id: series.id, categoryId });
  }

  const cats = categories ?? [];
  const allSeries = seriesList ?? [];
  const activeGroups = groupActiveByCategory(
    allSeries.filter((s) => !s.archived),
    cats,
  );
  const archivedGroups = groupArchivedByYear(allSeries.filter((s) => s.archived));
  const archivedCount = archivedGroups.reduce((n, g) => n + g.series.length, 0);
  const trashList = trash ?? [];
  // Flat (no section headers) when nothing is categorised — preserves the
  // original look for workspaces that don't use categories.
  const flatActive = activeGroups.length <= 1 && activeGroups[0]?.category == null;

  const renderCard = (s: Series, sortable?: SortableRenderProps) => (
    <SeriesCard
      key={s.id}
      series={s}
      categories={cats}
      recent={recentById?.get(s.id)}
      onArchive={handleArchive}
      onUnarchive={handleUnarchive}
      onMove={handleMove}
      onDeleteClick={setPendingDelete}
      onFollowOn={has('follow-on-series') ? setPendingFollowOn : undefined}
      sortable={canManage ? sortable : undefined}
    />
  );

  // Stable key for an active category group: the category id, or 'uncategorized'
  // for the synthetic bucket (and the flat, no-categories case).
  const groupKey = (g: (typeof activeGroups)[number]) =>
    g.category?.id ?? 'uncategorized';

  // Drag-reorder within one group. The displayOrder is global, so we
  // rebuild the full active order — the reordered group's new sequence spliced
  // in, every other group left as-is — and persist that.
  function handleReorderGroup(key: string, orderedIdsInGroup: string[]) {
    const fullOrder = activeGroups.flatMap((g) =>
      groupKey(g) === key ? orderedIdsInGroup : g.series.map((s) => s.id),
    );
    reorderSeries.mutate(fullOrder);
  }

  const renderActiveGroup = (g: (typeof activeGroups)[number]) => (
    <SortableList
      items={g.series}
      onReorder={(ids) => handleReorderGroup(groupKey(g), ids)}
    >
      {(s, sortable) => renderCard(s, sortable)}
    </SortableList>
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Series</h1>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={openFlow.start}>
              Import Series
            </Button>
            <Button asChild>
              <Link href="/series/new">New series</Link>
            </Button>
          </div>
        )}
      </div>

      {seriesList === undefined && (
        <p className="text-muted-foreground">Loading…</p>
      )}

      {seriesList !== undefined && seriesList.length === 0 && trashList.length === 0 && (
        canManage ? (
          <p className="text-muted-foreground">
            No series yet.{' '}
            <Link href="/series/new" className="underline">
              Create your first series
            </Link>{' '}
            or{' '}
            <button className="underline" onClick={openFlow.start}>
              import a series file
            </button>
            {' '}to get started.
          </p>
        ) : (
          <p className="text-muted-foreground">No series yet.</p>
        )
      )}

      {seriesList !== undefined && (seriesList.length > 0 || trashList.length > 0) && (
        <div className="space-y-6">
          {/* Active series, partitioned by category — drag-reorder within a group */}
          {flatActive ? (
            <div className="space-y-2">
              {activeGroups[0] && renderActiveGroup(activeGroups[0])}
            </div>
          ) : (
            activeGroups.map((g) => (
              <section key={groupKey(g)} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {g.category?.name ?? 'Uncategorized'}
                </h2>
                <div className="space-y-2">{renderActiveGroup(g)}</div>
              </section>
            ))
          )}

          {/* Archived series — collapsed by default, grouped by event year */}
          {archivedCount > 0 && (
            <div className="border-t pt-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                aria-expanded={showArchived}
                onClick={() => setShowArchived((v) => !v)}
              >
                {showArchived ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Archived ({archivedCount})
              </button>
              {showArchived && (
                <div className="mt-3 space-y-6">
                  {archivedGroups.map((g) => (
                    <section key={g.year ?? 'undated'} className="space-y-2">
                      <h3 className="text-xs font-medium text-muted-foreground">
                        {g.year ?? 'Undated'}
                      </h3>
                      <div className="space-y-2">{g.series.map((s) => renderCard(s))}</div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Trash — soft-deleted series, recoverable for 30 days. Collapsed
              by default; a trashed series can't be opened, only recovered. */}
          {trashList.length > 0 && (
            <div className="border-t pt-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
                aria-expanded={showTrash}
                onClick={() => setShowTrash((v) => !v)}
              >
                {showTrash ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Trash ({trashList.length})
              </button>
              {showTrash && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Deleted series are kept for 30 days, then removed for good.
                  </p>
                  {trashList.map((entry) => (
                    <TrashRow
                      key={entry.id}
                      entry={entry}
                      onRecover={handleRecover}
                      onDeleteForever={setPendingPurge}
                      busy={restoreFromTrash.isPending || purgeFromTrash.isPending}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <OpenSeriesFlow flow={openFlow} />

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} />

      {/* Delete dialog — a soft delete: the series moves to the Trash and is
          recoverable for 30 days. */}
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{pendingDelete?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              The series, with all its competitors, races, and results, moves to the Trash.
              You can recover it for 30 days, after which it&rsquo;s removed for good.
            </DialogDescription>
          </DialogHeader>
          {pendingPublication?.published && (
            <p className="text-sm text-muted-foreground">
              Its published results page stays online but becomes disconnected — recovering
              the series won&rsquo;t reconnect it. Unpublish first if you don&rsquo;t want it
              to remain public.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Follow-on dialog — keyed by source so the name suggestion
          re-initialises per series. */}
      {pendingFollowOn && (
        <CreateFollowOnSeriesDialog
          key={pendingFollowOn.id}
          source={pendingFollowOn}
          existingNames={allSeries.map((s) => s.name)}
          open
          onOpenChange={(open) => { if (!open) setPendingFollowOn(null); }}
        />
      )}

      {/* Permanent-delete dialog — type the series name to confirm. */}
      <Dialog
        open={pendingPurge !== null}
        onOpenChange={(open) => { if (!open) { setPendingPurge(null); setPurgeConfirmText(''); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete &ldquo;{pendingPurge?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This removes the series and everything in it for good — it can&rsquo;t be recovered.
              Type the series name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={purgeConfirmText}
            onChange={(e) => setPurgeConfirmText(e.target.value)}
            placeholder={pendingPurge?.name}
            aria-label="Type the series name to confirm"
            autoComplete="off"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setPendingPurge(null); setPurgeConfirmText(''); }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={purgeConfirmText !== pendingPurge?.name}
              onClick={handleConfirmPurge}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
