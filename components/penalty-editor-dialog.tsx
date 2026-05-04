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
import type { PenaltyCode } from '@/lib/types';

export interface PenaltyDraft {
  code: PenaltyCode | null;
  override: number | null;
}

export interface PenaltyEditorDialogProps {
  /** When non-null, the dialog is open. */
  competitor: { id: string; sailNumber: string } | null;
  initialPenalty: { code: PenaltyCode; override: number | null } | null;
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
  onApply,
  onCancel,
}: PenaltyEditorDialogProps & { competitor: { id: string; sailNumber: string } }) {
  const [code, setCode] = useState<PenaltyCode | 'none'>(initialPenalty?.code ?? 'none');
  const [override, setOverride] = useState<string>(
    initialPenalty?.override != null ? String(initialPenalty.override) : '',
  );

  function apply() {
    if (code === 'none') {
      onApply({ code: null, override: null });
      return;
    }
    onApply({
      code,
      override: override.trim() ? Number(override) : null,
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
              onValueChange={(v) => { setCode(v as PenaltyCode | 'none'); setOverride(''); }}
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Points to add</label>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 2"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
                autoFocus
              />
            </div>
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
