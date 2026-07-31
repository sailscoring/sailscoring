'use client';

/**
 * "Duplicate…" action on a series, opened from the series-header actions
 * menu — a copy into the same workspace (#330). Unlike "Copy to
 * workspace…" there's no workspace switch, so success soft-routes to the
 * new series after invalidating the series list.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { duplicateSeries } from '@/lib/api-repository';
import { queryKeys } from '@/hooks/query-keys';
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

export function DuplicateSeriesDialog({
  seriesId,
  seriesName,
  open,
  onOpenChange,
}: {
  seriesId: string;
  seriesName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string>(`Copy of ${seriesName}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName(`Copy of ${seriesName}`);
    setError(null);
    setBusy(false);
  }

  function close() {
    onOpenChange(false);
    reset();
  }

  async function handleDuplicate() {
    setBusy(true);
    setError(null);
    try {
      const result = await duplicateSeries(seriesId, {
        name: name.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
      router.push(`/series/${result.id}/competitors`);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not duplicate this series.',
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate &ldquo;{seriesName}&rdquo;</DialogTitle>
          <DialogDescription>
            Makes a copy of this series in the current workspace — competitors,
            races, and results included. Publishing state and FTP paths are not
            carried over.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="duplicate-name">Name</Label>
            <Input
              id="duplicate-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600" role="alert">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={handleDuplicate}
            disabled={busy}
            data-testid="duplicate-series-submit"
          >
            {busy ? 'Duplicating…' : 'Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
