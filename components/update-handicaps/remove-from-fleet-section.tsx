'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { removalKey, type FleetRemovalCandidate } from '@/lib/source-handicaps';
import type { Competitor } from '@/lib/types';

import { SYSTEM_LABEL } from './shared';
import { formatPrimaryNames } from '@/lib/competitor-fields';

/**
 * Boats sitting in a fleet of this source's system that the source list
 * doesn't rate.
 *
 * The competitor importer can't know who holds a certificate — an entry list
 * with no IRC column says nothing about it — so an IRC fleet added at import
 * time arrives holding the whole group. This is where it converges: the boats
 * the listing matched are the certificated ones, and the rest are offered for
 * removal. Nothing goes without a tick, and boats are listed by name so a
 * genuinely-certificated boat the listing missed isn't dropped by accident.
 */
export function RemoveFromFleetSection({
  candidates,
  selected,
  onToggle,
  targetCompetitorById,
}: {
  candidates: FleetRemovalCandidate[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  targetCompetitorById: Map<string, Competitor>;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Not on the rating list</div>
      <p className="text-xs text-muted-foreground">
        These boats are in a rated fleet but the list doesn&apos;t rate them — tick to take
        them out. Check the names first: a boat the list simply missed belongs where it is.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Sail no.</TableHead>
            <TableHead>Boat</TableHead>
            <TableHead>Remove from</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => {
            const key = removalKey(c.competitorId, c.fleetId);
            const comp = targetCompetitorById.get(c.competitorId);
            return (
              <TableRow key={key}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(key)}
                    onChange={(e) => onToggle(key, e.target.checked)}
                    className="h-3.5 w-3.5"
                    aria-label={`Remove ${comp?.sailNumber ?? ''} from ${c.fleetName}`}
                  />
                </TableCell>
                <TableCell>{comp?.sailNumber}</TableCell>
                <TableCell>
                  {comp?.boatName ?? formatPrimaryNames(comp?.names ?? [])}{' '}
                  <span className="text-muted-foreground">({SYSTEM_LABEL[c.system]})</span>
                </TableCell>
                <TableCell>{c.fleetName}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
