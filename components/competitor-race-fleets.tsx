'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useSaveRace } from '@/hooks/use-races';
import { fleetChangeFor, fleetsInRace, setFleetInRace } from '@/lib/race-fleets';
import type { Competitor, Fleet, Race } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * A boat's fleets race by race, from the competitor dialog: a grid of races
 * against fleets, its series fleets ticked by default, and a race where it
 * differs marked. "From race N on" re-classes it for the rest of the series —
 * a boat whose new certificate crosses a class band moves class from the race
 * it took effect. Each change saves to its race as it is made, apart from the
 * dialog's own Save.
 */
export function CompetitorRaceFleets({
  competitor,
  races,
  fleets,
}: {
  /** The boat as stored — its series fleets are the defaults. */
  competitor: Competitor;
  races: Race[];
  /** The fleets a boat can be moved in or out of. */
  fleets: Fleet[];
}) {
  const saveRace = useSaveRace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ordered = useMemo(() => [...races].sort((a, b) => a.raceNumber - b.raceNumber), [races]);
  const [fromRaceId, setFromRaceId] = useState('');
  const [outOf, setOutOf] = useState('');
  const [into, setInto] = useState('');

  const changedRaces = ordered.filter((r) => fleetChangeFor(r, competitor.id)).length;

  async function save(updates: { race: Race; fleetChanges: Race['fleetChanges'] }[]) {
    setError(null);
    setBusy(true);
    try {
      for (const { race, fleetChanges } of updates) await saveRace.mutateAsync({ ...race, fleetChanges });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function applyFrom() {
    const from = ordered.find((r) => r.id === fromRaceId);
    if (!from || (!outOf && !into)) return;
    const updates = ordered
      .filter((r) => r.raceNumber >= from.raceNumber)
      .flatMap((race) => {
        let next = race.fleetChanges;
        if (outOf) next = setFleetInRace(next, competitor, outOf, false);
        if (into) next = setFleetInRace(next, competitor, into, true);
        return JSON.stringify(next ?? []) === JSON.stringify(race.fleetChanges ?? []) ? [] : [{ race, fleetChanges: next }];
      });
    void save(updates);
  }

  const raceLabel = (r: Race) => `R${r.raceNumber}${r.name ? ` ${r.name}` : ''}`;

  return (
    <div className="space-y-2" data-testid="competitor-race-fleets">
      <button
        type="button"
        className="text-sm text-primary underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Changes by race…
        {changedRaces > 0 && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({changedRaces} race{changedRaces === 1 ? '' : 's'} differ)
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            The boat races in its saved fleets unless a race says otherwise. A bold, outlined box is
            a change for that race. Changes here save to the race straight away.
          </p>
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          <div className="max-h-[50dvh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3 font-normal">Race</th>
                  {fleets.map((f) => (
                    <th key={f.id} className="px-2 py-1 text-center font-normal">{f.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((race) => {
                  const inRace = new Set(fleetsInRace(competitor, race));
                  return (
                    <tr key={race.id} className="border-t">
                      <td className="py-1 pr-3 whitespace-nowrap">{raceLabel(race)}</td>
                      {fleets.map((f) => {
                        const checked = inRace.has(f.id);
                        const changed = checked !== competitor.fleetIds.includes(f.id);
                        return (
                          <td key={f.id} className="px-2 py-1 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={busy}
                              aria-label={`${competitor.sailNumber} in ${f.name} for race ${race.raceNumber}`}
                              className={cn(
                                'h-4 w-4',
                                changed ? 'outline outline-2 outline-amber-500' : 'opacity-60',
                              )}
                              onChange={(e) =>
                                void save([{ race, fleetChanges: setFleetInRace(race.fleetChanges, competitor, f.id, e.target.checked) }])
                              }
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>From</span>
            <select
              aria-label="From race"
              className="h-8 rounded border bg-background px-1 text-base md:text-sm"
              value={fromRaceId}
              onChange={(e) => setFromRaceId(e.target.value)}
            >
              <option value="">race…</option>
              {ordered.map((r) => (
                <option key={r.id} value={r.id}>{raceLabel(r)}</option>
              ))}
            </select>
            <span>on, out of</span>
            <select
              aria-label="Out of fleet"
              className="h-8 rounded border bg-background px-1 text-base md:text-sm"
              value={outOf}
              onChange={(e) => setOutOf(e.target.value)}
            >
              <option value="">—</option>
              {fleets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <span>and into</span>
            <select
              aria-label="Into fleet"
              className="h-8 rounded border bg-background px-1 text-base md:text-sm"
              value={into}
              onChange={(e) => setInto(e.target.value)}
            >
              <option value="">—</option>
              {fleets.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !fromRaceId || (!outOf && !into) || outOf === into}
              onClick={applyFrom}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
