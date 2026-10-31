'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PerFleetPoints } from '@/components/per-fleet-points';
import { seedFromFinish, toStorage, type PerFleetPointsValue } from '@/lib/per-fleet-points';
import type { PenaltyCode } from '@/lib/types';

export interface PenaltyDraft {
  code: PenaltyCode | null;
  override: number | null;
  overrideByFleet: Record<string, number> | null;
  /** SCP only: `override` / `overrideByFleet` are stated points, not a %. */
  inPoints: boolean;
  /** DPI only: what the penalty was given for, in the scorer's words. */
  label: string | null;
}

export interface PenaltyEditorDialogProps {
  /** When non-null, the dialog is open. */
  competitor: { id: string; sailNumber: string } | null;
  initialPenalty: { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null; inPoints?: boolean; label?: string } | null;
  /** Labels already used on DPIs in this race, offered as suggestions. A
   *  penalty like a tally offence lands on several boats at once, and
   *  re-typing it is how one reason acquires three spellings. */
  knownLabels?: string[];
  /** The fleets this competitor is entered in. More than one enables
   *  per-fleet points for a DPI or an SCP stated in points. */
  competitorFleets: { id: string; name: string }[];
  onApply: (draft: PenaltyDraft) => void;
  onCancel: () => void;
}

export function PenaltyEditorDialog(props: PenaltyEditorDialogProps) {
  // Remount per open so form state is fresh.
  if (!props.competitor) return null;
  return (
    <PenaltyEditorDialogInner
      key={props.competitor.id}
      {...props}
      competitor={props.competitor}
    />
  );
}

function PenaltyEditorDialogInner({
  competitor,
  initialPenalty,
  competitorFleets,
  knownLabels,
  onApply,
  onCancel,
}: PenaltyEditorDialogProps & { competitor: { id: string; sailNumber: string } }) {
  const [code, setCode] = useState<PenaltyCode | 'none'>(initialPenalty?.code ?? 'none');
  // An SCP is the points the NoR or SIs state (rule 44.3(c)), or a percentage
  // of the DNF score — 20% when no number is stated.
  const [scpInPoints, setScpInPoints] = useState<boolean>(
    initialPenalty?.code === 'SCP' && !!initialPenalty.inPoints,
  );
  // A percentage is a single rate (already per-fleet via the DNF base), so it
  // keeps a plain input. Stated points — a DPI's, or an SCP's — may differ per
  // fleet for a multi-fleet boat.
  const initialIsPoints = initialPenalty?.code === 'DPI' || (initialPenalty?.code === 'SCP' && !!initialPenalty.inPoints);
  const [override, setOverride] = useState<string>(
    !initialIsPoints && initialPenalty?.override != null ? String(initialPenalty.override) : '',
  );
  const [label, setLabel] = useState<string>(initialPenalty?.label ?? '');
  const fleetIds = competitorFleets.map((f) => f.id);
  const [points, setPoints] = useState<PerFleetPointsValue>(
    seedFromFinish(
      initialIsPoints ? initialPenalty.override : null,
      initialIsPoints ? initialPenalty.overrideByFleet : null,
      fleetIds,
    ),
  );
  const statedPoints = code === 'DPI' || (code === 'SCP' && scpInPoints);
  // An SCP in points has no default to fall back on: rule 44.3(c)'s default
  // is the percentage.
  const missingScpPoints = code === 'SCP' && scpInPoints && (() => {
    const { scalar, byFleet } = toStorage(points, fleetIds);
    return scalar == null && !byFleet;
  })();

  function apply() {
    if (missingScpPoints) return;
    if (code === 'none') {
      onApply({ code: null, override: null, overrideByFleet: null, inPoints: false, label: null });
      return;
    }
    if (statedPoints) {
      const { scalar, byFleet } = toStorage(points, fleetIds);
      onApply({
        code,
        override: scalar,
        overrideByFleet: byFleet ?? null,
        inPoints: code === 'SCP',
        label: code === 'DPI' ? label.trim() || null : null,
      });
      return;
    }
    onApply({
      code,
      override: override.trim() ? Number(override) : null,
      overrideByFleet: null,
      inPoints: false,
      label: null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Scoring penalty — {competitor.sailNumber}</DialogTitle>
          <DialogDescription>
            Additive penalty codes (A6.2): other boats keep their scores.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Penalty</label>
            <Select
              value={code}
              onValueChange={(v) => { setCode(v as PenaltyCode | 'none'); setOverride(''); setLabel(''); setScpInPoints(false); setPoints({ mode: 'uniform', value: '' }); }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No penalty</SelectItem>
                <SelectItem value="ZFP">ZFP — Z Flag (20%)</SelectItem>
                <SelectItem value="SCP">SCP — Scoring Penalty</SelectItem>
                <SelectItem value="DPI">DPI — Discretionary Points</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {code === 'SCP' && (
            <div className="space-y-1.5">
              <span className="text-sm font-medium" id="scp-unit-label">Stated as</span>
              <div role="radiogroup" aria-labelledby="scp-unit-label" className="flex w-fit rounded-md border text-sm">
                {([
                  [false, '% of DNF score'],
                  [true, 'Points'],
                ] as const).map(([inPoints, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={scpInPoints === inPoints}
                    className={`px-3 py-1 ${scpInPoints === inPoints ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => setScpInPoints(inPoints)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Rule 44.3(c): the number of points the notice of race or sailing
                instructions state, or 20% of the DNF score when they state none.
              </p>
            </div>
          )}
          {code === 'SCP' && !scpInPoints && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="scp-percentage">Percentage (default 20)</label>
              <Input
                id="scp-percentage"
                type="number"
                min={1}
                max={100}
                placeholder="20"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
                autoFocus
              />
            </div>
          )}
          {code === 'SCP' && scpInPoints && (
            <PerFleetPoints
              label="Points to add"
              fleets={competitorFleets}
              value={points}
              onChange={setPoints}
              min={0.1}
              placeholder="e.g. 2"
              autoFocus
              onSubmit={apply}
            />
          )}
          {code === 'DPI' && (
            <>
              <PerFleetPoints
                label="Points to add"
                fleets={competitorFleets}
                value={points}
                onChange={setPoints}
                min={1}
                placeholder="e.g. 2"
                autoFocus
                onSubmit={apply}
              />
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="penalty-label">
                  What it was for (optional)
                </label>
                <Input
                  id="penalty-label"
                  list={knownLabels?.length ? 'penalty-label-suggestions' : undefined}
                  maxLength={24}
                  placeholder="e.g. TPO"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
                />
                {knownLabels?.length ? (
                  <datalist id="penalty-label-suggestions">
                    {knownLabels.map((l) => <option key={l} value={l} />)}
                  </datalist>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Shown on the results in place of DPI, with a note beneath the table
                  saying what it is. The score comes from the points above — the label
                  only explains it.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={apply} disabled={missingScpPoints}>Apply</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
