/**
 * Duplicate-competitor detection for the Competitors tab, in two tiers.
 *
 * Exact duplicates — same normalised sail number and same fleet
 * membership — are grouped with a keeper picked per group so the UI can
 * pre-select the extra copies for the bulk-delete flow. The key is
 * deliberately exact: the same sail number in two different fleets can be
 * two genuinely different boats (class-scoped numbering), so fleet
 * membership is part of the identity, not noise.
 *
 * Possible duplicates — same fleet membership, different sail number, but
 * a matching boat or person name (see lib/competitor-matching) — are what a
 * sail-number change between CSV imports leaves behind. Their resolution is
 * a merge, not a delete: the keeper's id (and with it, its recorded
 * results) survives, while field values are overlaid oldest-to-newest so
 * the latest import's data — including the new sail number — wins.
 *
 * Detection never writes anything itself: exact groups feed the
 * multi-select bulk-delete flow, possible groups feed a per-group merge
 * confirm, and the scorer decides in both.
 */
import type { Competitor, Finish, RaceRatingOverride } from './types';
import { normalizeIdentity } from './competitor-matching';
import { cleanSubdivisions } from './competitor-fields';

export interface DuplicateGroup {
  /** Every row sharing the key, keeper first. */
  competitors: Competitor[];
  keeperId: string;
}

function groupKey(c: Competitor): string {
  return `${c.sailNumber.trim().toUpperCase()}\n${[...c.fleetIds].sort().join(',')}`;
}

/** How much identifying data a row carries — used to break keeper ties in
 *  favour of the copy the scorer would least want to retype. */
function completeness(c: Competitor): number {
  let n = 0;
  for (const v of [c.boatName, c.boatClass, c.name, c.owner, c.helm, c.crewNames?.join(' '), c.club, c.nationality]) {
    if (v && v.trim()) n++;
  }
  for (const v of [c.ircTcc, c.vprsTcc, c.pyNumber, c.nhcStartingTcf, c.echoStartingTcf, c.age]) {
    if (v != null) n++;
  }
  if (c.gender) n++;
  if (c.subdivisions && Object.keys(c.subdivisions).length > 0) n++;
  return n;
}

/** Keeper order: the row with the most recorded finishes (deleting it would
 *  cascade results away), then the most complete data, then the
 *  earliest-created — the likely original. */
function keeperComparator(
  finishCountByCompetitorId: Map<string, number>,
): (a: Competitor, b: Competitor) => number {
  return (a, b) =>
    (finishCountByCompetitorId.get(b.id) ?? 0) - (finishCountByCompetitorId.get(a.id) ?? 0) ||
    completeness(b) - completeness(a) ||
    a.createdAt - b.createdAt ||
    a.id.localeCompare(b.id);
}

/**
 * Groups exact duplicates and picks each group's keeper (see
 * keeperComparator).
 */
export function findDuplicateGroups(
  competitors: Competitor[],
  finishCountByCompetitorId: Map<string, number>,
): DuplicateGroup[] {
  const byKey = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const key = groupKey(c);
    const rows = byKey.get(key);
    if (rows) rows.push(c);
    else byKey.set(key, [c]);
  }
  const groups: DuplicateGroup[] = [];
  for (const rows of byKey.values()) {
    if (rows.length < 2) continue;
    const sorted = [...rows].sort(keeperComparator(finishCountByCompetitorId));
    groups.push({ competitors: sorted, keeperId: sorted[0].id });
  }
  groups.sort((a, b) =>
    a.competitors[0].sailNumber.localeCompare(b.competitors[0].sailNumber),
  );
  return groups;
}

/** The ids the finder pre-selects for deletion: every row except each
 *  group's keeper. */
export function duplicateDeletionIds(groups: DuplicateGroup[]): string[] {
  return groups.flatMap((g) =>
    g.competitors.filter((c) => c.id !== g.keeperId).map((c) => c.id),
  );
}

// ── Possible duplicates (different sail number, matching identity) ──────────

export interface PossibleDuplicateGroup {
  /** Every row in the group, keeper first. */
  competitors: Competitor[];
  keeperId: string;
  /** Which identity fields linked the group — for display. */
  matchedOn: ('boat name' | 'name')[];
}

/** True when two records in the same fleet set look like one boat under
 *  two sail numbers. */
function identityMatch(a: Competitor, b: Competitor): 'boat name' | 'name' | null {
  const boatA = normalizeIdentity(a.boatName);
  if (boatA && boatA === normalizeIdentity(b.boatName)) return 'boat name';
  const personsA = [normalizeIdentity(a.name), normalizeIdentity(a.helm)];
  const personsB = [normalizeIdentity(b.name), normalizeIdentity(b.helm)];
  for (const x of personsA) {
    if (x && personsB.includes(x)) return 'name';
  }
  return null;
}

/**
 * Groups competitors that are probably one boat recorded under two sail
 * numbers: same fleet set, different normalised sail number, matching
 * non-empty boat or person name. Matching pairs are folded into connected
 * groups (three imports can leave three copies), keeper first per group.
 */
export function findPossibleDuplicateGroups(
  competitors: Competitor[],
  finishCountByCompetitorId: Map<string, number>,
): PossibleDuplicateGroup[] {
  const byFleetKey = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const key = [...c.fleetIds].sort().join(',');
    const rows = byFleetKey.get(key);
    if (rows) rows.push(c);
    else byFleetKey.set(key, [c]);
  }

  const groups: PossibleDuplicateGroup[] = [];
  for (const rows of byFleetKey.values()) {
    if (rows.length < 2) continue;
    // Union-find over matching pairs within the fleet set.
    const parent = rows.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const matchedOnByRoot = new Map<number, Set<'boat name' | 'name'>>();
    const pairReasons: { i: number; j: number; reason: 'boat name' | 'name' }[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (
          rows[i].sailNumber.trim().toUpperCase() ===
          rows[j].sailNumber.trim().toUpperCase()
        ) continue; // exact duplicates are the other tier's job
        const reason = identityMatch(rows[i], rows[j]);
        if (!reason) continue;
        parent[find(i)] = find(j);
        pairReasons.push({ i, j, reason });
      }
    }
    for (const { i, reason } of pairReasons) {
      const root = find(i);
      const set = matchedOnByRoot.get(root);
      if (set) set.add(reason);
      else matchedOnByRoot.set(root, new Set([reason]));
    }
    const membersByRoot = new Map<number, Competitor[]>();
    for (let i = 0; i < rows.length; i++) {
      const root = find(i);
      if (!matchedOnByRoot.has(root)) continue;
      const members = membersByRoot.get(root);
      if (members) members.push(rows[i]);
      else membersByRoot.set(root, [rows[i]]);
    }
    for (const [root, members] of membersByRoot) {
      const sorted = [...members].sort(keeperComparator(finishCountByCompetitorId));
      groups.push({
        competitors: sorted,
        keeperId: sorted[0].id,
        matchedOn: [...(matchedOnByRoot.get(root) ?? [])].sort(),
      });
    }
  }
  groups.sort((a, b) =>
    a.competitors[0].sailNumber.localeCompare(b.competitors[0].sailNumber),
  );
  return groups;
}

// ── Merge planning ───────────────────────────────────────────────────────────

export type DuplicateMergePlan =
  | {
      ok: true;
      /** The keeper's row with field values overlaid oldest-to-newest —
       *  same id, createdAt and version, latest data (and sail number). */
      survivor: Competitor;
      /** The non-keeper rows, deleted after reassignment. */
      deleteIds: string[];
      /** Finish ids to repoint at the keeper before the deletes cascade. */
      reassignFinishIds: string[];
      /** Rating-override ids to repoint at the keeper likewise. */
      reassignOverrideIds: string[];
    }
  | {
      ok: false;
      /** Races where two group members both hold a finish — the scorer
       *  must resolve those by hand; auto-picking one would corrupt
       *  results. */
      conflictRaceIds: string[];
    };

/** Overlay `next`'s values onto `base`, skipping empty/null values so a
 *  later import that omitted a field never blanks an earlier one. */
function overlayFields(base: Competitor, next: Competitor): Competitor {
  const str = (v: string | undefined, prev: string | undefined) =>
    v && v.trim() ? v : prev;
  const merged: Competitor = {
    ...base,
    sailNumber: next.sailNumber.trim() ? next.sailNumber : base.sailNumber,
    boatName: str(next.boatName, base.boatName),
    boatClass: str(next.boatClass, base.boatClass),
    name: str(next.name, base.name) ?? '',
    owner: str(next.owner, base.owner),
    helm: str(next.helm, base.helm),
    crewNames: next.crewNames?.length ? next.crewNames : base.crewNames,
    club: str(next.club, base.club) ?? '',
    nationality: str(next.nationality, base.nationality),
    gender: next.gender || base.gender,
    age: next.age ?? base.age,
    subdivisions: cleanSubdivisions({
      ...(base.subdivisions ?? {}),
      ...(next.subdivisions ?? {}),
    }),
    ircTcc: next.ircTcc ?? base.ircTcc,
    vprsTcc: next.vprsTcc ?? base.vprsTcc,
    pyNumber: next.pyNumber ?? base.pyNumber,
    nhcStartingTcf: next.nhcStartingTcf ?? base.nhcStartingTcf,
    echoStartingTcf: next.echoStartingTcf ?? base.echoStartingTcf,
  };
  // Drop optional keys that ended up undefined so the survivor round-trips
  // like a hand-entered competitor.
  for (const k of ['boatName', 'boatClass', 'owner', 'helm', 'crewNames', 'nationality', 'subdivisions', 'ircTcc', 'vprsTcc', 'pyNumber', 'nhcStartingTcf', 'echoStartingTcf'] as const) {
    if (merged[k] === undefined) delete merged[k];
  }
  return merged;
}

/**
 * Plans a merge of a possible-duplicate group. The keeper keeps its id —
 * and with it its recorded finishes — while field values are overlaid
 * oldest-to-newest so the latest import's data (including the new sail
 * number) wins and gaps fall back to older values. The other rows' finishes
 * and rating overrides are repointed at the keeper; the rows are then
 * deleted (their remaining references cascade away).
 *
 * Refuses (`ok: false`) when two group members hold a finish in the same
 * race: both can't stand, and choosing silently would corrupt results.
 */
export function planDuplicateMerge(
  group: PossibleDuplicateGroup,
  finishes: Pick<Finish, 'id' | 'raceId' | 'competitorId'>[],
  overrides: Pick<RaceRatingOverride, 'id' | 'raceId' | 'competitorId' | 'field'>[] = [],
): DuplicateMergePlan {
  const memberIds = new Set(group.competitors.map((c) => c.id));
  const groupFinishes = finishes.filter(
    (f) => f.competitorId !== null && memberIds.has(f.competitorId),
  );

  const membersByRace = new Map<string, Set<string>>();
  for (const f of groupFinishes) {
    const set = membersByRace.get(f.raceId) ?? new Set<string>();
    set.add(f.competitorId as string);
    membersByRace.set(f.raceId, set);
  }
  const conflictRaceIds = [...membersByRace.entries()]
    .filter(([, members]) => members.size > 1)
    .map(([raceId]) => raceId);
  if (conflictRaceIds.length > 0) return { ok: false, conflictRaceIds };

  const keeper = group.competitors.find((c) => c.id === group.keeperId)!;
  const byAge = [...group.competitors].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  let survivor = byAge.reduce(
    (acc, c) => overlayFields(acc, c),
    { ...byAge[0] },
  );
  survivor = {
    ...survivor,
    id: keeper.id,
    seriesId: keeper.seriesId,
    fleetIds: keeper.fleetIds,
    createdAt: keeper.createdAt,
  };
  if (keeper.version !== undefined) survivor.version = keeper.version;
  else delete survivor.version;

  // Overrides are keyed (race, competitor, field). Repoint the non-keepers'
  // at the keeper, oldest member first, skipping any that would collide
  // with a slot the keeper (or an earlier member) already fills — a
  // dropped override is inert data from a boat that didn't finish that
  // race, and the cascade delete disposes of it.
  const takenOverrideSlots = new Set(
    overrides
      .filter((o) => o.competitorId === keeper.id)
      .map((o) => `${o.raceId}\n${o.field}`),
  );
  const reassignOverrideIds: string[] = [];
  for (const member of byAge) {
    if (member.id === keeper.id) continue;
    for (const o of overrides) {
      if (o.competitorId !== member.id) continue;
      const slot = `${o.raceId}\n${o.field}`;
      if (takenOverrideSlots.has(slot)) continue;
      takenOverrideSlots.add(slot);
      reassignOverrideIds.push(o.id);
    }
  }

  return {
    ok: true,
    survivor,
    deleteIds: group.competitors.filter((c) => c.id !== keeper.id).map((c) => c.id),
    reassignFinishIds: groupFinishes
      .filter((f) => f.competitorId !== keeper.id)
      .map((f) => f.id),
    reassignOverrideIds,
  };
}
