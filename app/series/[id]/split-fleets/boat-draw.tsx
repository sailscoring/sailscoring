'use client';

// Boats drawn per fleet, at a championship that supplies its boats and draws
// them again for every stage (`SplitFleetConfig.boatAssignments`). They are
// entered where fleets are: in the Boat column of an assignment dialog, and
// afterwards from a round's fleet chip, which opens the fleet's list. A boat
// is shared between the fleets of a round — one helm in each — and never
// between two helms racing each other.

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { FleetChip, type FleetMeta } from '@/components/split-fleet-standings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSetSplitFleetBoats } from '@/hooks/use-split-fleets';
import { compareSailNumbersIgnoringPrefix } from '@/lib/sail-number-sort';
import { duplicateBoats, fleetMembers } from '@/lib/split-fleets';
import type { SplitFleetData, SplitRound } from '@/lib/split-fleets';

/** What a boat column is given: the boats typed so far, where to send an
 *  edit, and which rows hold a boat drawn twice in their fleet. */
export interface BoatColumn {
  values: Record<string, string>;
  onChange: (competitorId: string, boat: string) => void;
  /** A column of numbers pasted into one row: it and the rows below it, in
   *  table order. */
  onPasteDown: (fromCompetitorId: string, boats: string[]) => void;
  duplicateIds: ReadonlySet<string>;
}

/** The boats an assignment dialog is drawing, keyed by competitor. */
export function useBoatDraw(order: readonly string[]) {
  const [values, setValues] = useState<Record<string, string>>({});
  const column = (duplicateIds: ReadonlySet<string>): BoatColumn => ({
    values,
    duplicateIds,
    onChange: (cid, boat) => setValues((v) => ({ ...v, [cid]: boat })),
    onPasteDown: (from, boats) =>
      setValues((v) => {
        const next = { ...v };
        const start = order.indexOf(from);
        boats.forEach((boat, i) => {
          const cid = order[start + i];
          if (cid) next[cid] = boat;
        });
        return next;
      }),
  });
  /** The boats to commit: typed and belonging to an assigned entry. */
  const payload = (assigned: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(
      Object.entries(values)
        .map(([cid, boat]) => [cid, boat.trim()] as const)
        .filter(([cid, boat]) => boat && assigned[cid] != null),
    );
  return { values, column, payload };
}

/**
 * Rows whose boat is drawn twice within their fleet, and the sentence that
 * says so. `rows` carry the fleet each is assigned to (`to`, a label).
 */
export function boatClashes(
  rows: readonly { id: string; to: string }[],
  values: Record<string, string>,
): { duplicateIds: Set<string>; message: string | null } {
  const byFleet = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.to) continue;
    byFleet.set(r.to, [...(byFleet.get(r.to) ?? []), r.id]);
  }
  const duplicateIds = new Set<string>();
  const clashes: string[] = [];
  for (const [fleet, ids] of byFleet) {
    const dup = duplicateBoats(ids.map((id) => values[id]));
    if (dup.length === 0) continue;
    const keys = new Set(dup.map((b) => b.toUpperCase()));
    for (const id of ids) {
      if (keys.has(values[id]?.trim().toUpperCase() ?? '')) duplicateIds.add(id);
    }
    clashes.push(`${dup.join(', ')} in ${fleet}`);
  }
  return {
    duplicateIds,
    message: clashes.length
      ? `Boat ${clashes.join('; ')} is drawn for more than one entry — each boat once per fleet.`
      : null,
  };
}

/**
 * One row's boat box. Enter moves to the next row's box, so a draw read out
 * at the briefing is typed straight down the column; pasting several lines
 * fills this row and the ones below it.
 */
export function BoatCell({
  competitorId,
  label,
  column,
}: {
  competitorId: string;
  /** Who the box is for, for its accessible name. */
  label: string;
  column: BoatColumn;
}) {
  const clash = column.duplicateIds.has(competitorId);
  return (
    <input
      data-boat-cell
      className={`w-20 rounded border bg-background px-1 py-0.5 font-mono text-xs${
        clash ? ' border-destructive text-destructive' : ''
      }`}
      aria-label={`Boat for ${label}`}
      aria-invalid={clash || undefined}
      value={column.values[competitorId] ?? ''}
      onChange={(e) => column.onChange(competitorId, e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const cells = [
          ...(e.currentTarget.closest('table')?.querySelectorAll<HTMLInputElement>('[data-boat-cell]') ?? []),
        ];
        cells[cells.indexOf(e.currentTarget) + 1]?.focus();
      }}
      onPaste={(e) => {
        const lines = e.clipboardData
          .getData('text')
          .split(/\r?\n|\t/)
          .map((l) => l.trim());
        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
        if (lines.length < 2) return;
        e.preventDefault();
        column.onPasteDown(competitorId, lines);
      }}
    />
  );
}

/** How many of a round's entries have no boat drawn yet. */
export function boatsNotDrawn(data: SplitFleetData, round: SplitRound): number {
  return round.fleetIds.reduce(
    (n, fid) =>
      n + fleetMembers(data.competitors, fid).filter((c) => !c.fleetSailNumbers?.[fid]?.trim()).length,
    0,
  );
}

/**
 * A round's fleet chip. Where boats are drawn it opens the fleet's list, to
 * draw them after the commit, fix one, or put a spare in for a broken boat.
 */
export function RoundFleetChip({
  seriesId,
  data,
  round,
  fleetId,
  meta,
  canEdit,
}: {
  seriesId: string;
  data: SplitFleetData;
  round: SplitRound;
  fleetId: string;
  meta: FleetMeta;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = fleetMembers(data.competitors, fleetId).length;
  if (!data.config.boatAssignments) return <FleetChip meta={meta} count={count} />;
  return (
    <>
      <button
        type="button"
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={`${meta.label} boats`}
        onClick={() => setOpen(true)}
      >
        <FleetChip meta={meta} count={count} />
      </button>
      {open && (
        <FleetBoatsDialog
          seriesId={seriesId}
          data={data}
          round={round}
          fleetId={fleetId}
          meta={meta}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FleetBoatsDialog({
  seriesId,
  data,
  round,
  fleetId,
  meta,
  canEdit,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  round: SplitRound;
  fleetId: string;
  meta: FleetMeta;
  canEdit: boolean;
  onClose: () => void;
}) {
  const save = useSetSplitFleetBoats(seriesId);
  const members = useMemo(
    () =>
      fleetMembers(data.competitors, fleetId).sort((a, b) =>
        compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber),
      ),
    [data.competitors, fleetId],
  );
  const stored = useMemo(
    () => Object.fromEntries(members.map((c) => [c.id, c.fleetSailNumbers?.[fleetId] ?? ''])),
    [members, fleetId],
  );
  const draw = useBoatDraw(members.map((c) => c.id));
  const values = { ...stored, ...draw.values };
  const { duplicateIds, message } = boatClashes(
    members.map((c) => ({ id: c.id, to: meta.label })),
    values,
  );
  const column = { ...draw.column(duplicateIds), values };
  const changed = Object.fromEntries(
    Object.entries(draw.values)
      .filter(([cid, boat]) => boat.trim() !== (stored[cid] ?? '').trim())
      .map(([cid, boat]) => [cid, boat.trim() || null]),
  );
  const dirty = Object.keys(changed).length > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{meta.label} boats</DialogTitle>
          <DialogDescription>
            The boat each entry sails in this fleet. Other fleets of the round may sail the same
            boats; within this one, each boat once.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Entry</th>
                <th className="py-1 pr-2 font-medium">Name</th>
                <th className="py-1 font-medium">Boat</th>
              </tr>
            </thead>
            <tbody>
              {members.map((c) => (
                <tr key={c.id}>
                  <td className="py-1 pr-2 whitespace-nowrap">{c.sailNumber}</td>
                  <td className="py-1 pr-2">{c.names.join(' & ')}</td>
                  <td className="py-1">
                    {canEdit ? (
                      <BoatCell competitorId={c.id} label={c.names.join(' & ')} column={column} />
                    ) : (
                      <span className="font-mono text-xs">{values[c.id]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(message || save.isError) && (
          <p className="text-sm text-destructive">{message ?? String(save.error)}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {canEdit ? 'Cancel' : 'Close'}
          </Button>
          {canEdit && (
            <Button
              disabled={!dirty || !!message || save.isPending}
              onClick={async () => {
                try {
                  await save.mutateAsync({ roundId: round.id, fleetId, boats: changed });
                  onClose();
                } catch {
                  // shown above
                }
              }}
            >
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Save boats
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
