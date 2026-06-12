'use client';

/**
 * "Create follow-on series…" — roll a series into the next one of the
 * season, opened from the series-list row menu. The new series carries the
 * source's configuration, fleets, and competitors (no races or finishes),
 * with each boat's progressive starting handicap seeded from its
 * end-of-series TCF in the source.
 *
 * Mount with a `key` of the source series id so the name suggestion
 * re-initialises per source.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useCreateFollowOnSeries } from '@/hooks/use-series';
import { suggestFollowOnName } from '@/lib/series-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Series } from '@/lib/types';

export function CreateFollowOnSeriesDialog({
  source,
  existingNames,
  open,
  onOpenChange,
}: {
  source: Series;
  /** All series names in the workspace, for the name suggestion. */
  existingNames: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const createFollowOn = useCreateFollowOnSeries();
  const [name, setName] = useState(() =>
    suggestFollowOnName(source.name, existingNames),
  );
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const result = await createFollowOn.mutateAsync({
        sourceSeriesId: source.id,
        name: name.trim() || undefined,
        startDate: startDate || undefined,
      });
      router.push(`/series/${result.id}/competitors`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not create the follow-on series.',
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create follow-on series</DialogTitle>
          <DialogDescription>
            Start the next series from &ldquo;{source.name}&rdquo;: same
            settings, fleets, and competitors, with no races. Each boat&apos;s
            progressive handicap carries over from the last scored race.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="follow-on-name">Name</Label>
            <Input
              id="follow-on-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="follow-on-start-date">Start date</Label>
            <Input
              id="follow-on-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={busy || name.trim().length === 0}
            data-testid="follow-on-submit"
          >
            {busy ? 'Creating…' : 'Create series'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
