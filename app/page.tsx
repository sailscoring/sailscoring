'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Trash2 } from 'lucide-react';
import { useRepos } from '@/lib/repos';
import { useSeriesList, useDeleteSeriesCascade } from '@/hooks/use-series';
import { queryKeys } from '@/hooks/query-keys';
import { Button } from '@/components/ui/button';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';
import { MigrationBanner } from '@/components/migration-banner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Series } from '@/lib/types';
import {
  parseSeriesFile,
  checkLineage,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type LineageStatus,
} from '@/lib/series-file';

type OpenFlow =
  | { step: 'idle' }
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
  onDeleteClick,
}: {
  series: Series;
  onDeleteClick: (series: Series) => void;
}) {
  return (
    <div className="flex items-center justify-between border rounded-lg px-5 py-4 hover:bg-accent/50 transition-colors">
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
      </Link>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${series.name}`}
        onClick={(e) => {
          e.preventDefault();
          onDeleteClick(series);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const repos = useRepos();
  const { seriesRepo } = repos;
  const { data: seriesList } = useSeriesList();
  const deleteCascade = useDeleteSeriesCascade();
  const [pendingDelete, setPendingDelete] = useState<Series | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [openFlow, setOpenFlow] = useState<OpenFlow>({ step: 'idle' });
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

  function handleOpenSeriesClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

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
        // No match — open as new
        const newId = await openSeriesFromFile(parsed, repos);
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        router.push(`/series/${newId}/races`);
        return;
      }

      setOpenFlow({ step: 'disambiguate', file: parsed, existing });
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
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Series</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleOpenSeriesClick}>
            Open Series
          </Button>
          <Button asChild>
            <Link href="/series/new">New series</Link>
          </Button>
        </div>
      </div>

      <MigrationBanner />

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
          <button className="underline" onClick={handleOpenSeriesClick}>
            open a series file
          </button>
          {' '}to get started.
        </p>
      )}

      {seriesList !== undefined && seriesList.length > 0 && (
        <div className="space-y-2">
          {seriesList.map((s) => (
            <SeriesCard key={s.id} series={s} onDeleteClick={setPendingDelete} />
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".sailscoring,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />

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
            <DialogTitle>&ldquo;{flowExisting?.name}&rdquo; is already on this device</DialogTitle>
            <DialogDescription>
              The file you opened and the copy on this device are the same series.
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
              Update this device&apos;s copy
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
              This file is a newer version of your local copy.{' '}
              {flowFile && `Saved on ${new Date(flowFile.exportedAt).toLocaleString()}.`}
              {' '}Your local copy will be replaced. This cannot be undone.
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
              This file matches your local copy. No changes were made.
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
            <DialogTitle>⚠ This file conflicts with your local copy</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This file and your local copy appear to have diverged — both have changes
                  the other doesn&apos;t.
                </p>
                {flowFile && flowExisting && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(flowFile.exportedAt).toLocaleString()}</p>
                    <p>Local copy: last modified {new Date(flowExisting.lastModifiedAt).toLocaleString()}</p>
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
              Replace local copy
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
