/**
 * Grouping a series' fleets into the classes a published entry list is
 * tabled by.
 *
 * A keelboat league scored under two systems at once has two fleets per
 * class — Howth's autumn league runs `Class 1 HPH` beside `Class 1 IRC`, and
 * so on down to `Non Spin Class 5 HPH` — and an entry list that names them
 * boat by boat repeats the class in every cell while saying nothing about
 * what the boat is rated at. Tabled by class instead, with a rating column
 * per fleet, each boat is one row and the class is said once.
 *
 * Nothing on a fleet records which class it belongs to, so the grouping is
 * inferred, from two signals in order of trust:
 *
 * 1. The grouping value a competitor import recorded on the fleet
 *    (`Fleet.importGroups`). That is the importer's own note of the column
 *    value that fed the fleet, so it is exact for anything an import built,
 *    and it survives the fleet being renamed to whatever the club calls it.
 * 2. Failing that: two fleets belong together when they hold *largely the
 *    same boats* and their names share a whole word at one end.
 *
 * Both halves of the second rule are load-bearing. Shared boats alone would
 * pull an `Overall` fleet holding everybody into whichever class it met
 * first. A shared word alone would put `Class 1 IRC` with `Class 2 IRC`, and
 * — worse, because it is the shape this is built for — `Non Spin Class 4 HPH`
 * with `Non Spin Class 5 HPH`, which share three words. "Largely the same
 * boats" rather than "at least one boat" for the same reason: one boat
 * entered in both Class 4 and Class 5 should not collapse the two.
 *
 * The shared words are the group's name; what is left of each fleet name is
 * how that fleet is headed within the group. It reads the same from either
 * end — `IRC Class 1` / `NHC Class 1` groups as `Class 1` with `IRC` and
 * `NHC` columns exactly as `Class 1 IRC` / `Class 1 HPH` does.
 */

export interface GroupableFleet {
  id: string;
  name: string;
  displayOrder: number;
  /** Grouping-column values a competitor import has fed this fleet from. */
  importGroups?: string[];
}

export interface GroupedFleet {
  id: string;
  name: string;
  /** What distinguishes this fleet inside its group — its name with the part
   *  shared with its neighbours taken off. Null when nothing does: a group of
   *  one, or a fleet named exactly its group. */
  label: string | null;
}

export interface FleetGroup {
  /** What the group's table is headed by. */
  name: string;
  /** The group's fleets, in display order. */
  fleets: GroupedFleet[];
}

const wordsOf = (name: string): string[] => name.trim().split(/\s+/).filter(Boolean);

/** Trim the punctuation a split leaves stranded at an edge, so `Class 1 -`
 *  reads as `Class 1` and `(IRC)` as `IRC`. */
const trimEdges = (s: string): string =>
  s.replace(/^[\s([{\-–—:,]+/, '').replace(/[\s)\]}\-–—:,]+$/, '');

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** How many words every name starts with in common. */
function commonPrefixLength(names: string[][]): number {
  const shortest = Math.min(...names.map((w) => w.length));
  let n = 0;
  while (n < shortest && names.every((w) => eq(w[n], names[0][n]))) n++;
  return n;
}

/** How many words every name ends with in common, ignoring the leading `from`
 *  words of each — already claimed by the prefix, and a word may not count at
 *  both ends. */
function commonSuffixLength(names: string[][], from: number): number {
  const tails = names.map((w) => w.slice(from));
  const shortest = Math.min(...tails.map((w) => w.length));
  let n = 0;
  while (n < shortest && tails.every((w) => eq(w[w.length - 1 - n], tails[0][tails[0].length - 1 - n]))) n++;
  return n;
}

function sharesImportGroup(a: GroupableFleet, b: GroupableFleet): boolean {
  return !!a.importGroups?.some((g) => b.importGroups?.some((h) => eq(g, h)));
}

/** The first grouping value every fleet in the set carries, in the casing the
 *  earliest of them recorded. */
function sharedImportGroup(fleets: GroupableFleet[]): string | null {
  for (const g of fleets[0].importGroups ?? []) {
    if (fleets.every((f) => f.importGroups?.some((h) => eq(g, h)))) return g;
  }
  return null;
}

/** Whether two fleets hold largely the same boats: they overlap at all, and
 *  the overlap covers at least half of the smaller of the two. */
function largelyTheSameBoats(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return false;
  let shared = 0;
  for (const id of small) if (large.has(id)) shared++;
  return shared > 0 && shared * 2 >= small.size;
}

function shareAWordAtOneEnd(a: string, b: string): boolean {
  const names = [wordsOf(a), wordsOf(b)];
  const prefix = commonPrefixLength(names);
  return prefix > 0 || commonSuffixLength(names, prefix) > 0;
}

/** Name a component and label its fleets, or return null when the names say
 *  nothing the group could be headed by. */
function describe(fleets: GroupableFleet[]): FleetGroup | null {
  const names = fleets.map((f) => wordsOf(f.name));
  const prefix = commonPrefixLength(names);
  const suffix = commonSuffixLength(names, prefix);
  const heading = trimEdges(
    [...names[0].slice(0, prefix), ...names[0].slice(names[0].length - suffix)].join(' '),
  );
  const name = heading || sharedImportGroup(fleets);
  if (!name) return null;
  return {
    name,
    fleets: fleets.map((f, i) => {
      const rest = trimEdges(names[i].slice(prefix, names[i].length - suffix).join(' '));
      return { id: f.id, name: f.name, label: rest || null };
    }),
  };
}

/**
 * Group the given fleets. Every fleet comes back in exactly one group, groups
 * in fleet display order, and a fleet nothing joins is a group of its own
 * headed by its own name.
 *
 * `membersByFleetId` is who is entered in each fleet — competitor ids, so
 * that a boat counts once however it is named.
 */
export function groupFleets(
  fleets: readonly GroupableFleet[],
  membersByFleetId: ReadonlyMap<string, ReadonlySet<string>>,
): FleetGroup[] {
  const ordered = [...fleets].sort(
    (a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name),
  );
  const members = (f: GroupableFleet): ReadonlySet<string> =>
    membersByFleetId.get(f.id) ?? new Set<string>();

  // Union-find over the fleets, joined pairwise by either signal.
  const parent = ordered.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      const joined =
        sharesImportGroup(a, b) ||
        (largelyTheSameBoats(members(a), members(b)) && shareAWordAtOneEnd(a.name, b.name));
      if (joined) parent[find(i)] = find(j);
    }
  }

  const components = new Map<number, GroupableFleet[]>();
  for (let i = 0; i < ordered.length; i++) {
    const root = find(i);
    const bucket = components.get(root);
    if (bucket) bucket.push(ordered[i]);
    else components.set(root, [ordered[i]]);
  }

  const alone = (f: GroupableFleet): FleetGroup => ({
    name: f.name,
    fleets: [{ id: f.id, name: f.name, label: null }],
  });

  const groups: FleetGroup[] = [];
  for (const component of components.values()) {
    if (component.length === 1) {
      groups.push(alone(component[0]));
      continue;
    }
    // Pairwise joins can chain into a component with nothing in common across
    // all of it — A shares a word with B at one end, B with C at the other.
    // Rather than head such a group with something none of its fleets says,
    // let its fleets stand alone.
    const described = describe(component);
    if (described) groups.push(described);
    else for (const f of component) groups.push(alone(f));
  }
  return groups;
}
