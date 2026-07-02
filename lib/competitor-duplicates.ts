/**
 * Duplicate-competitor detection for the Competitors tab. Groups exact
 * duplicates — same normalised sail number and same fleet membership — and
 * picks a keeper per group so the UI can pre-select the extra copies for
 * review. Detection never deletes anything itself: the output feeds the
 * multi-select bulk-delete flow, where the scorer confirms.
 *
 * The key is deliberately exact. The same sail number in two different
 * fleets can be two genuinely different boats (class-scoped numbering), so
 * fleet membership is part of the identity, not noise.
 */
import type { Competitor } from './types';

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
  for (const v of [c.boatName, c.boatClass, c.name, c.owner, c.helm, c.crewName, c.club, c.nationality]) {
    if (v && v.trim()) n++;
  }
  for (const v of [c.ircTcc, c.vprsTcc, c.pyNumber, c.nhcStartingTcf, c.echoStartingTcf, c.age]) {
    if (v != null) n++;
  }
  if (c.gender) n++;
  if (c.subdivisions && Object.keys(c.subdivisions).length > 0) n++;
  return n;
}

/**
 * Groups exact duplicates and picks each group's keeper: the row with the
 * most recorded finishes (deleting it would cascade results away), then the
 * most complete data, then the earliest-created — the likely original.
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
    const sorted = [...rows].sort(
      (a, b) =>
        (finishCountByCompetitorId.get(b.id) ?? 0) - (finishCountByCompetitorId.get(a.id) ?? 0) ||
        completeness(b) - completeness(a) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
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
