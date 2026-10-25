import type { RaceStart } from '@/lib/types';

export interface FleetOverlap {
  fleetId: string;
  /** The start that already had the fleet, and the one that also claims it. */
  first: Pick<RaceStart, 'id' | 'startTime'>;
  second: Pick<RaceStart, 'id' | 'startTime'>;
}

/**
 * The first fleet that more than one of a race's starts claims, or null.
 *
 * A fleet starts once per race: scoring and finish entry both find a boat's
 * start through its fleet. `stored` is what the race has now and `incoming`
 * what a write would save; an incoming start replaces the stored one with the
 * same id, so moving a fleet between two starts in one write is not an
 * overlap.
 */
export function findFleetOverlap(
  stored: readonly Pick<RaceStart, 'id' | 'fleetIds' | 'startTime'>[],
  incoming: readonly Pick<RaceStart, 'id' | 'fleetIds' | 'startTime'>[],
): FleetOverlap | null {
  const replaced = new Set(incoming.map((s) => s.id));
  const starts = [...stored.filter((s) => !replaced.has(s.id)), ...incoming];
  const claimedBy = new Map<string, Pick<RaceStart, 'id' | 'startTime'>>();
  for (const start of starts) {
    for (const fleetId of new Set(start.fleetIds)) {
      const first = claimedBy.get(fleetId);
      if (first) return { fleetId, first, second: start };
      claimedBy.set(fleetId, start);
    }
  }
  return null;
}
