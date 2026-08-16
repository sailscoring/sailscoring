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
 * The proposal is a starting point, not the answer. `overrides` carries the
 * scorer's edits from the wizard's Fleets step: extra systems to score a
 * group on beyond those the file implies, and per-fleet changes to name,
 * membership, or whether to create the fleet at all.
 *
 * Overrides are keyed on `<group>::<system>` rather than on position. A
 * proposal's position moves whenever the rating columns change, and the
 * planner never proposes two fleets with the same (group, system), so the
 * pair is both stable and unique.
 *
 * Existing fleets are reused by case-insensitive name match. The plan
 * never proposes mutating an existing fleet's scoringSystem; if the bare
 * name is taken by a different system, the new fleet is created with the
 * suffixed name instead. The one exception is the implicit default group
 * (rows with no grouping column): when no fleet is literally named
 * "Default" it reuses the series' sole scratch fleet, so a renamed default
 * fleet is reused rather than duplicated.
 */

import type { Fleet } from './types';

export type RatingSystem = 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';
export type ScoringSystem = RatingSystem | 'scratch';

/**
 * Who joins a proposed fleet.
 *
 * - `all`   — every row in the group.
 * - `rated` — rows carrying a value for this fleet's system, plus rows with
 *   no rating at all (a boat nobody rated belongs everywhere its group is
 *   scored, so a placeholder rating draws DNC pressure instead of quietly
 *   vanishing).
 *
 * A scratch fleet is always `all`: line honours has no rating to filter on.
 */
export type FleetMembership = 'all' | 'rated';

/** A scorer's edits to one proposed fleet. */
export type FleetOverride = {
  /** Rename the fleet the plan would create. Ignored when reusing an
   *  existing fleet — the plan never renames what it didn't create. */
  name?: string;
  membership?: FleetMembership;
  /** Drop this fleet from the plan entirely. */
  drop?: boolean;
};

export type FleetPlanOverrides = {
  /** Per canonical group name, systems to score the group on beyond those
   *  its rows imply. A system already inferred for the group is ignored
   *  rather than duplicated. */
  extraSystems: Record<string, ScoringSystem[]>;
  /** Per proposed fleet, keyed by `planKeyFor`. */
  byFleet: Record<string, FleetOverride>;
};

export const NO_OVERRIDES: FleetPlanOverrides = { extraSystems: {}, byFleet: {} };

/** Stable identity for a proposed fleet: unique within a plan, and
 *  unchanged when unrelated column mappings move the proposal around. */
export function planKeyFor(csvFleetName: string, system: ScoringSystem): string {
  return `${csvFleetName.toLowerCase()}::${system}`;
}

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
  /** Stable identity — see `planKeyFor`. Doubles as the React key. */
  key: string;
  /** Fleet name as it should appear (may be suffixed; matches existing
   *  fleet's stored casing when reusing). */
  name: string;
  scoringSystem: ScoringSystem;
  /** True when this proposal reuses an existing fleet. */
  isExisting: boolean;
  /** Set iff isExisting. */
  existingFleetId?: string;
  /** Where this proposal came from — used for UI hints and for the
   *  membership default. `added` means the scorer asked for it; the file
   *  said nothing. */
  source: 'rating-split' | 'rating-single' | 'no-ratings' | 'added';
  /** Original grouping-column value this proposal belongs to (case
   *  preserved). Multiple proposals share this when split across systems. */
  csvFleetName: string;
  membership: FleetMembership;
  /** False when this fleet's system has no rating column in the file, so
   *  `rated` membership would select nothing and isn't offered. */
  canFilterByRating: boolean;
  /** Indices into the input `rows` array that belong in this fleet. */
  rowIndices: number[];
};

export type FleetPlan = {
  proposed: ProposedFleet[];
};

export type FleetPlanInput = {
  rows: PlanRow[];
  existingFleets: Pick<Fleet, 'id' | 'name' | 'scoringSystem'>[];
  overrides: FleetPlanOverrides;
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

/** Filter group rows for a rating-filtered membership: rated boats join
 *  fleets matching their rating; unrated boats join all of the group's
 *  handicap fleets. */
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

/** Everything a proposal needs before the scorer's overrides are folded in.
 *  `rowIndices` and `membership` are resolved by `finish`, since an override
 *  can change which of the two membership rules applies. */
type Draft = Omit<ProposedFleet, 'key' | 'membership' | 'canFilterByRating' | 'rowIndices'> & {
  defaultMembership: FleetMembership;
};

export function planFleetCreation(input: FleetPlanInput): FleetPlan {
  const { rows, existingFleets, overrides } = input;

  const groups = groupRows(rows);
  const proposed: ProposedFleet[] = [];

  /** Fold the scorer's overrides into a draft. Returns null when the fleet
   *  was dropped from the plan. */
  const finish = (draft: Draft, group: Group): ProposedFleet | null => {
    const key = planKeyFor(draft.csvFleetName, draft.scoringSystem);
    const override = overrides.byFleet[key];
    if (override?.drop) return null;

    const system = draft.scoringSystem;
    const canFilterByRating =
      system !== 'scratch' && group.presentSystems.has(system);
    // A `rated` choice the file can't honour falls back to `all` rather than
    // silently emptying the fleet.
    const membership: FleetMembership =
      override?.membership && (override.membership === 'all' || canFilterByRating)
        ? override.membership
        : canFilterByRating
          ? draft.defaultMembership
          : 'all';

    const renamed = !draft.isExisting && override?.name?.trim();

    return {
      key,
      name: renamed || draft.name,
      scoringSystem: system,
      isExisting: draft.isExisting,
      ...(draft.existingFleetId ? { existingFleetId: draft.existingFleetId } : {}),
      source: draft.source,
      csvFleetName: draft.csvFleetName,
      membership,
      canFilterByRating,
      rowIndices:
        membership === 'rated'
          ? membershipForSystem(group, rows, system as RatingSystem)
          : group.rowIndices,
    };
  };

  const push = (draft: Draft, group: Group) => {
    const p = finish(draft, group);
    if (p) proposed.push(p);
  };

  // Iterate groups in insertion order (= first-appearance order in the file).
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
      push({
        name: existing?.name ?? group.canonicalName,
        scoringSystem: existing?.scoringSystem ?? 'scratch',
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'no-ratings',
        csvFleetName: group.canonicalName,
        defaultMembership: 'all',
      }, group);
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
      push({
        name: chosenName,
        scoringSystem: existing?.scoringSystem ?? system,
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'rating-single',
        csvFleetName: group.canonicalName,
        // The group's only system, so every row belongs: rated boats match
        // it, unrated boats are flagged as missing a rating later.
        defaultMembership: 'all',
      }, group);
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
        push({
          name: chosenName,
          scoringSystem: existing?.scoringSystem ?? system,
          isExisting: !!existing,
          ...(existing ? { existingFleetId: existing.id } : {}),
          source: 'rating-split',
          csvFleetName: group.canonicalName,
          defaultMembership: 'rated',
        }, group);
      }
    }

    // Systems the scorer asked for on top of what the file implies. The
    // group's inferred fleets already hold the bare name, so these are
    // always suffixed; an existing fleet under that name is reused, as is a
    // bare-named fleet that happens to use the same system.
    const asked = overrides.extraSystems[group.canonicalName] ?? [];
    const seen = new Set<ScoringSystem>(systems);
    for (const system of asked) {
      if (seen.has(system)) continue;
      seen.add(system);

      const suffixed = suffixedName(group.canonicalName, system);
      let existing = findByName(existingFleets, suffixed);
      let chosenName = existing ? existing.name : suffixed;
      if (!existing) {
        const bare = findByName(existingFleets, group.canonicalName);
        if (bare && bare.scoringSystem === system) {
          existing = bare;
          chosenName = bare.name;
        }
      }
      push({
        name: chosenName,
        scoringSystem: system,
        isExisting: !!existing,
        ...(existing ? { existingFleetId: existing.id } : {}),
        source: 'added',
        csvFleetName: group.canonicalName,
        // The file said nothing about this system, so it can rarely filter
        // by rating; `finish` clamps to `all` when it can't.
        defaultMembership: 'all',
      }, group);
    }
  }

  return { proposed };
}
