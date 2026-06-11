'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useArchiveSeries, useDeleteSeriesCascade } from '@/hooks/use-series';
import type { Series } from '@/lib/types';

export /**
 * Series lifecycle (#154). Archiving makes the series read-only and collapses
 * it into the home Archived section; delete is gated behind archiving first
 * (the server enforces this too), so the destructive action takes two
 * deliberate steps.
 */
function ArchiveCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const router = useRouter();
  const archiveSeries = useArchiveSeries();
  const deleteCascade = useDeleteSeriesCascade();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = series.archived ?? false;

  async function handleDelete() {
    setConfirmDelete(false);
    await deleteCascade.mutateAsync(seriesId);
    router.push('/');
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Archive</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {archived
            ? 'This series is archived and read-only. Unarchive it to edit, or delete it permanently.'
            : 'Archiving moves this series into the Archived section and makes it read-only. You can unarchive at any time.'}
        </p>
      </div>
      <div className="flex gap-2">
        {archived ? (
          <>
            <Button
              variant="outline"
              disabled={archiveSeries.isPending}
              onClick={() => archiveSeries.mutate({ id: seriesId, archived: false })}
            >
              <ArchiveRestore className="h-4 w-4" />
              Unarchive
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Delete series
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={archiveSeries.isPending}
            onClick={() => archiveSeries.mutate({ id: seriesId, archived: true })}
          >
            <Archive className="h-4 w-4" />
            Archive series
          </Button>
        )}
      </div>
      {!archived && (
        <p className="text-xs text-muted-foreground">
          A series must be archived before it can be deleted.
        </p>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the series and all its competitors,
              races, and results. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
