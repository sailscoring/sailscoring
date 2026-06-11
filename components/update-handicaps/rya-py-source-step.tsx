'use client';

import { useMemo, useState } from 'react';

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RYA_PY_VERSION } from '@/lib/rya-py/generated/py-list';
import { planRyaPyUpdates, type PyClassProposal } from '@/lib/source-handicaps';

import { RyaPyPreview, buildRyaPyUpdates } from './rya-py-preview';
import { StepFooter, type SourceStepProps } from './shared';

/**
 * RYA Portsmouth Yardstick source: match each boat's class against the
 * bundled RYA PY list (no fetch) and propose its PY number, with per-class
 * opt-outs of the rename / set-number halves of each proposal.
 */
export function RyaPySourceStep({
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  // Manual class resolution (enteredKey → classKey | '__skip__'), and
  // per-class opt-outs of the rename / set-number halves of a proposal.
  const [chosenByClass, setChosenByClass] = useState<Record<string, string>>({});
  const [renameOff, setRenameOff] = useState<Set<string>>(new Set());
  const [numberOff, setNumberOff] = useState<Set<string>>(new Set());

  // Proposals are pure over the bundled dataset — one per distinct class
  // across the series' PY fleets.
  const proposals = useMemo<PyClassProposal[]>(() => {
    if (!competitors || !fleets) return [];
    return planRyaPyUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      chosenByClass,
    });
  }, [competitors, fleets, chosenByClass]);

  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  const updateRows = useMemo(
    () => buildRyaPyUpdates(proposals, targetCompetitorById, renameOff, numberOff),
    [proposals, targetCompetitorById, renameOff, numberOff],
  );

  function handleApply() {
    const renamed = updateRows.filter((r) => r.boatClass !== undefined).length;
    const numberChanged = updateRows.filter((r) => r.pyNumber !== undefined).length;
    const resolvedKeys = new Set(
      proposals.filter((p) => p.resolved).map((p) => p.enteredKey),
    );
    const notFound = proposals
      .filter((p) => !resolvedKeys.has(p.enteredKey))
      .reduce((n, p) => n + p.affected.length, 0);
    onApply(updateRows, {
      bySystem: { py: numberChanged },
      unchanged: 0,
      notFound,
      added: 0,
      renamed,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from the RYA PY list</DialogTitle>
        <DialogDescription>
          We match each boat&apos;s class against the RYA Portsmouth Yardstick list and
          propose its PY number. Tick whether to also normalise the class name.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <RyaPyPreview
          proposals={proposals}
          targetCompetitorById={targetCompetitorById}
          renameOff={renameOff}
          numberOff={numberOff}
          onToggleRename={(key, on) =>
            setRenameOff((prev) => {
              const next = new Set(prev);
              if (on) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onToggleNumber={(key, on) =>
            setNumberOff((prev) => {
              const next = new Set(prev);
              if (on) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          onChoose={(key, value) =>
            setChosenByClass((prev) => ({ ...prev, [key]: value }))
          }
        />

        <p className="text-xs text-muted-foreground">
          RYA Portsmouth Number List {RYA_PY_VERSION.year} (base v{RYA_PY_VERSION.base},
          limited-data v{RYA_PY_VERSION.limitedData}).
        </p>

        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
      </div>

      <StepFooter
        onCancel={onCancel}
        onApply={handleApply}
        disabled={updateRows.length === 0 || applying}
        applying={applying}
        count={updateRows.length}
      />
    </>
  );
}
