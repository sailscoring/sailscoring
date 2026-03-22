'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { seriesRepo, competitorRepo, raceRepo, finishRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Series } from '@/lib/types';

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
        {(series.venue || series.date) && (
          <div className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.date].filter(Boolean).join(' · ')}
          </div>
        )}
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
  const seriesList = useLiveQuery(() => seriesRepo.list(), []);
  const [pendingDelete, setPendingDelete] = useState<Series | null>(null);
  const [showHelp, setShowHelp] = useState(false);

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
    const races = await raceRepo.listBySeries(seriesId);
    await finishRepo.deleteByRaces(races.map((r) => r.id));
    await raceRepo.deleteBySeries(seriesId);
    await competitorRepo.deleteBySeries(seriesId);
    await seriesRepo.delete(seriesId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Series</h1>
        <Button asChild>
          <Link href="/series/new">New series</Link>
        </Button>
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
          to get started.
        </p>
      )}

      {seriesList !== undefined && seriesList.length > 0 && (
        <div className="space-y-2">
          {seriesList.map((s) => (
            <SeriesCard key={s.id} series={s} onDeleteClick={setPendingDelete} />
          ))}
        </div>
      )}

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} />

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
    </div>
  );
}
