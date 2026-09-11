'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { additionKey, type FleetAdditionCandidate } from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

import { SelectAllCheckbox, describeMatch, systemLabel } from './shared';
import { competitorFleetNames, formatPrimaryNames } from '@/lib/competitor-fields';
import { formatRatingValue } from '@/lib/competitor-ratings';

/** Whether a candidate has everything an apply needs: somewhere to go, and a
 *  rating to seed. One that doesn't is shown, but can't be ticked — the scorer
 *  picks its fleet first. */
function canApply(c: FleetAdditionCandidate): boolean {
  return c.targetFleetId !== null && c.proposedTcf !== null;
}

export function AddToFleetSection({
  candidates,
  selected,
  onToggle,
  onToggleAll,
  onChooseFleet,
  onChooseCert,
  targetCompetitorById,
  targetFleetById,
  seriesHasRaces,
}: {
  candidates: FleetAdditionCandidate[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
  onChooseFleet: (key: string, fleetId: string) => void;
  onChooseCert: (competitorId: string, certId: string) => void;
  targetCompetitorById: Map<string, Competitor>;
  targetFleetById: Map<string, Fleet>;
  seriesHasRaces: boolean;
}) {
  // Select-all covers the candidates an apply could actually write; the rest
  // are waiting on a fleet, and sweeping them in would promise something the
  // apply wouldn't deliver.
  const appliableKeys = candidates
    .filter(canApply)
    .map((c) => additionKey(c.competitorId, c.system));
  const selectedCount = appliableKeys.filter((k) => selected.has(k)).length;

  if (candidates.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Add to handicap fleet</div>
      <p className="text-xs text-muted-foreground">
        These boats have an Irish Sailing certificate but aren&apos;t in a fleet that uses it — tick
        to add them and seed the rating.
      </p>
      {seriesHasRaces && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Boats added here are scored DNC for races already sailed in that fleet.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <SelectAllCheckbox
                selectedCount={selectedCount}
                total={appliableKeys.length}
                onToggleAll={(on) => onToggleAll(appliableKeys, on)}
              />
            </TableHead>
            <TableHead>Sail no.</TableHead>
            <TableHead>Boat</TableHead>
            <TableHead>Currently in</TableHead>
            <TableHead>Add to</TableHead>
            <TableHead className="text-right">Rating</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => {
            const key = additionKey(c.competitorId, c.system);
            const comp = targetCompetitorById.get(c.competitorId);
            // The fleets the boat is already in are what tell the scorer which
            // target fleet to pick — a boat in "Cruisers 1 (NHC)" belongs in
            // "Cruisers 1 (IRC)".
            const currentFleets = competitorFleetNames(comp?.fleetIds ?? [], targetFleetById);
            const appliable = canApply(c);
            return (
              <TableRow key={key}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(key) && appliable}
                    disabled={!appliable}
                    onChange={(e) => onToggle(key, e.target.checked)}
                    className="h-3.5 w-3.5"
                    aria-label={`Add ${comp?.sailNumber ?? ''} to a handicap fleet`}
                  />
                </TableCell>
                <TableCell>{comp?.sailNumber}</TableCell>
                <TableCell>
                  {comp?.boatName ?? formatPrimaryNames(comp?.names ?? [])}{' '}
                  <span className="text-muted-foreground">({systemLabel(c)})</span>
                  {c.match && (
                    <span className="block text-xs text-amber-600 dark:text-amber-500">
                      {describeMatch(c.match)}
                    </span>
                  )}
                </TableCell>
                <TableCell className={currentFleets.length === 0 ? 'text-muted-foreground' : undefined}>
                  {currentFleets.length > 0 ? currentFleets.join(', ') : 'No fleet'}
                </TableCell>
                <TableCell>
                  <select
                    aria-label="Target fleet"
                    value={c.targetFleetId ?? ''}
                    onChange={(e) => onChooseFleet(key, e.target.value)}
                    className="rounded border bg-background px-1 py-0.5 text-xs"
                  >
                    {c.targetFleetId === null && <option value="">Select fleet…</option>}
                    {c.fleetOptions.map((f) => (
                      <option key={f.fleetId} value={f.fleetId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.certChoice && (
                    <select
                      aria-label="Certificate"
                      value={c.certChoice.chosen}
                      onChange={(e) => onChooseCert(c.competitorId, e.target.value)}
                      className="mb-1 block rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      {c.certChoice.options.map((o) => (
                        <option key={o.certId} value={o.certId}>
                          {o.label}
                          {o.tcc !== null ? ` — ${formatRatingValue(o.tcc, 'irc')}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {c.proposedTcf !== null ? formatRatingValue(c.proposedTcf, c.system) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
