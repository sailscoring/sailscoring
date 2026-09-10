'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { Dialog, DialogContent } from '@/components/ui/dialog';

import { UPDATE_HANDICAPS_CONTENT_CLASS, UpdateHandicapsFlow } from './flow';

export interface UpdateHandicapsHandle {
  open: () => void;
}

/**
 * The Update Handicaps dialog: the page-level entry point to the flow. It owns
 * the dialog, the `open` handle the page triggers it through, and the one piece
 * of state that deliberately outlives a run — see `freezeScoredRaces`.
 *
 * Everything else is {@link UpdateHandicapsFlow}, which the competitor importer
 * also hosts as its last step.
 */
export const UpdateHandicaps = forwardRef<UpdateHandicapsHandle, {
  seriesId: string;
}>(function UpdateHandicaps({ seriesId }, ref) {
  const [open, setOpen] = useState(false);
  // Mid-series rating change: keep already-scored races on the old rating
  // (per-race overrides) rather than re-scoring them on the new value. Applies
  // to static systems (IRC/PY); default on. Lives here — not in the flow that
  // renders its checkbox — because its toggle deliberately survives reopening
  // the dialog, and the flow is remounted on every open.
  const [freezeScoredRaces, setFreezeScoredRaces] = useState(true);

  useImperativeHandle(ref, () => ({
    open: () => setOpen(true),
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className={UPDATE_HANDICAPS_CONTENT_CLASS}>
        {/* Radix unmounts the content when the dialog closes, so every run
            starts at the source picker with no state left over from the last
            one — which is why the flow holds no state of its own that the
            scorer would expect to find again. */}
        <UpdateHandicapsFlow
          seriesId={seriesId}
          freezeScoredRaces={freezeScoredRaces}
          onFreezeScoredRacesChange={setFreezeScoredRaces}
          onCancel={() => setOpen(false)}
          onFinish={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
});
