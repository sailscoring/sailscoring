'use client';

/**
 * The competitor importer's Fleets step: which fleets the import will create,
 * who is in them, and how they are scored.
 *
 * It comes before column mapping because it is the consequential step — it
 * creates persistent objects, decides who is scored against whom, and sets
 * the series' scoring mode. The two column decisions it needs (which column
 * groups the boats, which columns are ratings) are answerable from the values
 * in the file rather than from a full reading of its headers.
 *
 * Those two decisions are made here and nowhere else. Rating roles are absent
 * from the mapping screen's dropdowns, so a plan the scorer approved can't be
 * invalidated a screen later by a remap. Grouping isn't a field role at all —
 * it names a column without consuming that column's mapping, which is how one
 * "Class" column can both split the fleets and record each boat's class.
 *
 * See docs/design/ux/flows/competitor-import.md.
 */

import { useMemo, useState } from 'react';
import type { Fleet } from '@/lib/types';
import type { FeatureKey } from '@/lib/features';
import {
  type ColumnMap,
  type ColumnTarget,
  type CompetitorField,
  parseFleetCell,
} from '@/lib/csv-import';
import {
  type FleetPlan,
  type FleetPlanOverrides,
  type ProposedFleet,
  type ScoringSystem,
  planKeyFor,
} from '@/lib/competitor-import-plan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { X } from 'lucide-react';

/** Display name for a fleet's scoring system. */
export const SCORING_SYSTEM_LABEL: Record<ScoringSystem, string> = {
  scratch: 'Scratch',
  irc: 'IRC',
  vprs: 'VPRS',
  tcf: 'Fixed TCF',
  py: 'PY',
  nhc: 'NHC',
  echo: 'ECHO',
  orc: 'ORC',
};

/** Which CSV column target holds each rating system's numbers. ORC is absent
 *  by design: its rating is a whole certificate, imported from the ORC
 *  database rather than a CSV column, so no column is ever offered for it.
 *  It is still offered as a fleet's scoring system — see FLEET_SYSTEMS. */
const SYSTEM_TO_RATING_FIELD: Record<Exclude<ScoringSystem, 'scratch' | 'orc'>, CompetitorField> = {
  irc: 'tcc',
  vprs: 'vprsTcc',
  tcf: 'fixedTcf',
  py: 'py',
  nhc: 'nhcStartingTcf',
  echo: 'echoStartingTcf',
};

const RATING_SYSTEMS = Object.keys(SYSTEM_TO_RATING_FIELD) as Exclude<ScoringSystem, 'scratch' | 'orc'>[];

/** The feature key gating each system, matching the Fleets card. NHC and
 *  scratch are ungated. */
const SYSTEM_FEATURE: Partial<Record<ScoringSystem, FeatureKey>> = {
  irc: 'irc-rating',
  py: 'rya-py',
  vprs: 'vprs',
  echo: 'echo',
  orc: 'orc',
};

/** Systems a fleet can be scored on here. Wider than `RATING_SYSTEMS`, which
 *  is only about columns: ORC has no rating column — its rating is a whole
 *  certificate off the ORC database — but it is a fleet's scoring system like
 *  any other, and the series' Fleets card has always offered it. Leaving it
 *  out of this step meant a series needing an ORC fleet (a non-spinnaker
 *  class, a sportsboat division) had to be finished elsewhere, with nothing
 *  said about why (#521). */
const FLEET_SYSTEMS = ['scratch', ...RATING_SYSTEMS, 'orc'] as ScoringSystem[];

const NO_COLUMN = '__none__';
const NO_GROUPING = '__ungrouped__';

/** Systems the workspace may use, plus any already in play so a control is
 *  never broken by a workspace opting out of a system it depends on. */
function availableSystems(
  has: (key: FeatureKey) => boolean,
  inUse: ReadonlySet<ScoringSystem>,
): ScoringSystem[] {
  return FLEET_SYSTEMS.filter((s) => {
    const feature = SYSTEM_FEATURE[s];
    return !feature || has(feature) || inUse.has(s);
  });
}

/** Columns worth offering as the grouping column: something repeats, and not
 *  so many distinct values that they can't be fleets. A sail-number or name
 *  column is all-distinct and never qualifies. */
function groupingCandidates(headers: string[], rows: string[][]): number[] {
  return headers
    .map((_, col) => col)
    .filter((col) => {
      const values = new Set<string>();
      for (const row of rows) {
        const v = row[col]?.trim();
        if (v) values.add(v);
      }
      return values.size >= 1 && values.size < rows.length && values.size <= 26;
    });
}

function distinctCount(rows: string[][], col: number): number {
  const values = new Set<string>();
  for (const row of rows) {
    const v = row[col]?.trim();
    if (v) values.add(v);
  }
  return values.size;
}

export function FleetsStepBody({
  headers,
  rows,
  columnMap,
  groupByColumn,
  overrides,
  plan,
  fleets,
  has,
  splitFleetSeries,
  onColumnMapChange,
  onGroupByColumnChange,
  onOverridesChange,
}: {
  headers: string[];
  rows: string[][];
  columnMap: ColumnMap;
  groupByColumn: number | null;
  overrides: FleetPlanOverrides;
  plan: FleetPlan;
  /** Fleets already in the series, for the "existing" hint. */
  fleets: Fleet[];
  has: (key: FeatureKey) => boolean;
  /** A split-fleet championship: the fleets are the assignment rounds' to
   *  create and fill, so this step groups nothing. */
  splitFleetSeries?: boolean;
  onColumnMapChange: (col: number, target: ColumnTarget) => void;
  onGroupByColumnChange: (col: number | null) => void;
  onOverridesChange: (next: FleetPlanOverrides) => void;
}) {
  const candidates = useMemo(() => groupingCandidates(headers, rows), [headers, rows]);
  /** Systems the scorer has asked to attach a column to but hasn't yet
   *  picked one for — they need a row to pick in. */
  const [pendingRatings, setPendingRatings] = useState<Exclude<ScoringSystem, 'scratch'>[]>([]);

  /** Which column, if any, currently holds each rating system. */
  const ratingColumns = useMemo(() => {
    const byField = new Map<CompetitorField, number>();
    for (const [colStr, target] of Object.entries(columnMap)) {
      byField.set(target as CompetitorField, parseInt(colStr, 10));
    }
    return new Map(
      RATING_SYSTEMS.map((s) => [s, byField.get(SYSTEM_TO_RATING_FIELD[s]) ?? null] as const),
    );
  }, [columnMap]);

  const systemsInUse = useMemo(() => {
    const set = new Set<ScoringSystem>(plan.proposed.map((p) => p.scoringSystem));
    for (const f of fleets) set.add(f.scoringSystem);
    return set;
  }, [plan, fleets]);

  const offerable = availableSystems(has, systemsInUse);

  /** Systems with a column, plus any the scorer has asked to attach one to.
   *  The rest stay behind "Add a rating column…" so the row doesn't list six
   *  systems a club never uses. */
  const shownRatings = RATING_SYSTEMS.filter(
    (s) => ratingColumns.get(s) != null || pendingRatings.includes(s),
  );
  const addableRatings = RATING_SYSTEMS.filter(
    (s) => !shownRatings.includes(s) && offerable.includes(s),
  );

  function setRatingColumn(system: Exclude<ScoringSystem, 'scratch' | 'orc'>, col: number | null) {
    const field = SYSTEM_TO_RATING_FIELD[system];
    const current = ratingColumns.get(system) ?? null;
    // Releasing a column returns it to the mapping screen as unmapped.
    if (current != null && current !== col) onColumnMapChange(current, 'ignore');
    if (col != null) onColumnMapChange(col, field);
  }

  const groups = useMemo(() => {
    const byName = new Map<string, ProposedFleet[]>();
    for (const p of plan.proposed) {
      const arr = byName.get(p.csvFleetName);
      if (arr) arr.push(p);
      else byName.set(p.csvFleetName, [p]);
    }
    return [...byName.entries()];
  }, [plan]);

  /** Every group the file contains, including ones whose fleets have all
   *  been dropped — otherwise removing a group's only fleet would remove the
   *  controls needed to add another. */
  const allGroupNames = useMemo(() => {
    if (groupByColumn == null) return [...new Set(groups.map(([n]) => n))];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const parsed = parseFleetCell(row[groupByColumn]?.trim() ?? '');
      for (const name of parsed.length ? parsed : ['Default']) {
        const key = name.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          names.push(name);
        }
      }
    }
    return names;
  }, [groupByColumn, rows, groups]);

  function patchFleet(key: string, patch: Record<string, unknown>) {
    const next = { ...overrides.byFleet[key], ...patch };
    for (const k of Object.keys(next)) {
      if (next[k as keyof typeof next] === undefined) delete next[k as keyof typeof next];
    }
    const byFleet = { ...overrides.byFleet };
    if (Object.keys(next).length === 0) delete byFleet[key];
    else byFleet[key] = next;
    onOverridesChange({ ...overrides, byFleet });
  }

  function addSystem(group: string, system: ScoringSystem) {
    const existing = overrides.extraSystems[group] ?? [];
    // Asking for a system always clears a drop on that group's fleet of that
    // system: "score this group on Scratch" means the same thing whether the
    // fleet was dropped from the file's own proposals or from an earlier ask.
    // The un-drop used to sit behind an early return when the system was
    // already asked for, which left the group holding a drop and an ask that
    // cancelled each other out and no way to undo either (#523).
    const byFleet = { ...overrides.byFleet };
    delete byFleet[planKeyFor(group, system)];
    onOverridesChange({
      byFleet,
      extraSystems: existing.includes(system)
        ? overrides.extraSystems
        : { ...overrides.extraSystems, [group]: [...existing, system] },
    });
  }

  /**
   * Re-score a proposed fleet on a different system.
   *
   * A proposal's identity is `planKeyFor(group, system)`, so this can't be a
   * field on the proposal — changing the system changes the identity. It is
   * the two gestures the step already has, composed into one: retire the old
   * proposal the way `removeFleet` would, and ask for the new system the way
   * `addSystem` would. Both edits go out as a single override update, since
   * calling the two functions in turn would compute the second from a stale
   * `overrides` (#519). A rename the scorer already typed moves across with
   * it — the fleet they were naming is the fleet they still mean.
   */
  function changeSystem(p: ProposedFleet, system: ScoringSystem) {
    if (p.scoringSystem === system) return;
    const group = p.csvFleetName;
    const byFleet = { ...overrides.byFleet };
    const carriedName = byFleet[p.key]?.name;

    let extras = overrides.extraSystems[group] ?? [];
    if (p.source === 'added') {
      // Asked for, so un-ask — a drop flag would leave an invisible request.
      extras = extras.filter((s) => s !== p.scoringSystem);
    } else {
      byFleet[p.key] = { ...byFleet[p.key], drop: true };
    }

    delete byFleet[planKeyFor(group, system)];
    if (carriedName) byFleet[planKeyFor(group, system)] = { name: carriedName };
    if (!extras.includes(system)) extras = [...extras, system];

    const extraSystems = { ...overrides.extraSystems };
    if (extras.length) extraSystems[group] = extras;
    else delete extraSystems[group];
    onOverridesChange({ byFleet, extraSystems });
  }

  function removeFleet(p: ProposedFleet) {
    const group = p.csvFleetName;
    const extras = overrides.extraSystems[group] ?? [];
    if (p.source === 'added') {
      // An added fleet is removed by un-asking for it, not by a drop flag —
      // otherwise the group keeps an invisible request the scorer can't see.
      const remaining = extras.filter((s) => s !== p.scoringSystem);
      const extraSystems = { ...overrides.extraSystems };
      if (remaining.length) extraSystems[group] = remaining;
      else delete extraSystems[group];
      onOverridesChange({ ...overrides, extraSystems });
      return;
    }
    patchFleet(p.key, { drop: true });
  }

  const totalRows = rows.length;

  return (
    <div className="space-y-4 overflow-y-auto max-h-[60vh]">
      {/* ── The two column decisions this step owns ─────────────────────── */}
      <div className="rounded-md border p-3 space-y-3 bg-muted/30">
        {splitFleetSeries ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium w-28 shrink-0">Fleets</span>
            <span className="text-xs text-muted-foreground">
              Assigned, not imported — the qualifying fleets are created when
              you assign the first round. A fleet column on this sheet is read
              as the seeding committee&rsquo;s assignment, and you can seed the
              round from it there.
            </span>
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium w-28 shrink-0">Group boats by</span>
          <Select
            value={groupByColumn == null ? NO_GROUPING : String(groupByColumn)}
            onValueChange={(v) => onGroupByColumnChange(v === NO_GROUPING ? null : parseInt(v, 10))}
          >
            <SelectTrigger className="w-56 h-8 text-sm" data-testid="group-by-column">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUPING}>Not split — one fleet</SelectItem>
              {candidates.map((col) => (
                <SelectItem key={col} value={String(col)}>
                  {headers[col] || `Column ${col + 1}`} ({distinctCount(rows, col)} groups)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groupByColumn == null && (
            <span className="text-xs text-muted-foreground">
              One fleet — all {totalRows} {totalRows === 1 ? 'boat' : 'boats'}.
              {candidates.length > 0 && ' Split them by a column above?'}
            </span>
          )}
        </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium w-28 shrink-0">Rating columns</span>
          {/* Name the system the fleets will actually get, and point at the
              control that changes it. "Scored on the water" described the
              outcome without naming the setting, and the nearest button —
              "Add a rating column…" — asks for a column this file hasn't
              got, which is the wrong turn to leave open (#520, #522). */}
          {shownRatings.length === 0 && (
            <span className="text-xs text-muted-foreground">
              None detected — fleets will be created as Scratch. Change a
              fleet&rsquo;s <em>Scored on</em> below to score it on a handicap
              system instead.
            </span>
          )}
          {shownRatings.map((system) => (
            <label key={system} className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{SCORING_SYSTEM_LABEL[system]}</span>
              <Select
                value={String(ratingColumns.get(system) ?? NO_COLUMN)}
                onValueChange={(v) =>
                  setRatingColumn(system, v === NO_COLUMN ? null : parseInt(v, 10))
                }
              >
                <SelectTrigger className="w-40 h-8 text-sm" data-testid={`rating-column-${system}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COLUMN}>— none —</SelectItem>
                  {headers.map((h, col) => (
                    <SelectItem key={col} value={String(col)}>
                      {h || `Column ${col + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
          {addableRatings.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" data-testid="add-rating">
                  Add a rating column…
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {addableRatings.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onSelect={() => setPendingRatings((prev) => [...prev, s])}
                  >
                    {SCORING_SYSTEM_LABEL[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ── The plan ────────────────────────────────────────────────────── */}
      <div className="space-y-2" data-testid="fleet-plan">
        {allGroupNames.map((groupName) => {
          const proposals = groups.find(([n]) => n.toLowerCase() === groupName.toLowerCase())?.[1] ?? [];
          const present = new Set(proposals.map((p) => p.scoringSystem));
          const canAdd = offerable.filter((s) => !present.has(s));
          return (
            <div key={groupName} className="rounded-md border p-3 space-y-2" data-testid="fleet-group">
              <p className="text-xs font-mono text-muted-foreground">{groupName}</p>
              {/* Clearing a group's proposals is how a scorer says "these
                  fleets already exist" on a re-import, so the note has to say
                  what that actually does: existing competitors keep their
                  membership (#527), and only boats new to the series arrive
                  without one. */}
              {proposals.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No fleet to create — boats already in this series keep the fleets
                  they are in; boats new to it arrive in none.
                </p>
              )}
              {proposals.map((p) => (
                <FleetRow
                  key={p.key}
                  proposal={p}
                  // Its own system, plus those the group doesn't already have.
                  // Offering a system a sibling holds would land two proposals
                  // on one plan key (#523).
                  systemOptions={[p.scoringSystem, ...canAdd]}
                  onRename={(name) => patchFleet(p.key, { name: name || undefined })}
                  onSystem={(s) => changeSystem(p, s)}
                  onMembership={(m) => patchFleet(p.key, { membership: m })}
                  onRemove={() => removeFleet(p)}
                />
              ))}
              {canAdd.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      data-testid={`add-system-${groupName}`}
                    >
                      + Also score this group on…
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {canAdd.map((s) => (
                      <DropdownMenuItem key={s} onSelect={() => addSystem(groupName, s)}>
                        {SCORING_SYSTEM_LABEL[s]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FleetRow({
  proposal,
  systemOptions,
  onRename,
  onSystem,
  onMembership,
  onRemove,
}: {
  proposal: ProposedFleet;
  /** Systems this proposal may be re-scored on: what the workspace offers,
   *  less those its group already has a fleet of, plus its own current one. */
  systemOptions: ScoringSystem[];
  onRename: (name: string) => void;
  onSystem: (system: ScoringSystem) => void;
  onMembership: (membership: 'all' | 'rated') => void;
  onRemove: () => void;
}) {
  const p = proposal;
  const boats = p.rowIndices.length;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="fleet-row">
      {p.isExisting ? (
        <span className="text-sm font-medium w-44 truncate" title={p.name}>{p.name}</span>
      ) : (
        <Input
          value={p.name}
          onChange={(e) => onRename(e.target.value)}
          className="w-44 h-8 text-sm"
          aria-label={`Name for ${p.name}`}
        />
      )}
      {/* An existing fleet's system is the fleet's own; the plan never mutates
          one. Only a fleet this import would create is re-scorable here. */}
      {p.isExisting ? (
        <span className="text-xs text-muted-foreground w-24">
          {SCORING_SYSTEM_LABEL[p.scoringSystem]}
        </span>
      ) : (
        <Select value={p.scoringSystem} onValueChange={(v) => onSystem(v as ScoringSystem)}>
          <SelectTrigger className="w-24 h-8 text-xs" aria-label={`Scored on for ${p.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {systemOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {SCORING_SYSTEM_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={p.membership}
        onValueChange={(v) => onMembership(v as 'all' | 'rated')}
        disabled={!p.canFilterByRating}
      >
        <SelectTrigger className="w-36 h-8 text-xs" aria-label={`Membership for ${p.name}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All boats</SelectItem>
          <SelectItem value="rated">Rated boats only</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">
        {boats} {boats === 1 ? 'boat' : 'boats'}
        {p.isExisting && ' · existing'}
      </span>
      {/* ORC is never short of a *column* — it doesn't have one to be short
          of. Saying so would send a scorer looking for a column to map. */}
      {p.scoringSystem === 'orc' && (
        <span className="text-xs text-muted-foreground">
          · certificates come from the ORC database, not this file
        </span>
      )}
      {p.scoringSystem !== 'scratch' && p.scoringSystem !== 'orc' && !p.canFilterByRating && (
        <span className="text-xs text-muted-foreground">
          · no {SCORING_SYSTEM_LABEL[p.scoringSystem]} column in this file
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-7 px-2"
        onClick={onRemove}
        aria-label={`Remove ${p.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
