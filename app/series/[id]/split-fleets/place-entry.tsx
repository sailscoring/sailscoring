'use client';

// An entry placed by hand on a round already committed: moved to another of
// its fleets, or placed in one when she is in none of them (a late entry).
// Where boats are drawn and the boat she is given is another entry's in that
// fleet, the two can be swapped instead — two entries dealt the wrong way
// round, which as two moves would each clash with the other's boat. Every
// placement is recorded on the round as made by hand (`SplitRound.overrides`).

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';

import type { FleetMeta } from '@/components/split-fleet-standings';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useApplySplitOverride, useSwapSplitRoundEntries } from '@/hooks/use-split-fleets';
import { compareSailNumbersIgnoringPrefix } from '@/lib/sail-number-sort';
import {
  duplicateBoats,
  fleetMembers,
  physicalRaceCompleted,
  stageRaceRefs,
  type SplitFleetData,
  type SplitRound,
} from '@/lib/split-fleets';
import type { Competitor } from '@/lib/types';

/** The fleet of the round an entry is in, or null when she is in none. */
function roundFleetOf(c: Competitor, round: SplitRound): string | null {
  return round.fleetIds.find((fid) => c.fleetIds.includes(fid)) ?? null;
}

const bySail = (a: Competitor, b: Competitor) =>
  compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber);

const entryLabel = (c: Competitor) => `${c.sailNumber} ${c.names.join(' & ')}`.trim();

/**
 * A round card's way to place entries by hand. The latest round also says
 * how many entries are in none of its fleets — an entry added after the
 * round was committed is scored nowhere until she is placed.
 */
export function PlaceEntryControls({
  seriesId,
  data,
  round,
  fleetMeta,
  latest,
}: {
  seriesId: string;
  data: SplitFleetData;
  round: SplitRound;
  fleetMeta: Map<string, FleetMeta>;
  latest: boolean;
}) {
  const [openWith, setOpenWith] = useState<string | null>(null);
  const unplaced = useMemo(
    () => data.competitors.filter((c) => roundFleetOf(c, round) === null).sort(bySail),
    [data.competitors, round],
  );
  const n = unplaced.length;
  return (
    <>
      {latest && n > 0 && (
        <button
          type="button"
          className="text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
          onClick={() => setOpenWith(unplaced[0].id)}
        >
          {n} {n === 1 ? 'entry is' : 'entries are'} in no fleet — place {n === 1 ? 'it' : 'them'}
        </button>
      )}
      {round.fleetIds.length > 1 && (
        <Button variant="ghost" size="xs" onClick={() => setOpenWith('')}>
          Move an entry…
        </Button>
      )}
      {openWith !== null && (
        <PlaceEntryDialog
          seriesId={seriesId}
          data={data}
          round={round}
          fleetMeta={fleetMeta}
          unplaced={unplaced}
          initialEntryId={openWith}
          onClose={() => setOpenWith(null)}
        />
      )}
    </>
  );
}

function PlaceEntryDialog({
  seriesId,
  data,
  round,
  fleetMeta,
  unplaced,
  initialEntryId,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  round: SplitRound;
  fleetMeta: Map<string, FleetMeta>;
  unplaced: Competitor[];
  initialEntryId: string;
  onClose: () => void;
}) {
  const place = useApplySplitOverride(seriesId, { errorShownToUser: true });
  const swap = useSwapSplitRoundEntries(seriesId);
  const drawBoats = data.config.boatAssignments === true;
  const label = (fid: string) => fleetMeta.get(fid)?.label ?? '?';
  const byId = useMemo(() => new Map(data.competitors.map((c) => [c.id, c])), [data.competitors]);

  /** Where an entry goes by default, and the boat she starts with: the first
   *  fleet she isn't in, on the boat she has now — a wrong-fleet correction
   *  usually keeps the boat number. */
  const defaultsFor = (id: string) => {
    const c = byId.get(id);
    const from = c ? roundFleetOf(c, round) : null;
    return {
      toFleetId: round.fleetIds.find((fid) => fid !== from) ?? '',
      boat: (from && c?.fleetSailNumbers?.[from]) || '',
    };
  };
  const [entryId, setEntryId] = useState(initialEntryId);
  const [toFleetId, setToFleetId] = useState(() => defaultsFor(initialEntryId).toFleetId);
  const [boat, setBoat] = useState(() => defaultsFor(initialEntryId).boat);
  const [result, setResult] = useState<{ title: string; warning: string } | null>(null);
  const choose = (id: string) => {
    const d = defaultsFor(id);
    setEntryId(id);
    setToFleetId(d.toFleetId);
    setBoat(d.boat);
    place.reset();
    swap.reset();
  };

  const entry = byId.get(entryId) ?? null;
  const fromFleetId = entry ? roundFleetOf(entry, round) : null;
  const groups = [
    { label: 'In no fleet', entries: unplaced },
    ...(round.fleetIds.length > 1
      ? round.fleetIds.map((fid) => ({
          label: label(fid),
          entries: fleetMembers(data.competitors, fid).sort(bySail),
        }))
      : []),
  ].filter((g) => g.entries.length > 0);
  const targets = round.fleetIds.filter((fid) => fid !== fromFleetId);
  // The entry of the fleet she joins already holding the boat typed for her.
  const holder =
    drawBoats && entry && toFleetId && boat.trim()
      ? (fleetMembers(data.competitors, toFleetId).find(
          (c) => c.id !== entry.id && duplicateBoats([c.fleetSailNumbers?.[toFleetId], boat]).length > 0,
        ) ?? null)
      : null;
  const sailed = stageRaceRefs(data, round.stage).some(
    (ref) => round.fleetIds.includes(ref.fleetId) && physicalRaceCompleted(ref, data.competitors, data.finishes),
  );
  const pending = place.isPending || swap.isPending;
  const error = place.error ?? swap.error;

  /** Closed once made — unless it reaches results already in, which the
   *  scorer is shown before the dialog goes. */
  const done = (title: string, res: { warning: string | null }) =>
    res.warning ? setResult({ title, warning: res.warning }) : onClose();
  const onPlace = async () => {
    if (!entry || !toFleetId) return;
    try {
      done(
        fromFleetId ? `${entry.sailNumber} moved to ${label(toFleetId)}` : `${entry.sailNumber} placed in ${label(toFleetId)}`,
        await place.mutateAsync({
          roundId: round.id,
          competitorId: entry.id,
          toFleetId,
          ...(drawBoats ? { boat: boat.trim() || null } : {}),
        }),
      );
    } catch {
      // shown below
    }
  };
  const onSwap = async () => {
    if (!entry || !holder) return;
    try {
      done(
        `${entry.sailNumber} and ${holder.sailNumber} swapped`,
        await swap.mutateAsync({ roundId: round.id, competitorIds: [entry.id, holder.id] }),
      );
    } catch {
      // shown below
    }
  };

  if (result) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{result.title}</DialogTitle>
            <DialogDescription>The change is made, and it reaches results already in.</DialogDescription>
          </DialogHeader>
          <p
            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid="sf-place-warning"
          >
            {result.warning}
          </p>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {round.fleetIds.length > 1 && (!entry || fromFleetId) ? 'Move an entry' : 'Place an entry'}
          </DialogTitle>
          <DialogDescription>
            Put an entry in another fleet of this round, or place one who is in none of them — a
            correction to the assignment, or a late entry. It is recorded on the round as placed by
            hand.
            {sailed && ' This round has raced: the change applies to the races it has sailed, too.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm" htmlFor="sf-place-entry">Entry</label>
            <select
              id="sf-place-entry"
              className="w-full rounded-md border bg-background px-2 py-1 text-sm"
              value={entryId}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">Choose…</option>
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.entries.map((c) => (
                    <option key={c.id} value={c.id}>{entryLabel(c)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          {entry && (
            <div className="space-y-1.5">
              <label className="text-sm" htmlFor="sf-place-fleet">
                {fromFleetId ? 'Move to' : 'Place in'}
              </label>
              <select
                id="sf-place-fleet"
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={toFleetId}
                onChange={(e) => {
                  setToFleetId(e.target.value);
                  place.reset();
                  swap.reset();
                }}
              >
                {targets.map((fid) => (
                  <option key={fid} value={fid}>{label(fid)}</option>
                ))}
              </select>
            </div>
          )}
          {entry && drawBoats && toFleetId && (
            <div className="space-y-1.5">
              <label className="block text-sm" htmlFor="sf-place-boat">Boat in {label(toFleetId)}</label>
              <input
                id="sf-place-boat"
                className={`w-28 rounded-md border bg-background px-2 py-1 font-mono text-sm${
                  holder ? ' border-destructive text-destructive' : ''
                }`}
                aria-invalid={holder ? true : undefined}
                value={boat}
                onChange={(e) => setBoat(e.target.value)}
                placeholder="not drawn"
              />
            </div>
          )}
          {holder && entry && (
            <div className="space-y-2 rounded-md border p-2 text-sm">
              <p className="text-destructive">
                Boat {boat.trim()} in {label(toFleetId)} is drawn for {entryLabel(holder)}.
              </p>
              {fromFleetId && (
                <>
                  <p className="text-muted-foreground">
                    If the two were dealt the wrong way round, swap them: {entry.sailNumber} to{' '}
                    {label(toFleetId)} on {holder.fleetSailNumbers?.[toFleetId]}, and {holder.sailNumber} to{' '}
                    {label(fromFleetId)}
                    {entry.fleetSailNumbers?.[fromFleetId]
                      ? ` on ${entry.fleetSailNumbers[fromFleetId]}`
                      : ', with no boat drawn'}
                    .
                  </p>
                  <Button variant="outline" size="sm" disabled={pending} onClick={() => void onSwap()}>
                    {swap.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Swap {entry.sailNumber} and {holder.sailNumber}
                  </Button>
                </>
              )}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{String(error)}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!entry || !toFleetId || !!holder || pending} onClick={() => void onPlace()}>
            {place.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {!entry || !toFleetId ? 'Move' : fromFleetId ? `Move to ${label(toFleetId)}` : `Place in ${label(toFleetId)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
