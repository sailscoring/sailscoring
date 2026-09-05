/**
 * The starters checklist: the printed check-off list a recorder takes onto
 * the committee boat, one row per expected boat, ticked as each arrives in
 * the starting area.
 *
 * The sheet is one table per *start*, not per fleet. Fleets here are scoring
 * fleets, and a keelboat class is routinely scored under two or three of them
 * at once (Class 1 IRC, Class 1 HPH, Class 1 ECHO) with each boat entered in
 * some subset. The recorder wants one table per class with every boat on it
 * once, whatever it is scored under. The starting area is what the sheet
 * records, so the start is the grouping:
 *
 *  - When the series has a default start sequence, each start group is one
 *    table, holding every boat in any of the group's fleets. A fleet outside
 *    every group gets a table of its own.
 *  - When it has none, fleets that share any competitor merge into one table,
 *    transitively. Class 1 IRC and Class 1 HPH share boats and merge; Class 1
 *    and Class 2 do not and stay apart. That gives the per-class tables with
 *    nothing configured.
 *
 * A table is headed by the words its fleets' names have in common when only
 * the scoring system differs ("Class 1 IRC" and "Class 1 HPH" head a table
 * "Class 1"), and by the names joined otherwise.
 */
import { isSyntheticFleetName } from './publishing';
import { compareSailNumbersIgnoringPrefix } from './sail-number-sort';
import type { StartGroup } from './types';

export interface ChecklistBoat {
  sailNumber: string;
  boatName?: string;
}

export interface ChecklistTable {
  /** The start's heading; null on a series with a single, unnamed start. */
  heading: string | null;
  /** In sail-number order, ignoring national prefixes: the recorder reads
   *  the number off the sail, and "IRL 12" sits beside "GBR 12". */
  boats: ChecklistBoat[];
}

interface FleetLike {
  id: string;
  name: string;
  displayOrder: number;
  splitRoundId?: string;
}

interface CompetitorLike extends ChecklistBoat {
  fleetIds: string[];
}

/**
 * The fleets a boat is listed under on the sheet: the ones it is entered in,
 * less the app's own `Default` / `Unknown`, and with split-round fleets
 * collapsed to the latest round's (assignment appends rather than replaces,
 * so a boat two rounds in holds both rounds' fleets). The same rule the
 * published competitor list applies to its Fleet column.
 */
function displayFleetIds(boat: CompetitorLike, fleetById: Map<string, FleetLike>): string[] {
  const own = boat.fleetIds
    .map((id) => fleetById.get(id))
    .filter((f): f is FleetLike => !!f && !isSyntheticFleetName(f.name));
  const latestRound = own
    .filter((f) => f.splitRoundId)
    .reduce<FleetLike | null>(
      (best, f) => (best === null || f.displayOrder > best.displayOrder ? f : best),
      null,
    );
  return own.filter((f) => !f.splitRoundId || f.id === latestRound?.id).map((f) => f.id);
}

/**
 * The leading words the names share, when what each name has left over is a
 * single word: the scoring system. "Class 1 IRC" and "Class 1 HPH" head a
 * table "Class 1"; "Cruisers IRC" and "Cruisers ECHO" head "Cruisers". Names
 * that differ by more than that are joined instead: a start shared by
 * "Class 2 HPH" and "Class 3 HPH" is not headed "Class", which says nothing,
 * and "Class 1 IRC" and "Class 10 IRC" are not headed "Class 1", which says
 * the wrong thing.
 */
export function checklistHeading(names: string[]): string {
  if (names.length === 1) return names[0];
  const words = names.map((n) => n.trim().split(/\s+/));
  const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;
  let common = 0;
  while (words.every((ws) => ws.length > common + 1 && same(ws[common], words[0][common]))) common++;
  const oneWordLeft = words.every((ws) => ws.length === common + 1);
  const heading = words[0].slice(0, common).join(' ').replace(/[\s\-–—/:]+$/, '');
  return oneWordLeft && heading !== '' ? heading : names.join(' / ');
}

/**
 * Group the entries into the tables of the starters checklist.
 *
 * `startGroups` is the series' default start sequence, when it has one. The
 * tables come out in start order when there is a sequence, then any fleet
 * outside it in fleet display order; without a sequence, in the display
 * order of each merged group's first fleet.
 */
export function buildStartersChecklist(input: {
  fleets: FleetLike[];
  competitors: CompetitorLike[];
  startGroups?: StartGroup[];
}): ChecklistTable[] {
  const fleets = [...input.fleets].sort((a, b) => a.displayOrder - b.displayOrder);
  const fleetById = new Map(fleets.map((f) => [f.id, f]));
  const membership = input.competitors.map((c) => ({ boat: c, fleetIds: displayFleetIds(c, fleetById) }));

  // Only fleets with a boat on them make a table; an empty table records nothing.
  const populated = fleets.filter((f) => membership.some((m) => m.fleetIds.includes(f.id)));
  const populatedIds = new Set(populated.map((f) => f.id));

  // Which table each fleet belongs to, as a representative fleet id.
  const groupOf = new Map<string, string>();
  const groupOrder: string[] = [];
  const join = (ids: string[]) => {
    const present = ids.filter((id) => populatedIds.has(id) && !groupOf.has(id));
    if (present.length === 0) return;
    const rep = present[0];
    groupOrder.push(rep);
    for (const id of present) groupOf.set(id, rep);
  };

  if (input.startGroups && input.startGroups.length > 0) {
    for (const g of input.startGroups) join(g.fleetIds);
    for (const f of populated) join([f.id]);
  } else {
    // Merge fleets that share a boat, transitively: union-find over the
    // populated fleets, then emit the components in display order.
    const parent = new Map(populated.map((f) => [f.id, f.id]));
    const find = (id: string): string => {
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const m of membership) {
      for (let i = 1; i < m.fleetIds.length; i++) {
        const a = find(m.fleetIds[0]);
        const b = find(m.fleetIds[i]);
        if (a !== b) parent.set(b, a);
      }
    }
    const components = new Map<string, string[]>();
    for (const f of populated) {
      const root = find(f.id);
      const list = components.get(root) ?? [];
      list.push(f.id);
      components.set(root, list);
    }
    for (const ids of components.values()) join(ids);
  }

  const byBoat = (a: ChecklistBoat, b: ChecklistBoat) =>
    compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber);
  const boatOf = ({ sailNumber, boatName }: ChecklistBoat): ChecklistBoat =>
    boatName ? { sailNumber, boatName } : { sailNumber };

  const tables: ChecklistTable[] = groupOrder.map((rep) => {
    const fleetIds = populated.filter((f) => groupOf.get(f.id) === rep).map((f) => f.id);
    const names = fleetIds.map((id) => fleetById.get(id)!.name);
    const boats = membership
      .filter((m) => m.fleetIds.some((id) => groupOf.get(id) === rep))
      .map((m) => boatOf(m.boat))
      .sort(byBoat);
    return { heading: checklistHeading(names), boats };
  });

  // Boats in no fleet at all: every boat on a single-fleet series (its only
  // fleet is `Default`), or the odd unassigned boat on a multi-fleet one. One
  // table, unheaded; alone on a single-fleet series, last otherwise.
  const unassigned = membership.filter((m) => m.fleetIds.length === 0).map((m) => boatOf(m.boat)).sort(byBoat);
  if (unassigned.length > 0) tables.push({ heading: null, boats: unassigned });

  return tables;
}
