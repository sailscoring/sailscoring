'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { ResolveUnknownDialog } from '@/components/resolve-unknown-dialog';
import { useSaveCompetitor } from '@/hooks/use-competitors';
import type { FinishEntry, NonFinisherView } from '@/lib/finish-entry';
import type { Competitor, CompetitorFieldKey, Finish, Fleet } from '@/lib/types';

export interface ResolveUnknownHandle {
  /** Open the resolve dialog for one unknown-sail row. */
  open: (entry: FinishEntry & { kind: 'unknown' }) => void;
}

/**
 * Owns the "resolve an unknown sail number" dialog: link the row to an
 * existing competitor, or create a new competitor and link it. Opened
 * imperatively from the finish tab's Resolve buttons via the ref handle.
 */
export const ResolveUnknownController = forwardRef<ResolveUnknownHandle, {
  seriesId: string;
  finishByEntryKey: Map<string, Finish>;
  nonFinishers: NonFinisherView[];
  fleets: Fleet[];
  primaryFieldLabel: string;
  showCrew: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: {
    mutate: (f: Finish) => unknown;
    mutateAsync: (f: Finish) => Promise<unknown>;
  };
  /** Called after the dialog closes (resolve or cancel) — refocus the entry box. */
  onClosed: () => void;
}>(function ResolveUnknownController(
  {
    seriesId, finishByEntryKey, nonFinishers, fleets,
    primaryFieldLabel, showCrew, enabledCompetitorFields,
    patchCache, saveFinish, onClosed,
  },
  ref,
) {
  const saveCompetitor = useSaveCompetitor();
  const [resolvingEntry, setResolvingEntry] = useState<(FinishEntry & { kind: 'unknown' }) | null>(null);

  useImperativeHandle(ref, () => ({ open: setResolvingEntry }));

  function closeResolveDialog() {
    setResolvingEntry(null);
    onClosed();
  }

  function linkUnknownToCompetitor(competitorId: string) {
    if (!resolvingEntry) return;
    const finish = finishByEntryKey.get(resolvingEntry.finishId);
    if (finish) {
      const next: Finish = {
        ...finish,
        competitorId,
        unknownSailNumber: undefined,
      };
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      saveFinish.mutate(next);
    }
    closeResolveDialog();
  }

  async function handleResolveNew(input: { sailNumber: string; name: string; fleetId: string }) {
    if (!resolvingEntry) return;
    const createdAt = Date.now();
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      fleetIds: input.fleetId ? [input.fleetId] : [],
      sailNumber: input.sailNumber,
      name: input.name,
      club: '',
      gender: '',
      age: null,
      createdAt,
    };
    await saveCompetitor.mutateAsync(competitor);

    const finish = finishByEntryKey.get(resolvingEntry.finishId);
    if (finish) {
      const next: Finish = {
        ...finish,
        competitorId: competitor.id,
        unknownSailNumber: undefined,
      };
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      await saveFinish.mutateAsync(next);
    }
    closeResolveDialog();
  }

  return (
    <ResolveUnknownDialog
      unknownSailNumber={resolvingEntry?.sailNumber ?? null}
      candidates={nonFinishers.map((nf) => nf.competitor)}
      fleets={fleets}
      primaryFieldLabel={primaryFieldLabel}
      showCrew={showCrew}
      enabledCompetitorFields={enabledCompetitorFields}
      onResolveExisting={linkUnknownToCompetitor}
      onResolveNew={handleResolveNew}
      onCancel={closeResolveDialog}
    />
  );
});
