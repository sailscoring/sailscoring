import type { Competitor, Race, RaceFleetChange } from './types';

/**
 * A boat's fleets race by race. A competitor's `fleetIds` are its fleets for
 * the series; a race's `fleetChanges` say where one boat's fleets in that
 * race differ — out of the two-handed fleet for a race sailed crewed, or in a
 * new class from the race it was re-classed. Everything that asks which
 * fleets a boat raced in, race by race, asks here.
 */

type RaceWithChanges = Pick<Race, 'fleetChanges'>;

/** The change recorded for one boat in one race, if any. */
export function fleetChangeFor(
  race: RaceWithChanges | undefined,
  competitorId: string,
): RaceFleetChange | undefined {
  return race?.fleetChanges?.find((c) => c.competitorId === competitorId);
}

/** A boat's fleets in a race: its series fleets less the ones it is out of
 *  for the race, plus the ones it sails in for this race only. */
export function fleetsInRace(
  competitor: Pick<Competitor, 'id' | 'fleetIds'>,
  race: RaceWithChanges | undefined,
): string[] {
  const change = fleetChangeFor(race, competitor.id);
  if (!change) return competitor.fleetIds;
  const drop = new Set(change.drop ?? []);
  const kept = competitor.fleetIds.filter((id) => !drop.has(id));
  const added = (change.add ?? []).filter((id) => !kept.includes(id));
  return [...kept, ...added];
}

/**
 * The fleets a boat sails in across some races: every fleet it is in for at
 * least one of them. This is which fleets' standings it appears in. With no
 * races yet it is the boat's series fleets.
 */
export function fleetsInAnyRace(
  competitor: Pick<Competitor, 'id' | 'fleetIds'>,
  races: readonly RaceWithChanges[],
): string[] {
  if (races.length === 0) return competitor.fleetIds;
  const out = new Set<string>();
  for (const race of races) for (const id of fleetsInRace(competitor, race)) out.add(id);
  // Series fleets first, in their own order, then fleets added race by race.
  return [...competitor.fleetIds.filter((id) => out.has(id)), ...[...out].filter((id) => !competitor.fleetIds.includes(id))];
}

/** Whether a boat sails in a fleet in a race. */
export function inFleetForRace(
  competitor: Pick<Competitor, 'id' | 'fleetIds'>,
  fleetId: string,
  race: RaceWithChanges | undefined,
): boolean {
  return fleetsInRace(competitor, race).includes(fleetId);
}

/**
 * The competitors as one race sees them, each carrying its fleets in that
 * race as `fleetIds`. Everything per race — the finish sheet, the starts a
 * boat is in, a race's results table — reads `fleetIds`, so handing it this
 * list is what scopes it to the race. Competitors with no change come back as
 * the same object.
 *
 * For reading within the race only: the result must never be saved as a
 * competitor, or one race's fleets would replace the boat's series fleets.
 */
export function withRaceFleets<C extends Pick<Competitor, 'id' | 'fleetIds'>>(
  competitors: C[],
  race: RaceWithChanges | undefined,
): C[] {
  if (!race?.fleetChanges?.length) return competitors;
  return competitors.map((c) => {
    const change = fleetChangeFor(race, c.id);
    return change ? { ...c, fleetIds: fleetsInRace(c, race) } : c;
  });
}

/**
 * The boats on a fleet's list that are out of the fleet for one race. A
 * fleet's race table leaves them out, and its scoring takes their finishes
 * out of the race while still counting them among the fleet's entries.
 */
export function boatsOutOfFleet(
  fleetCompetitors: readonly Pick<Competitor, 'id' | 'fleetIds'>[],
  fleetId: string,
  race: RaceWithChanges | undefined,
): Set<string> {
  // A race with no changes still leaves out a boat that is on the list only
  // because it was added to the fleet for some other race.
  const out = new Set<string>();
  for (const c of fleetCompetitors) if (!fleetsInRace(c, race).includes(fleetId)) out.add(c.id);
  return out;
}

/** Whether a boat's fleets differ from its series fleets in any of these
 *  races. */
export function hasFleetChanges(competitorId: string, races: readonly RaceWithChanges[]): boolean {
  return races.some((r) => fleetChangeFor(r, competitorId) !== undefined);
}

/**
 * A race's fleet changes with one boat put in or out of one fleet. The result
 * is kept minimal: being in a series fleet, or out of a fleet the boat isn't a
 * member of, is the default and is not recorded, so a change that returns a
 * boat to its series fleets removes its entry.
 */
export function setFleetInRace(
  changes: readonly RaceFleetChange[] | undefined,
  competitor: Pick<Competitor, 'id' | 'fleetIds'>,
  fleetId: string,
  inFleet: boolean,
): RaceFleetChange[] | undefined {
  const others = (changes ?? []).filter((c) => c.competitorId !== competitor.id);
  const current = (changes ?? []).find((c) => c.competitorId === competitor.id);
  const add = new Set(current?.add ?? []);
  const drop = new Set(current?.drop ?? []);
  add.delete(fleetId);
  drop.delete(fleetId);
  const member = competitor.fleetIds.includes(fleetId);
  if (inFleet && !member) add.add(fleetId);
  if (!inFleet && member) drop.add(fleetId);
  const next = changeOf(competitor.id, [...add], [...drop]);
  const out = next ? [...others, next] : others;
  return out.length > 0 ? out : undefined;
}

/** A boat's change with the given fleets, or nothing when it changes
 *  nothing. */
function changeOf(competitorId: string, add: string[], drop: string[]): RaceFleetChange | undefined {
  if (add.length === 0 && drop.length === 0) return undefined;
  return {
    competitorId,
    ...(add.length > 0 ? { add } : {}),
    ...(drop.length > 0 ? { drop } : {}),
  };
}

/**
 * A race's fleet changes moved to new ids — a file import, a copied series —
 * keeping only the boats and fleets the target carries. A change left with
 * nothing in it is dropped.
 */
export function remapFleetChanges(
  changes: readonly RaceFleetChange[] | undefined,
  competitorIdMap: ReadonlyMap<string, string>,
  fleetIdMap: ReadonlyMap<string, string>,
): RaceFleetChange[] {
  const fleets = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => fleetIdMap.get(id)).filter((id): id is string => id !== undefined);
  return (changes ?? []).flatMap((c) => {
    const competitorId = competitorIdMap.get(c.competitorId);
    if (!competitorId) return [];
    const change = changeOf(competitorId, fleets(c.add), fleets(c.drop));
    return change ? [change] : [];
  });
}

/** A race's fleet changes limited to boats and fleets that still exist: a
 *  deleted competitor or fleet leaves its entries behind, and they are
 *  ignored when scoring and not written out. */
export function liveFleetChanges(
  changes: readonly RaceFleetChange[] | undefined,
  competitorIds: ReadonlySet<string>,
  fleetIds: ReadonlySet<string>,
): RaceFleetChange[] {
  const identity = (ids: ReadonlySet<string>) => new Map([...ids].map((id) => [id, id]));
  return remapFleetChanges(changes, identity(competitorIds), identity(fleetIds));
}

/**
 * The fleet changes between two versions of a race's list, as lines for the
 * activity log: "Loinnir: not in Two-Handed", "Loinnir: back in
 * Two-Handed", "Loinnir: in IRC Class 2". The race is named by the caller.
 */
export function describeFleetChanges(
  before: readonly RaceFleetChange[] | undefined,
  after: readonly RaceFleetChange[] | undefined,
  nameOfCompetitor: (id: string) => string,
  nameOfFleet: (id: string) => string,
): string[] {
  const state = (changes: readonly RaceFleetChange[] | undefined) => {
    const m = new Map<string, string>();
    for (const c of changes ?? []) {
      for (const f of c.add ?? []) m.set(`${c.competitorId}\u0000${f}`, 'add');
      for (const f of c.drop ?? []) m.set(`${c.competitorId}\u0000${f}`, 'drop');
    }
    return m;
  };
  const was = state(before);
  const now = state(after);
  const lines: string[] = [];
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(key);
    const b = now.get(key);
    if (a === b) continue;
    const [competitorId, fleetId] = key.split('\u0000');
    const boat = nameOfCompetitor(competitorId);
    const fleet = nameOfFleet(fleetId);
    // Dropped, or an added fleet taken away again: either way the boat is
    // not in the fleet for the race now.
    if (b === 'drop' || a === 'add') lines.push(`${boat}: not in ${fleet}`);
    else if (b === 'add') lines.push(`${boat}: in ${fleet}`);
    else lines.push(`${boat}: back in ${fleet}`);
  }
  return lines;
}
