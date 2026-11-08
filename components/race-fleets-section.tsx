'use client';

import { useMemo, useState } from 'react';

import type { Competitor, Fleet, Race } from '@/lib/types';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import { fleetsInRace, setFleetInRace } from '@/lib/race-fleets';
import { bySailNumber } from '@/lib/sail-number-sort';
import { cn } from '@/lib/utils';

/**
 * Which fleets each boat sails in for this race. A boat's fleets are set for
 * the series; here one race can differ — a two-handed boat out of the
 * Two-Handed fleet for a race it sails crewed, or a boat in a fleet for this
 * race only. Each tick is saved as it is made.
 */
export function RaceFleetsSection({
  race,
  competitors,
  fleets,
  readOnly,
  onSave,
}: {
  race: Race;
  /** The boats on this race's sheet, with their *series* fleets — never the
   *  race-resolved list, whose fleets already carry this race's changes. */
  competitors: Competitor[];
  /** The fleets a boat can be put in or taken out of. */
  fleets: Fleet[];
  readOnly: boolean;
  onSave: (fleetChanges: Race['fleetChanges']) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The tick being saved shows as made at once, rather than waiting for the
  // race to come back.
  const [pending, setPending] = useState<{ competitorId: string; fleetId: string; inFleet: boolean } | null>(null);
  const fleetById = useMemo(() => new Map(fleets.map((f) => [f.id, f])), [fleets]);
  const ordered = useMemo(
    () => [...fleets].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)),
    [fleets],
  );

  const rows = [...competitors].sort(bySailNumber).map((c) => {
    const inRace = new Set(fleetsInRace(c, race));
    if (pending?.competitorId === c.id) {
      if (pending.inFleet) inRace.add(pending.fleetId);
      else inRace.delete(pending.fleetId);
    }
    // The boat's series fleets, then any it was put in for this race only,
    // in the series' fleet order.
    const shown = ordered.filter((f) => c.fleetIds.includes(f.id) || inRace.has(f.id));
    const addable = ordered.filter((f) => !shown.includes(f));
    return { c, inRace, shown, addable };
  });

  // For each fleet a boat has been moved in or out of here: how many of the
  // boats it could hold are in it for this race.
  const changedFleetIds = new Set(
    (race.fleetChanges ?? []).flatMap((fc) => [...(fc.add ?? []), ...(fc.drop ?? [])]),
  );
  const counts = ordered
    .filter((f) => changedFleetIds.has(f.id))
    .map((f) => {
      const of = rows.filter((r) => r.shown.some((s) => s.id === f.id));
      return { fleet: f, inRace: of.filter((r) => r.inRace.has(f.id)).length, of: of.length };
    });

  async function setInFleet(c: Competitor, fleetId: string, inFleet: boolean) {
    setError(null);
    setSaving(true);
    setPending({ competitorId: c.id, fleetId, inFleet });
    try {
      await onSave(setFleetInRace(race.fleetChanges, c, fleetId, inFleet));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.');
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  return (
    <section className="space-y-2" data-testid="race-fleets">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Fleets in this race</h3>
        <p className="text-xs text-muted-foreground">
          A boat races in its series fleets unless this race says otherwise. Untick a fleet for a
          boat that isn&apos;t in it this race — a two-handed boat sailing crewed — and it takes no
          place in that fleet&apos;s race and scores it as not sailed there. Its finish still scores in
          its other fleets.
        </p>
      </div>
      {counts.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {counts.map((n) => `${n.fleet.name} in this race: ${n.inRace} of ${n.of} boats`).join(' · ')}
        </p>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <ul className="divide-y rounded-md border">
        {rows.map(({ c, inRace, shown, addable }) => {
          const boat = c.boatName?.trim() || formatPrimaryNames(c.names);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 basis-40">
                <span className="font-mono">{c.sailNumber}</span>
                {boat && <span className="ml-2">{boat}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {shown.map((f) => {
                  const checked = inRace.has(f.id);
                  const changed = checked !== c.fleetIds.includes(f.id);
                  return (
                    <label
                      key={f.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-xs',
                        !checked && 'text-muted-foreground line-through',
                        changed && 'border-amber-500 font-medium',
                        (readOnly || saving) && 'cursor-default opacity-70',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={readOnly || saving}
                        aria-label={`${c.sailNumber} racing in ${f.name}`}
                        onChange={(e) => void setInFleet(c, f.id, e.target.checked)}
                      />
                      {fleetById.get(f.id)?.name}
                    </label>
                  );
                })}
                {!readOnly && addable.length > 0 && (
                  <select
                    aria-label={`Add ${c.sailNumber} to a fleet for this race`}
                    className="h-7 rounded border bg-background px-1 text-base md:text-xs"
                    value=""
                    disabled={saving}
                    onChange={(e) => {
                      if (e.target.value) void setInFleet(c, e.target.value, true);
                    }}
                  >
                    <option value="">+ fleet</option>
                    {addable.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
