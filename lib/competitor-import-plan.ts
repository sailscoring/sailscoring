/**
 * Pure planning logic for the CSV competitor import wizard's fleet
 * auto-creation step. Given the parsed rows and the existing fleets,
 * decide which fleets need to be created or reused and which CSV rows
 * belong in each.
 *
 * Decision summary (per CSV-fleet-name group, by count of distinct rating
 * systems present in the group's rows):
 *
 *   0 → one scratch fleet, name = bare group name; all rows join.
 *   1 → one fleet of that system, name = bare group name (suffixed if
 *       the bare name is taken by a different system in the DB);
 *       all rows join.
 *   2+ → one fleet per system, name = "<group> (<SYSTEM>)";
 *        rated rows join the fleet(s) matching their populated rating(s);
 *        rating-less rows join all of the auto-created handicap fleets
 *        for the group (DNC pollution is the right pressure on a
 *        placeholder rating).
 *
 * The planner deliberately doesn't take the series-level scoringMode as an
 * input: column mappings carry the user's intent. If the user mapped a
 * rating column, the resulting fleets are handicap-system; the importer
 * is responsible for flipping the series scoringMode to 'handicap' to
 * match. Anyone wanting a scratch import maps rating columns to (ignore).
 *
 * The optional "also create scratch" toggle (per group, present only when
 * at least one rating system is in play) appends an extra scratch sibling
 * containing every row in the group — for line-honours alongside corrected.
 *
 * Existing fleets are reused by case-insensitive name match. The plan
 * never proposes mutating an existing fleet's scoringSystem; if the bare
 * name is taken by a different system, the new fleet is created with the
 * suffixed name instead. The one exception is the implicit default group
 * (rows with no fleet column): when no fleet is literally named "Default"
 * it reuses the series' sole scratch fleet, so a renamed default fleet is
 * reused rather than duplicated.
 *
 * boatClass auto-fill: when the CSV has no Class column AND no existing
 * competitor in the series carries a boatClass, the wizard will fall back
 * to writing the original CSV fleet name into boatClass. This preserves
 * the practical "fleet name = class label" pattern (e.g. "Cruisers 2")
 * without overloading the field when it's actually being used for boat
 * class data.
 */

import type { Competitor, Fleet } from './types';

export type RatingSystem = 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
export type ScoringSystem = RatingSystem | 'scratch';

const SYSTEM_SUFFIX: Record<ScoringSystem, string> = {
  scratch: 'Scratch',
  irc: 'IRC',
  vprs: 'VPRS',
  py: 'PY',
  nhc: 'NHC',
  echo: 'ECHO',
};

/** Default fleet name used when a row has no fleet column value at all. */
export const PLAN_DEFAULT_FLEET_NAME = 'Default';

/** Per-row planning input. Only the data the planner needs — the wizard
 *  parses rows once and constructs these. */
export type PlanRow = {
  /** Names parsed from the row's fleet cell (post `parseFleetCell`).
   *  An empty array means the row has no explicit fleet — the planner
   *  treats it as the default fleet. */
  csvFleetNames: string[];
  /** Which rating systems the row has a (non-blank, parsed) value for. */
  ratings: Set<RatingSystem>;
};

export type ProposedFleet = {
  /** Stable React key — unique within the plan. */
  key: string;
  /** Fleet name as it should appear (may be suffixed; matches existing
   *  fleet's stored casing when reusing). */
  name: string;
  scoringSystem: ScoringSystem;
  /** True when this proposal reuses an existing fleet. */
  isExisting: boolean;
  /** Set iff isExisting. */
  existingFleetId?: string;
  /** Where this proposal came from in the decision tree — used for UI
   *  hints and for the "also create scratch" toggle's scope. */
  source: 'rating-split' | 'rating-single' | 'no-ratings' | 'also-scratch';
  /** Original CSV-fleet-name group this proposal belongs to (case
   *  preserved). Multiple proposals share this when split across systems. */
  csvFleetName: string;
  /** Indices into the input `rows` array that belong in this fleet. */
  rowIndices: number[];
};

export type FleetPlan = {
  proposed: ProposedFleet[];
  /** True when the wizard should write the original CSV fleet name into
   *  boatClass for imported rows that don't have a boatClass column. */
  shouldFillBoatClassFromFleetName: boolean;
};

export type FleetPlanInput = {
  rows: PlanRow[];
  existingFleets: Pick<Fleet, 'id' | 'name' | 'scoringSystem'>[];
  existingCompetitors: Pick<Competitor, 'boatClass'>[];
  /** True iff the CSV has a column mapped to boatClass. */
  csvHasClassColumn: boolean;
  /** Per CSV fleet name (canonical case as it appears in the plan), true
   *  to also create a scratch sibling for line honours. Ignored for
   *  no-rating groups (their main fleet is already scratch). */
  alsoCreateScratch: Record<string, boolean>;
};

type Group = {
  canonicalName: string;
  rowIndices: number[];
  presentSystems: Set<RatingSystem>;
  /** True when at least one row landed here because it had no fleet column
   *  value at all (the implicit default), as opposed to literally naming a
   *  "Default" fleet. Only the implicit default is reused by identity. */
  isImplicitDefault: boolean;
};

function groupRows(rows: PlanRow[]): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isImplicit = row.csvFleetNames.length === 0;
    const fleetNames = isImplicit ? [PLAN_DEFAULT_FLEET_NAME] : row.csvFleetNames;
    for (const fn of fleetNames) {
      const canonical = fn.trim() || PLAN_DEFAULT_FLEET_NAME;
      const key = canonical.toLowerCase();
      let g = groups.get(key);
      if (!g) {
        g = { canonicalName: canonical, rowIndices: [], presentSystems: new Set(), isImplicitDefault: false };
        groups.set(key, g);
      }
      if (isImplicit) g.isImplicitDefault = true;
      g.rowIndices.push(i);
      for (const sys of row.ratings) g.presentSystems.add(sys);
    }
  }
  return groups;
}

function suffixedName(group: string, system: ScoringSystem): string {
  return `${group} (${SYSTEM_SUFFIX[system]})`;
}

function findByName(
  fleets: Pick<Fleet, 'id' | 'name' | 'scoringSystem'>[],
  name: string,
): Pick<Fleet, 'id' | 'name' | 'scoringSystem'> | undefined {
  const lower = name.toLowerCase();
  return fleets.find((f) => f.name.toLowerCase() === lower);
}

/** Filter group rows for a multi-system fleet membership: rated boats join
 *  fleets matching their rating; unrated boats join all auto-created
 *  handicap fleets in the group. */
function membershipForSystem(
  group: Group,
  rows: PlanRow[],
  system: RatingSystem,
): number[] {
  return group.rowIndices.filter((i) => {
    const r = rows[i];
    return r.ratings.has(system) || r.ratings.size === 0;
  });
}

export function planFleetCreation(input: FleetPlanInput): FleetPlan {
  const { rows, existingFleets, existingCompetitors, csvHasClassColumn, alsoCreateScratch } = input;

  const groups = groupRows(rows);
  const proposed: ProposedFleet[] = [];
  let keyCounter = 0;
  const nextKey = () => `plan-${keyCounter++}`;

  // Iterate groups in insertion order (= first-appearance order in the CSV).
  for (const group of groups.values()) {
    const systems: RatingSystem[] = Array.from(group.presentSystems).sort();

    if (systems.length === 0) {
      // No ratings (or scratch-mode series) → one scratch fleet, bare name.
      let existing = findByName(existingFleets, group.canonicalName);
      if (!existing && group.isImplicitDefault) {
        // Rows with no fleet column belong to the series' implicit default
        // fleet. Identify it as the sole scratch fleet rather than by the
        // literal name "Default", so a default fleet the user has renamed
        // (e.g. to "Scratch") is reused instead of duplicated.
        const scratchFleets = existingFleets.filter((f) => f.scoringSystem === 'scratch');
        if (scratchFleets.length === 1) existing = scratchFleets[0];
      }
      proposed.push({
        key: nextKey(),
        name: existing?.name ?? group.canonicalName,
        scoringSystem: existing?.scoringSystem ?? 'scratch',
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'no-ratings',
        csvFleetName: group.canonicalName,
        rowIndices: group.rowIndices,
      });
    } else if (systems.length === 1) {
      const system = systems[0];
      const bare = findByName(existingFleets, group.canonicalName);
      let chosenName: string;
      let existing: ReturnType<typeof findByName>;
      if (bare && bare.scoringSystem === system) {
        // Bare name available with matching system → reuse.
        existing = bare;
        chosenName = bare.name;
      } else if (bare) {
        // Bare name taken by a different system → must suffix.
        chosenName = suffixedName(group.canonicalName, system);
        existing = findByName(existingFleets, chosenName);
        if (existing) chosenName = existing.name;
      } else {
        // Bare name free → use it.
        chosenName = group.canonicalName;
        existing = undefined;
      }
      proposed.push({
        key: nextKey(),
        name: chosenName,
        scoringSystem: existing?.scoringSystem ?? system,
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'rating-single',
        csvFleetName: group.canonicalName,
        // Single-system groups have presentSystems = {system} ∪ (no-rating
        // rows). Including all rows is correct: rated boats match the
        // system, unrated boats are flagged as missing rating later.
        rowIndices: group.rowIndices,
      });
    } else {
      // Multi-system: one fleet per system.
      // If the bare name in the DB has a system matching one of ours, reuse
      // it for that system (under bare name) and suffix the others.
      const bare = findByName(existingFleets, group.canonicalName);
      const bareReusableForSystem: RatingSystem | null =
        bare && (systems as ScoringSystem[]).includes(bare.scoringSystem)
          ? (bare.scoringSystem as RatingSystem)
          : null;

      for (const system of systems) {
        let chosenName: string;
        let existing: ReturnType<typeof findByName>;
        if (bare && bareReusableForSystem === system) {
          existing = bare;
          chosenName = bare.name;
        } else {
          chosenName = suffixedName(group.canonicalName, system);
          existing = findByName(existingFleets, chosenName);
          if (existing) chosenName = existing.name;
        }
        proposed.push({
          key: nextKey(),
          name: chosenName,
          scoringSystem: existing?.scoringSystem ?? system,
          isExisting: !!existing,
          ...(existing ? { existingFleetId: existing.id } : {}),
          source: 'rating-split',
          csvFleetName: group.canonicalName,
          rowIndices: membershipForSystem(group, rows, system),
        });
      }
    }

    // Optional scratch sibling — only when at least one rating system was
    // in play (a no-rating group's main fleet is already scratch).
    const wantsScratch =
      systems.length >= 1 &&
      alsoCreateScratch[group.canonicalName] === true;
    if (wantsScratch) {
      // Reuse priority: exact suffixed name > bare-name scratch fleet.
      const suffixed = suffixedName(group.canonicalName, 'scratch');
      let existing = findByName(existingFleets, suffixed);
      let chosenName = existing ? existing.name : suffixed;
      if (!existing) {
        const bare = findByName(existingFleets, group.canonicalName);
        if (bare && bare.scoringSystem === 'scratch') {
          existing = bare;
          chosenName = bare.name;
        }
      }
      proposed.push({
        key: nextKey(),
        name: chosenName,
        scoringSystem: 'scratch',
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'also-scratch',
        csvFleetName: group.canonicalName,
        rowIndices: group.rowIndices,
      });
    }
  }

  const shouldFillBoatClassFromFleetName =
    !csvHasClassColumn && existingCompetitors.every((c) => !c.boatClass);

  return { proposed, shouldFillBoatClassFromFleetName };
}
