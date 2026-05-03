'use client';

/**
 * Row-scoped conflict dialog for the autosave finish-entry page
 * (ADR-008 Phase 6, #111).
 *
 * Opens when a per-row finish mutation 409s — the row was edited
 * elsewhere (another tab today; another scorer once Phase 7 lands).
 * The dialog identifies the affected row and offers two paths:
 *
 *  - "Keep my change": refetch the row to pick up the fresh `version`,
 *    then retry the user's payload against the new baseline.
 *  - "Use the current value": discard the local edit and accept the
 *    server's row.
 *
 * Phase 7 will populate `actor` from the `updated_by` column; until
 * then the dialog says "edited elsewhere".
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface RowConflictInfo {
  /** Stable id of the conflicting Finish row. */
  finishId: string;
  /**
   * Human-readable row label, e.g. "Row 4 (sail 1234, Alice)" or
   * "DNF row for sail 9999". The page builds this from the cached
   * row + competitor data at the moment of conflict.
   */
  rowLabel: string;
  /** ISO-8601 of the row's `updated_at` at the moment of conflict. */
  updatedAt?: string;
  /** Phase 7 — display name of the actor who beat us to the write. */
  actor?: { displayName?: string; email?: string };
}

export function RowConflictDialog({
  info,
  retrying,
  onKeepMine,
  onUseCurrent,
  onDismiss,
}: {
  info: RowConflictInfo | null;
  /** True while a "Keep mine" retry is in flight. */
  retrying?: boolean;
  onKeepMine: () => void;
  onUseCurrent: () => void;
  onDismiss: () => void;
}) {
  const actorLabel =
    info?.actor?.displayName || info?.actor?.email || 'elsewhere';
  const updatedAt = info?.updatedAt
    ? new Date(info.updatedAt).toLocaleTimeString()
    : null;
  return (
    <Dialog
      open={info !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <DialogContent className="max-w-md" data-testid="row-conflict-dialog">
        <DialogHeader>
          <DialogTitle>Edited elsewhere</DialogTitle>
          <DialogDescription>
            {info?.rowLabel} was edited {actorLabel}
            {updatedAt ? ` at ${updatedAt}` : ''}. Your change wasn&rsquo;t
            saved.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-2">
          Keep your change to overwrite the other edit, or use the current
          value to accept it. Either way the row is refreshed from the
          server.
        </p>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            onClick={onUseCurrent}
            disabled={retrying}
            data-testid="conflict-use-current"
          >
            Use the current value
          </Button>
          <Button
            onClick={onKeepMine}
            disabled={retrying}
            data-testid="conflict-keep-mine"
          >
            {retrying ? 'Saving…' : 'Keep my change'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
