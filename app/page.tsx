'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  FolderInput,
  Loader2,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import * as repos from '@/lib/api-repository';
import {
  useSeriesList,
  useDeleteSeriesCascade,
  useArchiveSeries,
  useSetSeriesCategory,
  useReorderSeries,
} from '@/hooks/use-series';
import { useCategories } from '@/hooks/use-categories';
import { useRecentActivity } from '@/hooks/use-activity';
import { formatRelativeTime } from '@/lib/relative-time';
import { queryKeys } from '@/hooks/query-keys';
import { Button } from '@/components/ui/button';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';
import { useFeatures } from '@/components/features-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
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
import type { ActivityEntry, Category, Series } from '@/lib/types';
import {
  parseSeriesFile,
  checkLineage,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type LineageStatus,
} from '@/lib/series-file';
import { parseSailwaveBlw, SailwaveImportError } from '@/lib/sailwave-import';
import { SAILWAVE_HANDOFF_KEY } from '@/app/series/import-sailwave/page';

type ImportFormat = 'sailscoring' | 'sailwave';

type OpenFlow =
  | { step: 'idle' }
  | { step: 'choose-format' }
  | { step: 'confirm-new'; file: SeriesFile; categoryId: string | null }
  | { step: 'disambiguate'; file: SeriesFile; existing: Series }
  | { step: 'confirm-update'; file: SeriesFile; existing: Series; status: LineageStatus }
  | { step: 'working' }
  | { step: 'error'; message: string };

function formatSaveDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === now.toDateString())
    return `last saved today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (d.toDateString() === yesterday.toDateString())
    return `last saved yesterday`;
  return `last saved ${d.toLocaleDateString()}`;
}

function SeriesCard({
  series,
  categories,
  recent,
  onArchive,
  onUnarchive,
  onMove,
  onDeleteClick,
  sortable,
}: {
  series: Series;
  categories: Category[];
  recent?: ActivityEntry;
  onArchive: (series: Series) => void;
  onUnarchive: (series: Series) => void;
  onMove: (series: Series, categoryId: string | null) => void;
  onDeleteClick: (series: Series) => void;
  /** Present for active rows that can be drag-reordered. */
  sortable?: SortableRenderProps;
}) {
  const archived = series.archived ?? false;
  return (
    <div
      ref={sortable?.ref}
      style={sortable?.style}
      data-testid="series-row"
      className="flex items-center gap-1 border rounded-lg px-5 py-4 hover:bg-accent/50 transition-colors"
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
              <DropdownMenuItem onClick={() => onArchive(series)}>
                <Archive className="h-4 w-4" />
                Archive
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { has } = useFeatures();
  const { seriesRepo } = repos;
  const { data: seriesList } = useSeriesList();
  const { data: categories } = useCategories();
  const { data: recentById } = useRecentActivity();
  const deleteCascade = useDeleteSeriesCascade();
  const archiveSeries = useArchiveSeries();
  const setSeriesCategory = useSetSeriesCategory();
  const reorderSeries = useReorderSeries();
  const [pendingDelete, setPendingDelete] = useState<Series | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [openFlow, setOpenFlow] = useState<OpenFlow>({ step: 'idle' });
  const [importFormat, setImportFormat] = useState<ImportFormat>('sailscoring');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useGlobalKeyDown((e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      setShowHelp(true);
    }
  });

  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    const seriesId = pendingDelete.id;
    setPendingDelete(null);
    await deleteCascade.mutateAsync(seriesId);
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

  function handleImportSeriesClick() {
    setOpenFlow({ step: 'choose-format' });
  }

  function handleFormatChosen(format: ImportFormat) {
    setImportFormat(format);
    setOpenFlow({ step: 'idle' });
    // Defer the picker open one tick so the dialog has finished closing —
    // some browsers swallow the .click() if it fires during the dialog
    // unmount animation.
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (importFormat === 'sailwave') {
      try {
        const bytes = await file.arrayBuffer();
        const raw = parseSailwaveBlw(bytes);
        sessionStorage.setItem(
          SAILWAVE_HANDOFF_KEY,
          JSON.stringify({ fileName: file.name, raw }),
        );
        router.push('/series/import-sailwave');
      } catch (err) {
        setOpenFlow({
          step: 'error',
          message: err instanceof SailwaveImportError
            ? err.message
            : `Could not read Sailwave file: ${(err as Error).message}`,
        });
      }
      return;
    }

    let parsed: SeriesFile;
    try {
      const content = await file.text();
      parsed = parseSeriesFile(content);
    } catch (err) {
      setOpenFlow({
        step: 'error',
        message: err instanceof Error ? err.message : 'Could not read file.',
      });
      return;
    }

    setOpenFlow({ step: 'working' });

    try {
      // Check if a series with the same seriesId already exists
      const all = await seriesRepo.list();
      const existing = all.find((s) => s.id === parsed.seriesId);

      if (!existing) {
        // No match — open as new. When the workspace has categories, pause on
        // a confirm step so the scorer can file it (and eyeball the details);
        // otherwise open straight through to keep the common case one-click.
        if ((categories?.length ?? 0) > 0) {
          setOpenFlow({ step: 'confirm-new', file: parsed, categoryId: null });
          return;
        }
        await openNewFromFile(parsed, null);
        return;
      }

      setOpenFlow({ step: 'disambiguate', file: parsed, existing });
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: 'Failed to open series. Please try again.' });
    }
  }

  // Open a parsed file as a brand-new series, optionally filed under a category.
  // No invalidateQueries: the navigation unmounts this page, aborting the
  // refetch and logging a "Failed to fetch" console.error that the e2e
  // console-monitor treats as a failure. The new series's own pages refetch
  // what they need on mount.
  async function openNewFromFile(file: SeriesFile, categoryId: string | null) {
    setOpenFlow({ step: 'working' });
    try {
      const newId = await openSeriesFromFile(file, repos, { categoryId });
      router.push(`/series/${newId}/races`);
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: 'Failed to open series. Please try again.' });
    }
  }

  async function handleDisambiguate(choice: 'update' | 'new-copy') {
    if (openFlow.step !== 'disambiguate') return;
    const { file, existing } = openFlow;

    if (choice === 'new-copy') {
      setOpenFlow({ step: 'working' });
      try {
        const newId = await openSeriesFromFile(file, repos);
        router.push(`/series/${newId}/races`);
      } catch (err) {
        console.error(err);
        setOpenFlow({ step: 'error', message: 'Failed to open series. Please try again.' });
      }
      return;
    }

    // Run lineage check
    const status = checkLineage(existing, file);
    setOpenFlow({ step: 'confirm-update', file, existing, status });
  }

  async function handleConfirmUpdate(asNewCopy: boolean) {
    if (openFlow.step !== 'confirm-update') return;
    const { file, existing } = openFlow;
    setOpenFlow({ step: 'working' });
    try {
      if (asNewCopy) {
        const newId = await openSeriesFromFile(file, repos);
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(existing.id, file, repos);
        // The file-replay path bypasses the React Query cache; force every
        // affected query to refetch before we route to the next page.
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.races.bySeries(existing.id) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.finishes.all });
        await queryClient.invalidateQueries({ queryKey: queryKeys.raceStarts.all });
        router.push(`/series/${existing.id}/races`);
      }
    } catch (err) {
      console.error(err);
      setOpenFlow({ step: 'error', message: 'Failed to open series. Please try again.' });
    }
  }

  const flowFile = openFlow.step === 'disambiguate' || openFlow.step === 'confirm-update'
    ? openFlow.file
    : null;
  const flowExisting = openFlow.step === 'disambiguate' || openFlow.step === 'confirm-update'
    ? openFlow.existing
    : null;

  const cats = categories ?? [];
  const allSeries = seriesList ?? [];
  const activeGroups = groupActiveByCategory(
    allSeries.filter((s) => !s.archived),
    cats,
  );
  const archivedGroups = groupArchivedByYear(allSeries.filter((s) => s.archived));
  const archivedCount = archivedGroups.reduce((n, g) => n + g.series.length, 0);
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
      sortable={sortable}
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleImportSeriesClick}>
            Import Series
          </Button>
          <Button asChild>
            <Link href="/series/new">New series</Link>
          </Button>
        </div>
      </div>

      {seriesList === undefined && (
        <p className="text-muted-foreground">Loading…</p>
      )}

      {seriesList !== undefined && seriesList.length === 0 && (
        <p className="text-muted-foreground">
          No series yet.{' '}
          <Link href="/series/new" className="underline">
            Create your first series
          </Link>{' '}
          or{' '}
          <button className="underline" onClick={handleImportSeriesClick}>
            import a series file
          </button>
          {' '}to get started.
        </p>
      )}

      {seriesList !== undefined && seriesList.length > 0 && (
        <div className="space-y-6">
          {/* Active series, partitioned by category — drag-reorder within a group */}
          {flatActive ? (
            <div className="space-y-2">
              {activeGroups[0] && renderActiveGroup(activeGroups[0])}
            </div>
          ) : (
            activeGroups.map((g) => (
              <section key={groupKey(g)} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={importFormat === 'sailwave' ? '.blw' : '.sailscoring,application/json'}
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Format-choice dialog (first step of Import) */}
      <Dialog
        open={openFlow.step === 'choose-format'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Series</DialogTitle>
            <DialogDescription>What kind of file would you like to import?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              data-testid="import-format-sailscoring"
              className="w-full text-left border rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors"
              onClick={() => handleFormatChosen('sailscoring')}
            >
              <div className="font-medium">Sail Scoring file</div>
              <div className="text-sm text-muted-foreground">A <span className="font-mono">.sailscoring</span> file saved from this app.</div>
            </button>
            {has('sailwave-import') && (
              <button
                type="button"
                data-testid="import-format-sailwave"
                className="w-full text-left border rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors"
                onClick={() => handleFormatChosen('sailwave')}
              >
                <div className="font-medium">Sailwave file</div>
                <div className="text-sm text-muted-foreground">A <span className="font-mono">.blw</span> series file from Sailwave.</div>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm new-series import (.sailscoring) — pick a category */}
      <Dialog
        open={openFlow.step === 'confirm-new'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Import &ldquo;{openFlow.step === 'confirm-new' ? openFlow.file.series.name : ''}&rdquo;?
            </DialogTitle>
            <DialogDescription>
              This will open the file as a new series in your scoring app.
            </DialogDescription>
          </DialogHeader>
          {openFlow.step === 'confirm-new' && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                {openFlow.file.series.venue && (
                  <div>
                    <span className="text-muted-foreground">Venue:</span> {openFlow.file.series.venue}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{openFlow.file.competitors.length} competitors</Badge>
                  <Badge variant="secondary">{openFlow.file.races.length} races</Badge>
                  <Badge variant="secondary">{openFlow.file.fleets.length} fleets</Badge>
                  <Badge variant="outline">
                    Saved {new Date(openFlow.file.exportedAt).toLocaleDateString()}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-category">Category</Label>
                <Select
                  value={openFlow.categoryId ?? 'none'}
                  onValueChange={(v) =>
                    setOpenFlow((prev) =>
                      prev.step === 'confirm-new'
                        ? { ...prev, categoryId: v === 'none' ? null : v }
                        : prev,
                    )
                  }
                >
                  <SelectTrigger id="import-category" className="w-full" data-testid="import-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorized</SelectItem>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (openFlow.step !== 'confirm-new') return;
                openNewFromFile(openFlow.file, openFlow.categoryId);
              }}
            >
              Open series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} />

      {/* Delete dialog */}
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{pendingDelete?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This will permanently delete the series and all its competitors, races, and results.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
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

      {/* Disambiguate dialog */}
      <Dialog
        open={openFlow.step === 'disambiguate'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>&ldquo;{flowExisting?.name}&rdquo; is already in your workspace</DialogTitle>
            <DialogDescription>
              The file you opened and the copy in your workspace are the same series.
              What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleDisambiguate('new-copy')}>
              Open as a new copy
            </Button>
            <Button onClick={() => handleDisambiguate('update')}>
              Update the workspace copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm clean update dialog */}
      <Dialog
        open={openFlow.step === 'confirm-update' && openFlow.status === 'clean'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{flowExisting?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This file is a newer version of your workspace copy.{' '}
              {flowFile && `Saved on ${new Date(flowFile.exportedAt).toLocaleString()}.`}
              {' '}Your workspace copy will be replaced. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Identical snapshot dialog */}
      <Dialog
        open={openFlow.step === 'confirm-update' && openFlow.status === 'identical'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing to update</DialogTitle>
            <DialogDescription>
              This file matches your workspace copy. No changes were made.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpenFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diverged dialog */}
      <Dialog
        open={openFlow.step === 'confirm-update' && openFlow.status === 'diverged'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠ This file conflicts with your workspace copy</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This file and your workspace copy appear to have diverged — both have changes
                  the other doesn&apos;t.
                </p>
                {flowFile && flowExisting && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(flowFile.exportedAt).toLocaleString()}</p>
                    <p>Workspace copy: last modified {new Date(flowExisting.lastModifiedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmUpdate(true)}>
              Open as a new copy
            </Button>
            <Button variant="destructive" onClick={() => handleConfirmUpdate(false)}>
              Replace workspace copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Working dialog */}
      <Dialog open={openFlow.step === 'working'}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Opening series…</DialogTitle>
            <DialogDescription>
              Loading the series file. This may take a moment for large series.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Error dialog */}
      <Dialog
        open={openFlow.step === 'error'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open file</DialogTitle>
            <DialogDescription>
              {openFlow.step === 'error' ? openFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpenFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
