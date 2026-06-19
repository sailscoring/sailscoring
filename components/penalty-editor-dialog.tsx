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
}

export interface PenaltyEditorDialogProps {
  /** When non-null, the dialog is open. */
  competitor: { id: string; sailNumber: string } | null;
  initialPenalty: { code: PenaltyCode; override: number | null; overrideByFleet: Record<string, number> | null } | null;
  /** The fleets this competitor is entered in. More than one enables
   *  per-fleet DPI points. */
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
  onApply,
  onCancel,
}: PenaltyEditorDialogProps & { competitor: { id: string; sailNumber: string } }) {
  const [code, setCode] = useState<PenaltyCode | 'none'>(initialPenalty?.code ?? 'none');
  // SCP percentage is a single rate (already per-fleet via the DNF base), so it
  // keeps a plain input. DPI points may differ per fleet for a multi-fleet boat.
  const [override, setOverride] = useState<string>(
    initialPenalty?.override != null ? String(initialPenalty.override) : '',
  );
  const fleetIds = competitorFleets.map((f) => f.id);
  const [dpiPoints, setDpiPoints] = useState<PerFleetPointsValue>(
    seedFromFinish(
      initialPenalty?.code === 'DPI' ? initialPenalty.override : null,
      initialPenalty?.code === 'DPI' ? initialPenalty.overrideByFleet : null,
      fleetIds,
    ),
  );

  function apply() {
    if (code === 'none') {
      onApply({ code: null, override: null, overrideByFleet: null });
      return;
    }
    if (code === 'DPI') {
      const { scalar, byFleet } = toStorage(dpiPoints, fleetIds);
      onApply({ code, override: scalar, overrideByFleet: byFleet ?? null });
      return;
    }
    onApply({
      code,
      override: override.trim() ? Number(override) : null,
      overrideByFleet: null,
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
              onValueChange={(v) => { setCode(v as PenaltyCode | 'none'); setOverride(''); setDpiPoints({ mode: 'uniform', value: '' }); }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No penalty</SelectItem>
                <SelectItem value="ZFP">ZFP — Z Flag (20%)</SelectItem>
                <SelectItem value="SCP">SCP — Scoring Penalty (%)</SelectItem>
                <SelectItem value="DPI">DPI — Discretionary Points</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {code === 'SCP' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Percentage (default 20)</label>
              <Input
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
          {code === 'DPI' && (
            <PerFleetPoints
              label="Points to add"
              fleets={competitorFleets}
              value={dpiPoints}
              onChange={setDpiPoints}
              min={1}
              placeholder="e.g. 2"
              autoFocus
              onSubmit={apply}
            />
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={apply}>Apply</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
