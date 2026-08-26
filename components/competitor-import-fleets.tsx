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
  py: 'PY',
  nhc: 'NHC',
  echo: 'ECHO',
  orc: 'ORC',
};

/** Which CSV column target holds each rating system's numbers. ORC is absent
 *  by design: its rating is a whole certificate, imported from the ORC
 *  database rather than a CSV column, so the importer never offers it. */
const SYSTEM_TO_RATING_FIELD: Record<Exclude<ScoringSystem, 'scratch' | 'orc'>, CompetitorField> = {
  irc: 'tcc',
  vprs: 'vprsTcc',
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
};

const NO_COLUMN = '__none__';
const NO_GROUPING = '__ungrouped__';

/** Systems the workspace may use, plus any already in play so a control is
 *  never broken by a workspace opting out of a system it depends on. */
function availableSystems(
  has: (key: FeatureKey) => boolean,
  inUse: ReadonlySet<ScoringSystem>,
): ScoringSystem[] {
  return (['scratch', ...RATING_SYSTEMS] as ScoringSystem[]).filter((s) => {
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
   *  The rest stay behind "Add a rating" so the row doesn't list six systems
   *  a club never uses. */
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
    if (existing.includes(system)) return;
    // Re-adding a system the scorer dropped should bring it back rather than
    // stack a second, still-dropped entry.
    const byFleet = { ...overrides.byFleet };
    delete byFleet[planKeyFor(group, system)];
    onOverridesChange({
      byFleet,
      extraSystems: { ...overrides.extraSystems, [group]: [...existing, system] },
    });
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
          <span className="text-sm font-medium w-28 shrink-0">Ratings</span>
          {shownRatings.length === 0 && (
            <span className="text-xs text-muted-foreground">
              No rating columns detected — fleets will be scored on the water.
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
                  Add a rating…
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
              {proposals.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No fleet — these boats will not be imported into any fleet.
                </p>
              )}
              {proposals.map((p) => (
                <FleetRow
                  key={p.key}
                  proposal={p}
                  onRename={(name) => patchFleet(p.key, { name: name || undefined })}
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
                      + Also score on…
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
  onRename,
  onMembership,
  onRemove,
}: {
  proposal: ProposedFleet;
  onRename: (name: string) => void;
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
      <span className="text-xs text-muted-foreground w-16">{SCORING_SYSTEM_LABEL[p.scoringSystem]}</span>
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
      {p.scoringSystem !== 'scratch' && !p.canFilterByRating && (
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
