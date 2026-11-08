'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { highPointRaceCaption } from '@/lib/high-point';
import { boatsWithNoResult, declaredCodes, raceFleetSizes } from '@/lib/high-point-race';
import { makeFinish } from '@/lib/finish-entry';
import { seriesCodeTable } from '@/lib/scoring-codes';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';
import { describeWriteFailure } from '@/lib/write-failure';

/**
 * The race header's high-point line: what this race's points are scored
 * from — "High point · 11 boats in the race · weight 1.2" — and, where the
 * series has a code for a boat that declared and didn't race (ISORA's DTP),
 * the action that gives it to the boats that did.
 */
export function HighPointRaceLine({
  series,
  race,
  fleets,
  competitors,
  finishes,
  readOnly,
  onMark,
}: {
  series: Series;
  race: Pick<Race, 'id' | 'raceNumber' | 'pointsMultiplier'>;
  fleets: readonly Fleet[];
  /** The boats in this race. */
  competitors: readonly Competitor[];
  finishes: readonly Finish[];
  readOnly: boolean;
  onMark: (finishes: Finish[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const codes = seriesCodeTable(series);
  const sizes = raceFleetSizes(fleets, competitors, finishes, codes);
  const declared = declaredCodes(series.scoringCodes);
  const caption = sizes.length === 1
    ? highPointRaceCaption(sizes[0].fleetSize, race.pointsMultiplier)
    : sizes.length > 1
      ? `High point · ${sizes.map((s) => `${s.fleet.name}: ${s.fleetSize}`).join(', ')} boats in the race${race.pointsMultiplier != null && race.pointsMultiplier !== 1 ? ` · weight ${race.pointsMultiplier}` : ''}`
      : `High point · nothing scored yet${race.pointsMultiplier != null && race.pointsMultiplier !== 1 ? ` · weight ${race.pointsMultiplier}` : ''}`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground" data-testid="high-point-race-line">
      <span>{caption}</span>
      {!readOnly && declared.length > 0 && (
        <button type="button" className="underline hover:text-foreground" onClick={() => setOpen(true)}>
          Mark declared boats…
        </button>
      )}
      {open && (
        <MarkDeclaredDialog
          raceId={race.id}
          raceNumber={race.raceNumber}
          codes={declared.map((c) => ({ code: c.code, description: c.description ?? c.code }))}
          boats={boatsWithNoResult(competitors, finishes)}
          onOpenChange={setOpen}
          onMark={onMark}
        />
      )}
    </div>
  );
}

function MarkDeclaredDialog({
  raceId,
  raceNumber,
  codes,
  boats,
  onOpenChange,
  onMark,
}: {
  raceId: string;
  raceNumber: number;
  codes: { code: string; description: string }[];
  boats: Competitor[];
  onOpenChange: (open: boolean) => void;
  onMark: (finishes: Finish[]) => Promise<void>;
}) {
  const [code, setCode] = useState(codes[0].code);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onMark(
        boats
          .filter((b) => ticked.has(b.id))
          .map((b) => makeFinish(raceId, { id: crypto.randomUUID(), competitorId: b.id, resultCode: code })),
      );
      onOpenChange(false);
    } catch (err) {
      setError(describeWriteFailure(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" data-testid="mark-declared-dialog">
        <DialogHeader>
          <DialogTitle>Race {raceNumber} — mark declared boats</DialogTitle>
          <DialogDescription>
            Tick the boats that declared they would race and didn’t. They are given the code, and count toward the
            fleet size.
          </DialogDescription>
        </DialogHeader>
        {codes.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            Code
            <select
              className="rounded-md border bg-background px-2 py-1 text-base md:text-sm"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Code"
            >
              {codes.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.description}</option>)}
            </select>
          </label>
        )}
        {codes.length === 1 && (
          <p className="text-sm"><span className="font-mono font-medium">{code}</span> {codes[0].description}</p>
        )}
        {boats.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every boat in this race has a result already.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {boats.map((b) => (
              <li key={b.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={ticked.has(b.id)}
                    onChange={(e) => {
                      const next = new Set(ticked);
                      if (e.target.checked) next.add(b.id); else next.delete(b.id);
                      setTicked(next);
                    }}
                    aria-label={`Declared: ${b.sailNumber}`}
                  />
                  <span className="font-mono">{b.sailNumber}</span>
                  <span className="truncate">{b.boatName || formatPrimaryNames(b.names)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || ticked.size === 0} onClick={() => void save()}>
            Mark {ticked.size === 0 ? '' : `${ticked.size} `}{code}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
