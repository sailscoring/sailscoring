'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { ResolveUnknownDialog } from '@/components/resolve-unknown-dialog';
import { useSaveCompetitor } from '@/hooks/use-competitors';
import { useUpdateSeries } from '@/hooks/use-series';
import { ALL_COMPETITOR_FIELDS, addAlternativeSailNumber } from '@/lib/competitor-fields';
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
  const updateSeries = useUpdateSeries();
  const [resolvingEntry, setResolvingEntry] = useState<(FinishEntry & { kind: 'unknown' }) | null>(null);

  useImperativeHandle(ref, () => ({ open: setResolvingEntry }));

  function closeResolveDialog() {
    setResolvingEntry(null);
    onClosed();
  }

  function linkUnknownToCompetitor(competitorId: string, opts: { recordAlternative: boolean }) {
    if (!resolvingEntry) return;
    if (opts.recordAlternative) {
      recordAsAlternative(competitorId, resolvingEntry.sailNumber);
    }
    const finish = finishByEntryKey.get(resolvingEntry.finishId);
    if (finish) {
      // Linking clears unknownSailNumber and the row starts displaying the
      // registered number, so without this the number the boat actually
      // showed would be lost — which is the whole reason a scorer typed it.
      const registered =
        nonFinishers.find((v) => v.competitor.id === competitorId)?.competitor.sailNumber ?? '';
      const sailed = resolvingEntry.sailNumber.trim();
      const differs =
        sailed !== '' && sailed.toUpperCase() !== registered.trim().toUpperCase();
      const next: Finish = {
        ...finish,
        competitorId,
        unknownSailNumber: undefined,
        ...(differs
          ? { matchedOn: 'alternative' as const, enteredSailNumber: sailed }
          : { matchedOn: undefined, enteredSailNumber: undefined }),
      };
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      saveFinish.mutate(next);
    }
    closeResolveDialog();
  }

  /** Keep the number the boat actually showed on its entry, so finish entry
   *  matches it from the next race on instead of asking again. The field is
   *  switched on for the series when it isn't already — a stored number the
   *  scorer can neither see nor remove would be worse than not storing it. */
  function recordAsAlternative(competitorId: string, entered: string) {
    const competitor = nonFinishers.find((v) => v.competitor.id === competitorId)?.competitor;
    if (!competitor) return;
    const alternativeSailNumbers = addAlternativeSailNumber(competitor, entered);
    if (!alternativeSailNumbers) return;
    saveCompetitor.mutate({ ...competitor, alternativeSailNumbers });
    if (!enabledCompetitorFields.includes('alternativeSailNumbers')) {
      updateSeries.mutate({
        id: seriesId,
        patch: (s) => ({
          enabledCompetitorFields: ALL_COMPETITOR_FIELDS.filter(
            (f) => f === 'alternativeSailNumbers' || (s.enabledCompetitorFields ?? []).includes(f),
          ),
        }),
      });
    }
  }

  async function handleResolveNew(input: { sailNumber: string; name: string; fleetId: string }) {
    if (!resolvingEntry) return;
    const createdAt = Date.now();
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      fleetIds: input.fleetId ? [input.fleetId] : [],
      sailNumber: input.sailNumber,
      names: [input.name],
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
