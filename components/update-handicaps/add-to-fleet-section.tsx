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
import type { Competitor } from '@/lib/types';

import { SYSTEM_LABEL, describeMatch, formatTcf } from './shared';

export function AddToFleetSection({
  candidates,
  selected,
  onToggle,
  onChooseFleet,
  onChooseCert,
  targetCompetitorById,
  seriesHasRaces,
}: {
  candidates: FleetAdditionCandidate[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onChooseFleet: (key: string, fleetId: string) => void;
  onChooseCert: (competitorId: string, certId: string) => void;
  targetCompetitorById: Map<string, Competitor>;
  seriesHasRaces: boolean;
}) {
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
            <TableHead className="w-8"></TableHead>
            <TableHead>Sail no.</TableHead>
            <TableHead>Boat</TableHead>
            <TableHead>Add to</TableHead>
            <TableHead className="text-right">Rating</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => {
            const key = additionKey(c.competitorId, c.system);
            const comp = targetCompetitorById.get(c.competitorId);
            const checked = selected.has(key);
            const canApply = c.targetFleetId !== null && c.proposedTcf !== null;
            return (
              <TableRow key={key}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={checked && canApply}
                    disabled={!canApply}
                    onChange={(e) => onToggle(key, e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                </TableCell>
                <TableCell>{comp?.sailNumber}</TableCell>
                <TableCell>
                  {comp?.boatName ?? comp?.name}{' '}
                  <span className="text-muted-foreground">({SYSTEM_LABEL[c.system]})</span>
                  {c.match && (
                    <span className="block text-xs text-amber-600 dark:text-amber-500">
                      {describeMatch(c.match)}
                    </span>
                  )}
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
                          {o.tcc !== null ? ` — ${o.tcc.toFixed(3)}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {c.proposedTcf !== null ? formatTcf(c.proposedTcf, c.system) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
