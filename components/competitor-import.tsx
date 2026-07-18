'use client';

import { useState, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, memo } from 'react';
import {
  seriesRepo,
  fleetRepo,
  competitorRepo,
  pushCompetitorsToRrsOrg,
  DEFAULT_FLEET_NAME,
} from '@/lib/api-repository';
import { useFeatures } from '@/components/features-provider';
import {
  buildRrsOrgCompetitors,
  type RrsOrgBuildWarning,
  type RrsOrgCompetitor,
  type RrsOrgPushResult,
  type RrsOrgRelayFields,
} from '@/lib/rrs-org';
import { useUpdateSeries } from '@/hooks/use-series';
import { useSaveFleets } from '@/hooks/use-fleets';
import { useSaveCompetitors } from '@/hooks/use-competitors';
import {
  parseFleetCell,
  autoDetectField,
  autoDetectRelayField,
  matchSubdivisionAxis,
  axisColumnTarget,
  subdivisionAxisIdOf,
  isSubdivisionTarget,
  relayColumnTarget,
  relayFieldOf,
  splitCrewCell,
  NEW_AXIS_TARGET,
  RELAY_FIELDS,
  type CompetitorField,
  type ColumnTarget,
  type RelayField,
} from '@/lib/csv-import';
import {
  parseTabularFile,
  TABULAR_IMPORT_ACCEPT,
  type WorkbookSheet,
} from '@/lib/import-table';
import { SheetPickerDialog, ImportFileErrorDialog } from '@/components/import-file-dialogs';
import { lookupAlias, normalizeCodeInput } from '@/lib/nationality';
import { matchLikelySameBoat, type MatchEntry } from '@/lib/competitor-matching';
import {
  planFleetCreation,
  type PlanRow,
  type RatingSystem,
  type FleetPlan,
  type ProposedFleet,
} from '@/lib/competitor-import-plan';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Upload } from 'lucide-react';
import type { Competitor, Fleet, CompetitorFieldKey, PrimaryPersonLabel, SubdivisionAxis } from '@/lib/types';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
  formatPrimaryNames,
  samePersonNames,
  sameFleetIdSet,
  subdivisionAxes,
  newSubdivisionAxis,
  cleanSubdivisions,
  subdivisionsEqual,
} from '@/lib/competitor-fields';
import { log } from '@/lib/debug';

// ── Types ───────────────────────────────────────────────────────────────────

type ColumnMap = Record<number, ColumnTarget>;

/** The rrs.org side of an import, threaded through the flow when the scorer
 *  ticked "Import to rrs.org" (gated by the `rrs-import` feature). */
interface RrsImportConfig {
  eventUuid: string;
  divisionSource: 'none' | 'fleet' | 'axis';
  divisionAxisId?: string;
}

/** The mapping dialog's wider division choice: rrs.org's division can also
 *  come from a column mapped to a NEW subdivision axis, which has no axis id
 *  until the import mints it — so the dialog holds the column index and
 *  `handleImport` resolves it to the fresh axis id before pushing. Never
 *  leaves the client; the API only sees the resolved RrsImportConfig. */
interface MappingRrsConfig {
  eventUuid: string;
  divisionSource: 'none' | 'fleet' | 'axis' | 'newAxisColumn';
  divisionAxisId?: string;
  divisionColumnIndex?: number;
}

/** Everything the done dialog needs to report a push — and to retry it
 *  without re-running the CSV import (the rows are kept as sent). */
interface PushOutcome {
  config: RrsImportConfig;
  rows: RrsOrgCompetitor[];
  warnings: RrsOrgBuildWarning[];
  relayCount: number;
  result: RrsOrgPushResult;
}

type ImportFlow =
  | { step: 'idle' }
  | {
      /** The flag-on entry dialog: pick the source (CSV) and/or the
       *  destination (rrs.org) before any work happens. */
      step: 'choose';
      csvChecked: boolean;
      rrsChecked: boolean;
      eventUuid: string;
      file: File | null;
      /** Saved push settings, for pre-filling the division source later. */
      savedConfig: RrsImportConfig | null;
    }
  | {
      /** The push-only confirm: no CSV, no column table — the division
       *  choice, a preview of what stored data becomes, and the warning. */
      step: 'pushConfirm';
      config: RrsImportConfig;
      competitors: Competitor[];
      fleets: Fleet[];
      axes: SubdivisionAxis[];
    }
  | {
      /** Multi-sheet workbook: choose the sheet before mapping. Carries the
       *  rrs.org side of the import (if any) through to the mapping step. */
      step: 'pickSheet';
      sheets: WorkbookSheet[];
      rrs: { eventUuid: string; saved: RrsImportConfig | null } | null;
    }
  | { step: 'fileError'; message: string }
  | {
      step: 'mapping';
      headers: string[];
      sampleRows: string[][];
      rows: string[][];
      columnMap: ColumnMap;
      /** True if this is the *first* import into an empty-competitor series.
       *  Drives whether series-level proposals (primary label, enabled fields)
       *  are offered at all, and whether they are additive-only. */
      firstImport: boolean;
      /** Primary label currently persisted on the series. */
      currentPrimary: PrimaryPersonLabel;
      /** The user-editable primary label the wizard will persist on confirm. */
      proposedPrimary: PrimaryPersonLabel;
      /** Currently enabled optional fields. */
      currentFields: CompetitorFieldKey[];
      /** Proposed enabled optional fields (includes currentFields ∪ additions). */
      proposedFields: CompetitorFieldKey[];
      /** The series' configured subdivision axes, each offered as a distinct
       *  dropdown target for a subdivision column. */
      subdivisionAxes: SubdivisionAxis[];
      /** Series scoring mode at upload time. The planner doesn't take this
       *  as input — column mappings drive system choice. We track it here
       *  only so the importer knows whether to flip the series to
       *  'handicap' on confirm (when the plan produces handicap fleets). */
      seriesScoringMode: 'scratch' | 'handicap';
      /** True iff at least one existing competitor in the series has a
       *  boatClass — disables the "fleet name → boatClass" fallback. */
      existingHasBoatClass: boolean;
      /** User toggle per CSV-fleet-name canonical group: should an extra
       *  scratch sibling be created (for line honours)? */
      alsoCreateScratch: Record<string, boolean>;
      /** Present when the import also pushes to rrs.org. */
      rrs: MappingRrsConfig | null;
    }
  | {
      /** Review step between mapping and the actual import: CSV rows that
       *  look like sail-number changes of existing competitors. Accepted
       *  rows update the existing competitor in place (same id, results
       *  kept); rejected rows are imported as new competitors. */
      step: 'renames';
      mapping: Extract<ImportFlow, { step: 'mapping' }>;
      candidates: RenameCandidate[];
      /** Parallel to `candidates`; all true initially. */
      accepted: boolean[];
    }
  | {
      step: 'done';
      /** CSV import counts; null for a push-only flow. */
      csv: { added: number; updated: number; unchanged: number; fleetsCreated: string[]; errors: { rowIndex: number; reason: string }[] } | null;
      /** rrs.org push outcome; null for a plain CSV import. */
      push: PushOutcome | null;
    };

type MappingFlow = Extract<ImportFlow, { step: 'mapping' }>;

/** One suspected sail-number change, for the review step. */
interface RenameCandidate {
  rowIndex: number;
  newSailNumber: string;
  existingId: string;
  oldSailNumber: string;
  /** Display fields — CSV value, falling back to the existing record. */
  boatName: string;
  personName: string;
  matchedOn: 'boat name' | 'name';
}

export interface ImportResult {
  added: number;
  updated: number;
  unchanged: number;
  fleetsCreated: string[];
  errors: { rowIndex: number; reason: string }[];
}

/** Labels that don't depend on the primary role. */
const STATIC_FIELD_LABELS: Record<Exclude<CompetitorField, 'primary' | 'helm' | 'owner'>, string> = {
  sailNumber: 'Sail number',
  bowNumber: 'Bow number',
  boatName: 'Boat name',
  boatClass: 'Class',
  crewName: 'Crew',
  club: 'Club',
  nationality: 'Nationality',
  gender: 'Gender',
  age: 'Age',
  subdivision: 'Division',  // fallback; overridden per-series in buildFieldLabels
  fleet: 'Fleet',
  tcc: 'IRC TCC',
  vprsTcc: 'VPRS TCC',
  py: 'PY number',
  nhcStartingTcf: 'NHC starting TCF',
  echoStartingTcf: 'ECHO starting handicap',
  ignore: '(ignore)',
};

/** Build the ordered dropdown options for the current primary label and the
 *  series' subdivision axes. The primary slot and role slots are emitted in a
 *  shared order; the role that matches the primary is hidden (it's already
 *  covered by `primary`). Each configured axis is its own target, plus a
 *  "New subdivision axis" option that creates one from the column header.
 *  Keyed by `ColumnTarget` string; insertion order is the display order. */
/** Dropdown labels for the relay-only targets, shown only when the import
 *  also pushes to rrs.org. The suffix carries the not-stored contract. */
const RELAY_FIELD_LABELS: Record<RelayField, string> = {
  email: 'Email (rrs.org only)',
  phone: 'Phone (rrs.org only)',
  mnaCode: 'MNA code (rrs.org only)',
  mnaNumber: 'MNA number (rrs.org only)',
};

function buildFieldLabels(
  primary: PrimaryPersonLabel,
  axes: SubdivisionAxis[],
  includeRelay = false,
): Record<string, string> {
  const primaryText = PRIMARY_PERSON_LABEL_TEXT[primary];
  const labels: Record<string, string> = {
    sailNumber: STATIC_FIELD_LABELS.sailNumber,
    bowNumber: STATIC_FIELD_LABELS.bowNumber,
    boatName: STATIC_FIELD_LABELS.boatName,
    boatClass: STATIC_FIELD_LABELS.boatClass,
    primary: `${primaryText} name (primary)`,
  };
  if (!isFieldDisabledByPrimary('helm', primary)) labels.helm = 'Helm name';
  if (!isFieldDisabledByPrimary('owner', primary)) labels.owner = 'Owner name';
  Object.assign(labels, {
    crewName: STATIC_FIELD_LABELS.crewName,
    club: STATIC_FIELD_LABELS.club,
    nationality: STATIC_FIELD_LABELS.nationality,
    gender: STATIC_FIELD_LABELS.gender,
    age: STATIC_FIELD_LABELS.age,
  });
  for (const axis of axes) {
    labels[axisColumnTarget(axis.id)] = axis.label.trim() || DEFAULT_SUBDIVISION_LABEL;
  }
  labels[NEW_AXIS_TARGET] = 'New subdivision axis';
  Object.assign(labels, {
    fleet: STATIC_FIELD_LABELS.fleet,
    tcc: STATIC_FIELD_LABELS.tcc,
    vprsTcc: STATIC_FIELD_LABELS.vprsTcc,
    py: STATIC_FIELD_LABELS.py,
    nhcStartingTcf: STATIC_FIELD_LABELS.nhcStartingTcf,
    echoStartingTcf: STATIC_FIELD_LABELS.echoStartingTcf,
  });
  if (includeRelay) {
    for (const field of RELAY_FIELDS) {
      labels[relayColumnTarget(field)] = RELAY_FIELD_LABELS[field];
    }
  }
  labels.ignore = STATIC_FIELD_LABELS.ignore;
  return labels;
}

// ── Helpers ─────────────────────────────────────────────────────────────────


/** Propose a primary-person label from the detected column roles. Matches
 *  the plan in issue #93: Owner + Helm both → Owner (cruiser pattern); Owner
 *  only → Owner; Helm only → Helm; neither → fallback (`fallback` is the
 *  currently-configured primary so subsequent imports don't flip it). */
function proposePrimaryLabel(
  columnMap: ColumnMap,
  fallback: PrimaryPersonLabel,
): PrimaryPersonLabel {
  const targets = Object.values(columnMap);
  const hasOwner = targets.includes('owner');
  const hasHelm = targets.includes('helm');
  if (hasOwner && hasHelm) return 'owner';
  if (hasOwner) return 'owner';
  if (hasHelm) return 'helm';
  return fallback;
}

/** If the proposed primary absorbs a detected role column (e.g. primary=owner
 *  but a column was detected as `owner`), re-label that column to `primary`
 *  so the single primary slot is populated. Other unmatched detections
 *  (a `primary`-detected column when proposed primary=helm) stay as-is — we
 *  avoid silently reinterpreting; surfacing as `primary` can lead to
 *  duplicate primaries, which the validator flags. */
function reconcileColumnMap(columnMap: ColumnMap, proposed: PrimaryPersonLabel): ColumnMap {
  const out: ColumnMap = { ...columnMap };
  const primaryRole = proposed === 'helm' ? 'helm' : proposed === 'owner' ? 'owner' : null;
  if (!primaryRole) return out;
  for (const [k, v] of Object.entries(out)) {
    if (v === primaryRole) out[Number(k)] = 'primary';
  }
  return out;
}

/** Shape check for the rrs.org event UUID pasted into the choice dialog —
 *  enough to catch a stray name or URL; rrs.org validates the real thing. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The push config a flow starts from: the saved settings when still valid
 *  (a remembered axis may have been deleted since), else a sensible default.
 *  Subdivision axes are the natural rrs.org division candidates — one
 *  labelled "Division" wins outright, a lone axis is next — then fleet names
 *  when there are several fleets, then nothing. */
function defaultRrsConfig(
  eventUuid: string,
  saved: RrsImportConfig | null,
  axes: SubdivisionAxis[],
  fleetCount: number,
): RrsImportConfig {
  if (saved) {
    if (saved.divisionSource !== 'axis') return { eventUuid, divisionSource: saved.divisionSource };
    if (saved.divisionAxisId && axes.some((a) => a.id === saved.divisionAxisId)) {
      return { eventUuid, divisionSource: 'axis', divisionAxisId: saved.divisionAxisId };
    }
  }
  const divisionAxis = axes.find((a) => /division/i.test(a.label));
  if (divisionAxis) return { eventUuid, divisionSource: 'axis', divisionAxisId: divisionAxis.id };
  if (axes.length === 1) return { eventUuid, divisionSource: 'axis', divisionAxisId: axes[0].id };
  if (fleetCount > 1) return { eventUuid, divisionSource: 'fleet' };
  return { eventUuid, divisionSource: 'none' };
}

/** The mapping dialog's counterpart of {@link defaultRrsConfig}: the CSV's
 *  own subdivision columns take precedence, since the sheet being imported is
 *  the best signal for what rrs.org's division should be. A column headed
 *  "Division" wins, then a lone subdivision column; a column bound for a NEW
 *  axis is held by column index until the import mints the axis. */
function defaultMappingRrsConfig(
  eventUuid: string,
  saved: RrsImportConfig | null,
  axes: SubdivisionAxis[],
  fleetCount: number,
  columnMap: ColumnMap,
  headers: string[],
): MappingRrsConfig {
  // An explicit prior choice still wins — re-imports shouldn't flip it.
  if (saved) return defaultRrsConfig(eventUuid, saved, axes, fleetCount);
  const subColumns = Object.entries(columnMap)
    .map(([col, target]) => ({ col: Number(col), target }))
    .filter(({ target }) => isSubdivisionTarget(target));
  const pick =
    subColumns.find(({ col }) => /division/i.test(headers[col] ?? '')) ??
    (subColumns.length === 1 ? subColumns[0] : undefined);
  if (pick) {
    const axisId = subdivisionAxisIdOf(pick.target);
    return axisId
      ? { eventUuid, divisionSource: 'axis', divisionAxisId: axisId }
      : { eventUuid, divisionSource: 'newAxisColumn', divisionColumnIndex: pick.col };
  }
  return defaultRrsConfig(eventUuid, null, axes, fleetCount);
}

/** Map from the CSV import dropdown's rating-field values to the four
 *  rating systems the planner cares about. */
const RATING_FIELD_TO_SYSTEM: Partial<Record<CompetitorField, RatingSystem>> = {
  tcc: 'irc',
  vprsTcc: 'vprs',
  py: 'py',
  nhcStartingTcf: 'nhc',
  echoStartingTcf: 'echo',
};

/** Extract per-row planning data: the parsed fleet column values and the
 *  set of rating systems the row has a (non-blank, finite) value for. */
function extractPlanRows(rows: string[][], columnMap: ColumnMap): PlanRow[] {
  // Pre-index columns by role so we don't iterate the whole map per row.
  let fleetCol = -1;
  const ratingCols: { col: number; system: RatingSystem }[] = [];
  for (const [colStr, field] of Object.entries(columnMap)) {
    const col = parseInt(colStr, 10);
    if (field === 'fleet') fleetCol = col;
    const system = RATING_FIELD_TO_SYSTEM[field as CompetitorField];
    if (system) ratingCols.push({ col, system });
  }
  return rows.map((row) => {
    const fleetCell = fleetCol >= 0 ? (row[fleetCol]?.trim() ?? '') : '';
    const csvFleetNames = parseFleetCell(fleetCell);
    const ratings = new Set<RatingSystem>();
    for (const { col, system } of ratingCols) {
      const raw = row[col]?.trim();
      if (!raw) continue;
      const parsed = parseFloat(raw);
      if (Number.isFinite(parsed)) ratings.add(system);
    }
    return { csvFleetNames, ratings };
  });
}

/**
 * Detect CSV rows that look like sail-number changes of existing
 * competitors, before anything is written. A candidate pairs a row whose
 * sail number matches no existing competitor with a competitor whose sail
 * number appears nowhere in the CSV — the same fleet set and a matching
 * boat or person name (see lib/competitor-matching) make them one boat.
 *
 * Fleet identity comes from the fleet plan: reused fleets contribute their
 * real id, fleets the import would create contribute their plan key. An
 * existing competitor can never be in a not-yet-created fleet, so rows
 * destined only for new fleets simply don't pair — correct, and free.
 */
function detectSailNumberChanges(
  rows: string[][],
  columnMap: ColumnMap,
  existing: Competitor[],
  existingFleets: Fleet[],
  alsoCreateScratch: Record<string, boolean>,
): RenameCandidate[] {
  let sailCol = -1;
  let boatNameCol = -1;
  let primaryCol = -1;
  let helmCol = -1;
  for (const [colStr, field] of Object.entries(columnMap)) {
    const col = parseInt(colStr, 10);
    if (field === 'sailNumber') sailCol = col;
    else if (field === 'boatName') boatNameCol = col;
    else if (field === 'primary') primaryCol = col;
    else if (field === 'helm') helmCol = col;
  }
  if (sailCol < 0) return [];

  const planRows = extractPlanRows(rows, columnMap);
  const plan = planFleetCreation({
    rows: planRows,
    existingFleets,
    existingCompetitors: existing,
    csvHasClassColumn: Object.values(columnMap).includes('boatClass'),
    alsoCreateScratch,
  });
  const fleetIdsByRow: string[][] = rows.map(() => []);
  for (const p of plan.proposed) {
    const fid = p.isExisting && p.existingFleetId ? p.existingFleetId : `new:${p.key}`;
    for (const i of p.rowIndices) {
      if (!fleetIdsByRow[i].includes(fid)) fleetIdsByRow[i].push(fid);
    }
  }
  const fleetKeyOf = (ids: string[]) => [...new Set(ids)].sort().join(',');

  const existingSails = new Set(existing.map((c) => c.sailNumber.toUpperCase()));
  const csvSails = new Set<string>();
  for (const row of rows) {
    const sail = row[sailCol]?.trim().toUpperCase();
    if (sail) csvSails.add(sail);
  }

  const cell = (row: string[], col: number) => (col >= 0 ? (row[col]?.trim() ?? '') : '');
  const newRows: MatchEntry<number>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const sail = cell(rows[i], sailCol).toUpperCase();
    if (!sail || existingSails.has(sail)) continue;
    newRows.push({
      item: i,
      fleetKey: fleetKeyOf(fleetIdsByRow[i]),
      boatName: cell(rows[i], boatNameCol),
      name: cell(rows[i], primaryCol),
      helm: cell(rows[i], helmCol),
    });
  }
  const disappeared: MatchEntry<Competitor>[] = existing
    .filter((c) => !csvSails.has(c.sailNumber.toUpperCase()))
    .map((c) => ({
      item: c,
      fleetKey: fleetKeyOf(c.fleetIds),
      boatName: c.boatName ?? '',
      name: formatPrimaryNames(c.names),
      helm: c.helms?.join(' & ') ?? '',
    }));

  return matchLikelySameBoat(newRows, disappeared)
    .map(({ a: rowIndex, b: competitor, matchedOn }) => ({
      rowIndex,
      newSailNumber: cell(rows[rowIndex], sailCol).toUpperCase(),
      existingId: competitor.id,
      oldSailNumber: competitor.sailNumber,
      boatName: cell(rows[rowIndex], boatNameCol) || competitor.boatName || '',
      personName: cell(rows[rowIndex], primaryCol) || formatPrimaryNames(competitor.names),
      matchedOn,
    }))
    .sort((a, b) => a.rowIndex - b.rowIndex);
}

/** Group ProposedFleet entries by their originating CSV fleet name (insertion order). */
function groupProposedByCsvName(proposed: ProposedFleet[]): [string, ProposedFleet[]][] {
  const groups = new Map<string, ProposedFleet[]>();
  for (const p of proposed) {
    const arr = groups.get(p.csvFleetName);
    if (arr) arr.push(p);
    else groups.set(p.csvFleetName, [p]);
  }
  return [...groups.entries()];
}

/** Display name for a fleet's scoring system in the wizard's plan section. */
const SCORING_SYSTEM_LABEL: Record<ProposedFleet['scoringSystem'], string> = {
  scratch: 'Scratch',
  irc: 'IRC',
  vprs: 'VPRS',
  py: 'PY',
  nhc: 'NHC',
  echo: 'ECHO',
};

// ── Mapping table ───────────────────────────────────────────────────────────

/** Label for the "create a new subdivision axis" option, naming the axis after
 *  the column header so it reads "New axis: 'Age Category'" rather than a
 *  generic string (falls back to generic when the header is blank). */
function newAxisOptionLabel(header: string): string {
  const trimmed = header.trim();
  return trimmed ? `New axis: '${trimmed}'` : 'New subdivision axis';
}

/** One column-mapping row. Memoized so it re-renders only when its own
 *  column value, the sample text, or the (primary-dependent) field labels
 *  change — not for every unrelated wizard state change. */
const MappingRow = memo(function MappingRow({
  header,
  colIndex,
  columnValue,
  sampleCells,
  fieldLabels,
  onChange,
}: {
  header: string;
  colIndex: number;
  columnValue: ColumnTarget;
  sampleCells: string[];
  fieldLabels: Record<string, string>;
  onChange: (index: number, value: ColumnTarget) => void;
}) {
  // A crew-mapped column previews the in-cell split ("Alice + Bob") so the
  // scorer sees what will be stored before confirming.
  const sampleText =
    (columnValue === 'crewName'
      ? sampleCells.map((c) => splitCrewCell(c).join(' + '))
      : sampleCells
    ).join(', ') || '—';
  return (
    <TableRow>
      <TableCell className="font-mono text-sm truncate">{header || `Column ${colIndex + 1}`}</TableCell>
      <TableCell>
        <Select
          value={columnValue}
          onValueChange={(v) => onChange(colIndex, v as ColumnTarget)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(fieldLabels) as ColumnTarget[]).map((field) => (
              <SelectItem key={field} value={field}>
                {field === NEW_AXIS_TARGET ? newAxisOptionLabel(header) : fieldLabels[field]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground truncate">
        {sampleText}
      </TableCell>
    </TableRow>
  );
});

/** The column-mapping table. Memoized so primary-radio / optional-field /
 *  also-scratch toggles — which don't touch `columnMap`, `fieldLabels`, or
 *  `onChange` — skip re-rendering the whole table (and its ~14 SelectItems
 *  per row). */
const MappingTable = memo(function MappingTable({
  headers,
  columnMap,
  sampleCells,
  fieldLabels,
  onChange,
}: {
  headers: string[];
  columnMap: ColumnMap;
  sampleCells: string[][];
  fieldLabels: Record<string, string>;
  onChange: (index: number, value: ColumnTarget) => void;
}) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/5">Column</TableHead>
          <TableHead className="w-1/5">Map to</TableHead>
          <TableHead className="w-3/5">Sample values</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {headers.map((header, i) => (
          <MappingRow
            key={i}
            header={header}
            colIndex={i}
            columnValue={columnMap[i]}
            sampleCells={sampleCells[i]}
            fieldLabels={fieldLabels}
            onChange={onChange}
          />
        ))}
      </TableBody>
    </Table>
  );
});

/** What feeds rrs.org's single `division` slot — the one real push-mapping
 *  choice. Encoded flat for the Select ('none' | 'fleet' | 'axis:<id>' |
 *  'newcol:<index>'). `newAxisColumns` lists CSV columns currently bound for
 *  a new subdivision axis (mapping dialog only) — choosable by column since
 *  their axis ids don't exist until the import runs. */
function DivisionSourceSelect({
  divisionSource,
  divisionAxisId,
  divisionColumnIndex,
  axes,
  newAxisColumns,
  onChange,
}: {
  divisionSource: MappingRrsConfig['divisionSource'];
  divisionAxisId?: string;
  divisionColumnIndex?: number;
  axes: SubdivisionAxis[];
  newAxisColumns?: { col: number; header: string }[];
  onChange: (choice: Pick<MappingRrsConfig, 'divisionSource' | 'divisionAxisId' | 'divisionColumnIndex'>) => void;
}) {
  const value =
    divisionSource === 'axis' && divisionAxisId ? `axis:${divisionAxisId}`
    : divisionSource === 'newAxisColumn' && divisionColumnIndex != null ? `newcol:${divisionColumnIndex}`
    : divisionSource;
  return (
    <label className="flex items-center gap-2 text-sm">
      Division on rrs.org:
      <Select
        value={value}
        onValueChange={(v) => {
          if (v.startsWith('newcol:')) {
            onChange({ divisionSource: 'newAxisColumn', divisionColumnIndex: Number(v.slice('newcol:'.length)) });
            return;
          }
          const axisId = subdivisionAxisIdOf(v as ColumnTarget);
          if (axisId) onChange({ divisionSource: 'axis', divisionAxisId: axisId });
          else onChange({ divisionSource: v as 'none' | 'fleet' });
        }}
      >
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">(none)</SelectItem>
          <SelectItem value="fleet">Fleet name</SelectItem>
          {axes.map((a) => (
            <SelectItem key={a.id} value={axisColumnTarget(a.id)}>
              {a.label.trim() || DEFAULT_SUBDIVISION_LABEL}
            </SelectItem>
          ))}
          {(newAxisColumns ?? []).map(({ col, header }) => (
            <SelectItem key={col} value={`newcol:${col}`}>
              {newAxisOptionLabel(header)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** The mapping dialog's body: series-level proposals, the fleet plan
 *  summary, and the column-mapping table. Lifted out of the inline IIFE
 *  it used to live in so it can host the hooks that stabilize the props
 *  passed down to `<MappingTable>`. */
function MappingDialogBody({
  flow,
  setFlow,
  fleets,
}: {
  flow: MappingFlow;
  setFlow: React.Dispatch<React.SetStateAction<ImportFlow>>;
  fleets: Fleet[];
}) {
  const fieldLabels = useMemo(
    () => buildFieldLabels(flow.proposedPrimary, flow.subdivisionAxes, flow.rrs !== null),
    [flow.proposedPrimary, flow.subdivisionAxes, flow.rrs],
  );
  const targets = Object.values(flow.columnMap);
  const primaryCount = targets.filter((t) => t === 'primary').length;
  const sailCount = targets.filter((t) => t === 'sailNumber').length;
  const hasPrimary = primaryCount >= 1;
  const hasSail = sailCount >= 1;
  const tooManyPrimaries = primaryCount > 1;
  const tooManySails = sailCount > 1;

  const updateColumn = useCallback((index: number, value: ColumnTarget) => {
    setFlow((f) => {
      if (f.step !== 'mapping') return f;
      // If this column was feeding rrs.org's division as a new axis and is
      // remapped to anything else, the choice dangles — reset it rather than
      // silently resolve to nothing at import time.
      const rrs =
        f.rrs?.divisionSource === 'newAxisColumn' &&
        f.rrs.divisionColumnIndex === index &&
        value !== NEW_AXIS_TARGET
          ? { eventUuid: f.rrs.eventUuid, divisionSource: 'none' as const }
          : f.rrs;
      return { ...f, columnMap: { ...f.columnMap, [index]: value }, rrs };
    });
  }, [setFlow]);

  const updatePrimary = useCallback((label: PrimaryPersonLabel) => {
    setFlow((f) => {
      if (f.step !== 'mapping') return f;
      const nextMap = reconcileColumnMap(f.columnMap, label);
      // Drop optional additions that are disabled by the new primary.
      const nextProposedFields = f.proposedFields.filter(
        (field) => !isFieldDisabledByPrimary(field, label),
      );
      return { ...f, proposedPrimary: label, columnMap: nextMap, proposedFields: nextProposedFields };
    });
  }, [setFlow]);

  const toggleField = useCallback((field: CompetitorFieldKey, checked: boolean) => {
    setFlow((f) => {
      if (f.step !== 'mapping') return f;
      const set = new Set(f.proposedFields);
      if (checked) set.add(field); else set.delete(field);
      const nextArray = ALL_COMPETITOR_FIELDS.filter((ff) => set.has(ff));
      return { ...f, proposedFields: nextArray };
    });
  }, [setFlow]);

  const toggleAlsoScratch = useCallback((csvFleetName: string, checked: boolean) => {
    setFlow((f) => {
      if (f.step !== 'mapping') return f;
      const next = { ...f.alsoCreateScratch };
      if (checked) next[csvFleetName] = true;
      else delete next[csvFleetName];
      return { ...f, alsoCreateScratch: next };
    });
  }, [setFlow]);

  const primaryChanged = flow.proposedPrimary !== flow.currentPrimary;
  const fieldAdditions = flow.proposedFields.filter((f) => !flow.currentFields.includes(f));
  const fieldRemovals = flow.currentFields.filter((f) => !flow.proposedFields.includes(f));

  // Recompute the plan on every render — it's cheap and depends on
  // column mappings + the also-scratch toggle, both of which the
  // user edits inside this dialog.
  const planRows = extractPlanRows(flow.rows, flow.columnMap);
  const csvHasClassColumn = Object.values(flow.columnMap).includes('boatClass');
  const livePlan = planFleetCreation({
    rows: planRows,
    existingFleets: fleets,
    existingCompetitors: flow.existingHasBoatClass ? [{ boatClass: 'x' }] : [],
    csvHasClassColumn,
    alsoCreateScratch: flow.alsoCreateScratch,
  });
  const planGroups = groupProposedByCsvName(livePlan.proposed);

  // Pre-slice each column's sample values once — headers and sampleRows are
  // fixed for the import session, so this never recomputes after mount. Rows
  // join them for display (crew-mapped columns preview their in-cell split).
  const sampleCells = useMemo(
    () => flow.headers.map((_, i) =>
      flow.sampleRows
        .map((row) => row[i]?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 3),
    ),
    [flow.headers, flow.sampleRows],
  );

  return (
    <div className="space-y-4 overflow-y-auto max-h-[60vh]">
      {/* Series-level proposals */}
      <div className="rounded-md border p-3 space-y-3 bg-muted/30">
        <div className="space-y-1">
          <p className="text-sm font-medium">Primary identifier</p>
          <p className="text-xs text-muted-foreground">
            The required name column for every competitor. Used as the primary
            column heading throughout results.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {PRIMARY_PERSON_LABELS.map((label) => (
              <label key={label} className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="importPrimary"
                  value={label}
                  checked={flow.proposedPrimary === label}
                  onChange={() => updatePrimary(label)}
                  className="h-3.5 w-3.5"
                />
                {PRIMARY_PERSON_LABEL_TEXT[label]}
                {label === flow.currentPrimary && (
                  <span className="text-xs text-muted-foreground">(current)</span>
                )}
              </label>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Optional fields to show</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            {ALL_COMPETITOR_FIELDS.map((field) => {
              const disabled = isFieldDisabledByPrimary(field, flow.proposedPrimary);
              return (
                <label
                  key={field}
                  className={`flex items-center gap-1.5 text-sm ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={flow.proposedFields.includes(field) && !disabled}
                    disabled={disabled}
                    onChange={(e) => toggleField(field, e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  {COMPETITOR_FIELD_LABELS[field]}
                </label>
              );
            })}
          </div>
        </div>
        {(primaryChanged || fieldAdditions.length > 0 || fieldRemovals.length > 0) && (
          <div className="text-xs text-muted-foreground space-y-0.5 border-t pt-2">
            {primaryChanged && (
              <p>
                Primary identifier: <span className="font-medium">{PRIMARY_PERSON_LABEL_TEXT[flow.currentPrimary]}</span>
                {' → '}
                <span className="font-medium">{PRIMARY_PERSON_LABEL_TEXT[flow.proposedPrimary]}</span>
              </p>
            )}
            {fieldAdditions.length > 0 && (
              <p>
                Enabling optional fields: {fieldAdditions.map((f) => COMPETITOR_FIELD_LABELS[f]).join(', ')}
              </p>
            )}
            {fieldRemovals.length > 0 && (
              <p>
                Disabling optional fields: {fieldRemovals.map((f) => COMPETITOR_FIELD_LABELS[f]).join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Fleets to create / reuse */}
      {planGroups.length > 0 && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <p className="text-sm font-medium">Fleets</p>
          <div className="space-y-2">
            {planGroups.map(([csvName, group]) => {
              // Show the also-scratch toggle only for groups where
              // at least one rating system was inferred (non-scratch).
              const hasRatingFleet = group.some((p) => p.scoringSystem !== 'scratch');
              return (
                <div key={csvName} className="space-y-0.5">
                  <p className="text-xs font-mono text-muted-foreground">
                    {csvName}
                  </p>
                  <ul className="text-sm pl-3 space-y-0.5">
                    {group.map((p) => (
                      <li key={p.key} className="flex items-baseline gap-2">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {SCORING_SYSTEM_LABEL[p.scoringSystem]}
                          {' · '}
                          {p.rowIndices.length} {p.rowIndices.length === 1 ? 'boat' : 'boats'}
                          {p.isExisting && ' · existing'}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {hasRatingFleet && (
                    <label className="flex items-center gap-1.5 text-xs pl-3 pt-0.5 cursor-pointer text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={flow.alsoCreateScratch[csvName] === true}
                        onChange={(e) => toggleAlsoScratch(csvName, e.target.checked)}
                        className="h-3.5 w-3.5"
                      />
                      Also score {csvName} on scratch (line honours)
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {livePlan.shouldFillBoatClassFromFleetName && (
            <p className="text-xs text-muted-foreground border-t pt-2">
              No Class column detected — the original fleet name will be saved
              as each boat&rsquo;s class so the grouping isn&rsquo;t lost when
              boats are split into rating fleets.
            </p>
          )}
        </div>
      )}

      <MappingTable
        headers={flow.headers}
        columnMap={flow.columnMap}
        sampleCells={sampleCells}
        fieldLabels={fieldLabels}
        onChange={updateColumn}
      />

      {/* The rrs.org side of a combined import: the one push-mapping choice
          (division source) plus the relay contract, stated where the relay
          columns are mapped. */}
      {flow.rrs && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <p className="text-sm font-medium">Push to rrs.org</p>
          <DivisionSourceSelect
            divisionSource={flow.rrs.divisionSource}
            divisionAxisId={flow.rrs.divisionAxisId}
            divisionColumnIndex={flow.rrs.divisionColumnIndex}
            axes={flow.subdivisionAxes}
            newAxisColumns={flow.headers
              .map((header, col) => ({ col, header }))
              .filter(({ col }) => flow.columnMap[col] === NEW_AXIS_TARGET)}
            onChange={(choice) =>
              setFlow((f) =>
                f.step === 'mapping' && f.rrs
                  ? { ...f, rrs: { eventUuid: f.rrs.eventUuid, ...choice } }
                  : f,
              )
            }
          />
          <p className="text-xs text-muted-foreground">
            Email, phone and MNA columns are sent to rrs.org only — Sail
            Scoring does not store them. Owner and crew names are not sent;
            rrs.org has no fields for them.
          </p>
        </div>
      )}

      {(!hasSail || !hasPrimary || tooManyPrimaries || tooManySails) && (
        <div className="text-xs text-destructive space-y-0.5">
          {!hasSail && <p>Map one column to Sail number.</p>}
          {tooManySails && <p>Only one column may be Sail number.</p>}
          {!hasPrimary && <p>Map one column to {PRIMARY_PERSON_LABEL_TEXT[flow.proposedPrimary]} name (primary).</p>}
          {tooManyPrimaries && <p>Only one column may be the primary name.</p>}
        </div>
      )}
    </div>
  );
}

/** The push-only confirm body: the one mapping choice (division source), the
 *  fixed field mapping stated rather than asked, and a preview of the first
 *  rows exactly as they will be sent — where a wrong division choice or an
 *  unexpected blank is caught before pushing. */
function PushConfirmBody({
  flow,
  setFlow,
}: {
  flow: Extract<ImportFlow, { step: 'pushConfirm' }>;
  setFlow: React.Dispatch<React.SetStateAction<ImportFlow>>;
}) {
  const preview = useMemo(
    () => buildRrsOrgCompetitors(flow.competitors.slice(0, 3), flow.fleets, flow.config).competitors,
    [flow.competitors, flow.fleets, flow.config],
  );
  return (
    <div className="space-y-4 overflow-y-auto max-h-[60vh]">
      <p className="text-sm">
        Event UUID <code className="text-xs">{flow.config.eventUuid}</code>
      </p>
      <DivisionSourceSelect
        divisionSource={flow.config.divisionSource}
        divisionAxisId={flow.config.divisionAxisId}
        axes={flow.axes}
        onChange={(choice) =>
          setFlow((f) =>
            f.step === 'pushConfirm' && choice.divisionSource !== 'newAxisColumn'
              ? {
                  ...f,
                  config: {
                    eventUuid: f.config.eventUuid,
                    divisionSource: choice.divisionSource,
                    divisionAxisId: choice.divisionAxisId,
                  },
                }
              : f,
          )
        }
      />
      {flow.competitors.length > 0 && (
        <div className="rounded-md border p-3 space-y-1 bg-muted/30">
          <p className="text-sm font-medium">
            Preview (first {preview.length} of {flow.competitors.length})
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sail no.</TableHead>
                <TableHead>Nat</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Boat</TableHead>
                <TableHead>Division</TableHead>
                <TableHead>Club</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row) => (
                <TableRow key={row.competitor_id}>
                  <TableCell className="text-sm">{row.sail_number}</TableCell>
                  <TableCell className="text-sm">{row.country_code || '—'}</TableCell>
                  <TableCell className="text-sm">{[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell className="text-sm">{row.boat_name || '—'}</TableCell>
                  <TableCell className="text-sm">{row.division || '—'}</TableCell>
                  <TableCell className="text-sm">{row.club_name || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {flow.competitors.length === 0 && (
        <p className="text-sm text-muted-foreground">
          This series has no competitors to push yet.
        </p>
      )}
      <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
        <li>
          Email, phone and MNA membership numbers will be blank — Sail Scoring
          does not store contact details. To include them, import from a CSV
          that has them and tick both options in the Import dialog.
        </li>
        <li>Owner and crew names are not sent; rrs.org has no fields for them.</li>
        <li>
          Pushing replaces <span className="font-medium">all</span> competitors
          previously imported into the rrs.org event via its API. Competitors
          entered manually on rrs.org are kept.
        </li>
      </ul>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export interface CompetitorImportHandle {
  /** Programmatically open the import — the choice dialog when the rrs-import
   *  feature applies, otherwise the file picker directly. */
  trigger: () => void;
}

/**
 * Reusable competitor import component. Shows a trigger, a column-mapping
 * dialog, and a completion dialog. With the `rrs-import` feature on (and not
 * `csvOnly`), the trigger opens a choice dialog first — import from CSV
 * and/or push to rrs.org, independently combinable — instead of jumping
 * straight to the file picker.
 *
 * @param seriesId - The series to import into
 * @param fleets - Current fleets (for tracking new fleet creation)
 * @param onComplete - Called after import completes (with results) or is dismissed
 * @param trigger - Optional custom trigger element. If omitted, renders a default button.
 * @param csvOnly - Keep the plain CSV flow even when rrs-import is on (the new-series setup wizard).
 */
export const CompetitorImport = forwardRef<CompetitorImportHandle, {
  seriesId: string;
  fleets: Fleet[];
  onComplete?: (result: ImportResult | null) => void;
  trigger?: React.ReactNode;
  csvOnly?: boolean;
}>(function CompetitorImport({ seriesId, fleets, onComplete, trigger, csvOnly }, ref) {
  const updateSeries = useUpdateSeries();
  const saveFleets = useSaveFleets();
  const saveCompetitors = useSaveCompetitors();
  const { has } = useFeatures();
  const rrsEnabled = has('rrs-import') && !csvOnly;
  const [importFlow, setImportFlow] = useState<ImportFlow>({ step: 'idle' });
  const csvInputRef = useRef<HTMLInputElement>(null);

  async function openImport() {
    if (!rrsEnabled) {
      csvInputRef.current?.click();
      return;
    }
    const series = await seriesRepo.get(seriesId);
    const saved = series?.rrsOrgPush ?? null;
    setImportFlow({
      step: 'choose',
      csvChecked: true,
      rrsChecked: false,
      eventUuid: saved?.eventUuid ?? '',
      file: null,
      savedConfig: saved,
    });
  }

  useImperativeHandle(ref, () => ({
    trigger: () => void openImport(),
  }));

  function resetImport() {
    const result = importFlow.step === 'done' && importFlow.csv ? {
      added: importFlow.csv.added,
      updated: importFlow.csv.updated,
      unchanged: importFlow.csv.unchanged,
      fleetsCreated: importFlow.csv.fleetsCreated,
      errors: importFlow.csv.errors,
    } : null;
    setImportFlow({ step: 'idle' });
    if (csvInputRef.current) csvInputRef.current.value = '';
    onComplete?.(result);
  }

  function handleCsvFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // From the choice dialog, just hold the file — parsing waits for
    // Continue, when we know whether an rrs.org push rides along.
    if (importFlow.step === 'choose') {
      setImportFlow({ ...importFlow, csvChecked: true, file });
      e.target.value = '';
      return;
    }
    void parseImportFile(file, null);
    e.target.value = '';
  }

  /** Parse the chosen file (CSV or .xlsx) and open the mapping step — via
   *  the sheet picker when a workbook has several sheets with data. `rrs`
   *  is set when the import also pushes to rrs.org; the division source
   *  defaults from the saved settings once the series' axes are known. */
  async function parseImportFile(file: File, rrs: { eventUuid: string; saved: RrsImportConfig | null } | null) {
    const parsed = await parseTabularFile(file);
    if (parsed.kind === 'error') {
      setImportFlow({ step: 'fileError', message: parsed.message });
    } else if (parsed.kind === 'workbook') {
      setImportFlow({ step: 'pickSheet', sheets: parsed.sheets, rrs });
    } else {
      await openMappingFromRows(parsed.rows, rrs);
    }
  }

  /** Build and enter the mapping step from parsed rows (header row first). */
  async function openMappingFromRows(allRows: string[][], rrs: { eventUuid: string; saved: RrsImportConfig | null } | null) {
    if (allRows.length < 2) return;
    const headers = allRows[0];
    const dataRows = allRows.slice(1);
    const sampleRows = dataRows.slice(0, 3);

    const series = await seriesRepo.get(seriesId);
    const axes = series ? subdivisionAxes(series) : [];
    const axisLabels = axes.map((a) => a.label);
    // Translate a detected subdivision column onto a concrete axis target:
    // the best-matching configured axis, else a new axis from the header.
    const initialMap: ColumnMap = {};
    headers.forEach((h, i) => {
      // Relay-only columns (email/phone/MNA) exist only when the import
      // also pushes to rrs.org; without a push those headers keep their
      // plain detection (normally ignore) and the flow is unchanged.
      if (rrs) {
        const relayField = autoDetectRelayField(h);
        if (relayField) {
          initialMap[i] = relayColumnTarget(relayField);
          return;
        }
      }
      const detected = autoDetectField(h);
      if (detected === 'subdivision') {
        const matchIdx = matchSubdivisionAxis(h, axisLabels);
        initialMap[i] = matchIdx != null ? axisColumnTarget(axes[matchIdx].id) : NEW_AXIS_TARGET;
      } else {
        initialMap[i] = detected;
      }
    });

    const existingCompetitors = await competitorRepo.listBySeries(seriesId);
    const firstImport = existingCompetitors.length === 0;
    const currentPrimary = series?.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
    const currentFields = series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
    const seriesScoringMode = series?.scoringMode ?? 'scratch';
    const existingHasBoatClass = existingCompetitors.some((c) => !!c.boatClass);

    // Propose a primary label. The CSV drives the choice on the first
    // import, and also on later imports when the series is still on the
    // default generic primary (the scorer hasn't committed to a role yet).
    // Once the scorer has explicitly picked a role-primary or switched to
    // 'entrant', we respect it and only offer additive field proposals.
    const canProposePrimary = firstImport || currentPrimary === DEFAULT_PRIMARY_PERSON_LABEL;
    const proposedPrimary = canProposePrimary
      ? proposePrimaryLabel(initialMap, currentPrimary)
      : currentPrimary;
    const columnMap = reconcileColumnMap(initialMap, proposedPrimary);

    // Propose additive enable for any optional field a CSV column targets.
    const targets = new Set(Object.values(columnMap));
    const hasSubdivisionColumn = Object.values(columnMap).some(isSubdivisionTarget);
    const optionalAdditions: CompetitorFieldKey[] = [];
    for (const field of ALL_COMPETITOR_FIELDS) {
      if (isFieldDisabledByPrimary(field, proposedPrimary)) continue;
      if (currentFields.includes(field)) continue;
      // The subdivision field is driven by axis-target columns; every other
      // optional field maps 1:1 to a dropdown value of the same name.
      const enabled = field === 'subdivision' ? hasSubdivisionColumn : targets.has(field);
      if (enabled) optionalAdditions.push(field);
    }
    const proposedFields = [...currentFields, ...optionalAdditions];

    setImportFlow({
      step: 'mapping',
      headers,
      sampleRows,
      rows: dataRows,
      columnMap,
      firstImport,
      currentPrimary,
      proposedPrimary,
      currentFields,
      proposedFields,
      subdivisionAxes: axes,
      seriesScoringMode,
      existingHasBoatClass,
      alsoCreateScratch: {},
      rrs: rrs
        ? defaultMappingRrsConfig(rrs.eventUuid, rrs.saved, axes, fleets.length, columnMap, headers)
        : null,
    });
  }

  /** Mapping-dialog confirm: look for suspected sail-number changes first.
   *  Any found → the review step; none → straight into the import. */
  async function handleImport() {
    if (importFlow.step !== 'mapping') return;
    const existing = await competitorRepo.listBySeries(seriesId);
    const candidates = detectSailNumberChanges(
      importFlow.rows,
      importFlow.columnMap,
      existing,
      fleets,
      importFlow.alsoCreateScratch,
    );
    if (candidates.length > 0) {
      setImportFlow({
        step: 'renames',
        mapping: importFlow,
        candidates,
        accepted: candidates.map(() => true),
      });
      return;
    }
    await executeImport(importFlow, new Map());
  }

  /** Renames-dialog confirm: run the import with the accepted pairs. */
  async function confirmRenames() {
    if (importFlow.step !== 'renames') return;
    const renames = new Map<number, string>();
    importFlow.candidates.forEach((c, i) => {
      if (importFlow.accepted[i]) renames.set(c.rowIndex, c.existingId);
    });
    await executeImport(importFlow.mapping, renames);
  }

  /** The import proper. `renameByRowIndex` maps a CSV row index to the id
   *  of the existing competitor it renames — consulted only for rows whose
   *  sail number matched nothing, so an accepted rename updates that
   *  competitor in place (keeping its id, and with it its results). */
  async function executeImport(flow: MappingFlow, renameByRowIndex: Map<number, string>) {
    const { rows, headers, columnMap, proposedPrimary, proposedFields, currentPrimary, currentFields, seriesScoringMode, existingHasBoatClass, alsoCreateScratch, rrs } = flow;

    const existing = await competitorRepo.listBySeries(seriesId);
    const existingById = new Map(existing.map((c) => [c.id, c]));
    const series = await seriesRepo.get(seriesId);
    const bysail = new Map<string, Competitor[]>();
    for (const c of existing) {
      const key = c.sailNumber.toUpperCase();
      const arr = bysail.get(key);
      if (arr) arr.push(c);
      else bysail.set(key, [c]);
    }

    // Plan fleet creation: decide which fleets to create (or reuse) and
    // which CSV rows belong in each. Materialize the plan up-front so the
    // row loop just looks up fleet IDs by row index.
    const planRows = extractPlanRows(rows, columnMap);
    const csvHasClassColumn = Object.values(columnMap).includes('boatClass');
    const plan = planFleetCreation({
      rows: planRows,
      existingFleets: fleets,
      existingCompetitors: existing,
      csvHasClassColumn,
      alsoCreateScratch,
    });

    // Persist series-level proposals (primary label, additively-enabled
    // fields, and — if the plan produced handicap fleets — flipping the
    // series to handicap mode) before touching competitors so downstream
    // UI reads the correct config.
    // Resolve each subdivision-mapped column to a concrete axis id: an existing
    // axis, or a fresh one minted (once) from the column header for a `newaxis`
    // target. `axisIdByColumn` then routes each row's cell into the right axis.
    const existingAxes = series ? subdivisionAxes(series) : [];
    const newAxes: SubdivisionAxis[] = [];
    const axisIdByColumn = new Map<number, string>();
    for (const [colStr, target] of Object.entries(columnMap)) {
      const col = Number(colStr);
      const existingId = subdivisionAxisIdOf(target);
      if (existingId) {
        axisIdByColumn.set(col, existingId);
      } else if (target === NEW_AXIS_TARGET) {
        const label = (headers[col] ?? '').trim() || DEFAULT_SUBDIVISION_LABEL;
        const axis = newSubdivisionAxis(label);
        newAxes.push(axis);
        axisIdByColumn.set(col, axis.id);
      }
    }

    const seriesPatch: {
      primaryPersonLabel?: PrimaryPersonLabel;
      scoringMode?: 'scratch' | 'handicap';
      subdivisionAxes?: SubdivisionAxis[];
      lastModifiedAt?: number;
    } = {};
    if (proposedPrimary !== currentPrimary) seriesPatch.primaryPersonLabel = proposedPrimary;
    if (newAxes.length > 0) seriesPatch.subdivisionAxes = [...existingAxes, ...newAxes];
    // The wizard's field intent is the delta against the snapshot it opened
    // with; re-apply that delta to the row the save lands on, so a field
    // toggled elsewhere while the wizard was open isn't silently reverted.
    const fieldAdditions = proposedFields.filter((f) => !currentFields.includes(f));
    const fieldRemovals = currentFields.filter((f) => !proposedFields.includes(f));
    const fieldsChanged = fieldAdditions.length > 0 || fieldRemovals.length > 0;
    const planHasHandicapFleet = plan.proposed.some((p) => p.scoringSystem !== 'scratch');
    if (seriesScoringMode === 'scratch' && planHasHandicapFleet) {
      seriesPatch.scoringMode = 'handicap';
    }
    if (Object.keys(seriesPatch).length > 0 || fieldsChanged) {
      seriesPatch.lastModifiedAt = Date.now();
      await updateSeries.mutateAsync({
        id: seriesId,
        patch: (current) => {
          if (!fieldsChanged) return seriesPatch;
          const fields = new Set(current.enabledCompetitorFields ?? defaultEnabledCompetitorFields());
          for (const f of fieldAdditions) fields.add(f);
          for (const f of fieldRemovals) fields.delete(f);
          return {
            ...seriesPatch,
            enabledCompetitorFields: ALL_COMPETITOR_FIELDS.filter((f) => fields.has(f)),
          };
        },
      });
    }

    const fleetIdByPlanKey = new Map<string, string>();
    const newFleetNames: string[] = [];
    const fleetsToCreate: Fleet[] = [];
    let nextDisplayOrder = fleets.reduce(
      (max, f) => Math.max(max, f.displayOrder),
      -1,
    ) + 1;
    for (const p of plan.proposed) {
      if (p.isExisting && p.existingFleetId) {
        fleetIdByPlanKey.set(p.key, p.existingFleetId);
      } else {
        const id = crypto.randomUUID();
        fleetIdByPlanKey.set(p.key, id);
        fleetsToCreate.push({
          id,
          seriesId,
          name: p.name,
          displayOrder: nextDisplayOrder++,
          scoringSystem: p.scoringSystem,
        });
        newFleetNames.push(p.name);
      }
    }
    if (fleetsToCreate.length > 0) {
      // Phase 7 audit: authoritative-by-construction. `fleetsToCreate`
      // is the new-fleet branch only — each id was freshly minted above
      // (`crypto.randomUUID()`); existing fleets are looked up and their
      // ids reused without going through this code path.
      await saveFleets.mutateAsync(fleetsToCreate);
    }
    // Per-row resolved fleet IDs (deduped, preserving insertion order).
    const fleetIdsByRow: string[][] = rows.map(() => []);
    for (const p of plan.proposed) {
      const fid = fleetIdByPlanKey.get(p.key);
      if (!fid) continue;
      for (const i of p.rowIndices) {
        if (!fleetIdsByRow[i].includes(fid)) fleetIdsByRow[i].push(fid);
      }
    }

    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: { rowIndex: number; reason: string }[] = [];
    const competitorsToSave: Competitor[] = [];
    // Relay-only contact/membership cells, keyed by the competitor id each
    // row lands on — handed to the rrs.org push and then dropped, never saved.
    const relayByCompetitorId = new Map<string, RrsOrgRelayFields>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      let sailNumber = '';
      let bowNumber = '';
      let boatName = '';
      let boatClass = '';
      let primaryName = '';
      let helmRole = '';
      let ownerRole = '';
      const crewCells: string[] = [];  // every column mapped to Crew, in column order
      let club = '';
      let nationality = '';
      let gender = '';
      let age = '';
      const subdivisionCells: Record<string, string> = {};
      let fleet = '';
      let tcc = '';
      let vprsTccStr = '';
      let py = '';
      let nhcStartingTcfStr = '';
      let echoStartingTcfStr = '';
      const relay: RrsOrgRelayFields = {};
      Object.entries(columnMap).forEach(([colStr, field]) => {
        const col = parseInt(colStr, 10);
        const val = row[col]?.trim() ?? '';
        if (field === 'sailNumber') sailNumber = val;
        else if (field === 'bowNumber') bowNumber = val;
        else if (field === 'boatName') boatName = val;
        else if (field === 'boatClass') boatClass = val;
        else if (field === 'primary') primaryName = val;
        else if (field === 'helm') helmRole = val;
        else if (field === 'owner') ownerRole = val;
        else if (field === 'crewName') { if (val) crewCells.push(val); }
        else if (field === 'club') club = val;
        else if (field === 'nationality') nationality = val;
        else if (field === 'gender') gender = val;
        else if (field === 'age') age = val;
        else if (field === 'fleet') fleet = val;
        else if (field === 'tcc') tcc = val;
        else if (field === 'vprsTcc') vprsTccStr = val;
        else if (field === 'py') py = val;
        else if (field === 'nhcStartingTcf') nhcStartingTcfStr = val;
        else if (field === 'echoStartingTcf') echoStartingTcfStr = val;
        else {
          const relayField = relayFieldOf(field);
          if (relayField) {
            if (val) relay[relayField] = val;
          } else {
            const axisId = axisIdByColumn.get(col);
            if (axisId && val) subdivisionCells[axisId] = val;
          }
        }
      });

      if (!sailNumber) {
        errors.push({ rowIndex: rowNumber, reason: 'missing sail number' });
        continue;
      }

      const normSail = sailNumber.toUpperCase();
      const parsedAge = age ? parseInt(age, 10) : null;
      const normGender = gender.toUpperCase();

      const fleetIds = fleetIdsByRow[i];

      const sailCandidates = bysail.get(normSail) ?? [];
      let existingCompetitor: Competitor | null = sailCandidates.length <= 1
        ? sailCandidates[0] ?? null
        : sailCandidates.find((c) => sameFleetIdSet(c.fleetIds, fleetIds)) ?? sailCandidates[0];
      if (!existingCompetitor) {
        // No sail-number match — an accepted sail-number change claims the
        // row for its existing competitor instead of minting a new one.
        const renameId = renameByRowIndex.get(i);
        existingCompetitor = renameId ? existingById.get(renameId) ?? null : null;
      }

      const parsedTcc = tcc ? parseFloat(tcc) : null;
      const parsedVprs = vprsTccStr ? parseFloat(vprsTccStr) : null;
      const parsedPy = py ? parseInt(py, 10) : null;
      const parsedNhc = nhcStartingTcfStr ? parseFloat(nhcStartingTcfStr) : null;
      const parsedEcho = echoStartingTcfStr ? parseFloat(echoStartingTcfStr) : null;
      const ircTcc = parsedTcc != null && !isNaN(parsedTcc) ? parsedTcc : existingCompetitor?.ircTcc;
      const vprsTcc = parsedVprs != null && !isNaN(parsedVprs) ? parsedVprs : existingCompetitor?.vprsTcc;
      const pyNumber = parsedPy != null && !isNaN(parsedPy) ? parsedPy : existingCompetitor?.pyNumber;
      const nhcStartingTcf = parsedNhc != null && !isNaN(parsedNhc) ? parsedNhc : existingCompetitor?.nhcStartingTcf;
      const echoStartingTcf = parsedEcho != null && !isNaN(parsedEcho) ? parsedEcho : existingCompetitor?.echoStartingTcf;

      // Nationality: uppercase, resolve Sailwave-style aliases (BVI → IVB),
      // then accept iff the result is the validation-layer's 3-letter shape.
      // Unknown but well-formed codes are kept verbatim so the importer is
      // forward-compatible with future national-letters dataset bumps; the
      // renderer falls back to code-only when no flag is available.
      const normNationality = nationality ? normalizeCodeInput(nationality) : '';
      const resolvedNationality = normNationality
        ? (lookupAlias(normNationality)?.canonical ?? normNationality)
        : '';
      const cleanNationality = /^[A-Z]{3}$/.test(resolvedNationality)
        ? resolvedNationality
        : (existingCompetitor?.nationality ?? '');

      const resolvedBowNumber = bowNumber || existingCompetitor?.bowNumber || '';
      const resolvedBoatName = boatName || existingCompetitor?.boatName || '';
      // boatClass fallback: when neither the CSV nor any existing competitor
      // provides a boatClass, fall back to the original CSV fleet name so
      // grouping like "Cruisers 2" survives even when split into rating fleets.
      const fleetNameFallback = plan.shouldFillBoatClassFromFleetName
        ? (planRows[i].csvFleetNames[0]?.trim() || DEFAULT_FLEET_NAME)
        : '';
      const resolvedBoatClass = boatClass || existingCompetitor?.boatClass || fleetNameFallback || '';
      // A row with any mapped crew replaces the whole list; a row with none
      // keeps the existing list (the same fallback the other fields have).
      const csvCrew = crewCells.flatMap(splitCrewCell);
      const resolvedCrewNames = csvCrew.length ? csvCrew : existingCompetitor?.crewNames ?? [];
      const resolvedHelms = helmRole.trim() ? [helmRole.trim()] : existingCompetitor?.helms ?? [];
      const resolvedOwners = ownerRole.trim() ? [ownerRole.trim()] : existingCompetitor?.owners ?? [];
      // Merge the mapped columns onto their axes, preserving any other axis
      // values the existing competitor already holds.
      const resolvedSubdivisions = cleanSubdivisions({
        ...(existingCompetitor?.subdivisions ?? {}),
        ...subdivisionCells,
      });
      const competitor: Competitor = {
        id: existingCompetitor?.id ?? crypto.randomUUID(),
        seriesId,
        fleetIds,
        sailNumber: normSail,
        ...(resolvedBowNumber ? { bowNumber: resolvedBowNumber } : {}),
        ...(resolvedBoatName ? { boatName: resolvedBoatName } : {}),
        ...(resolvedBoatClass ? { boatClass: resolvedBoatClass } : {}),
        names: primaryName.trim() ? [primaryName.trim()] : existingCompetitor?.names ?? [''],
        ...(resolvedHelms.length ? { helms: resolvedHelms } : {}),
        ...(resolvedOwners.length ? { owners: resolvedOwners } : {}),
        ...(resolvedCrewNames.length ? { crewNames: resolvedCrewNames } : {}),
        club: club || existingCompetitor?.club || '',
        ...(cleanNationality ? { nationality: cleanNationality } : {}),
        gender: (normGender === 'M' || normGender === 'F') ? normGender : (existingCompetitor?.gender ?? ''),
        age: parsedAge !== null && !isNaN(parsedAge) ? parsedAge : (existingCompetitor?.age ?? null),
        ...(resolvedSubdivisions ? { subdivisions: resolvedSubdivisions } : {}),
        createdAt: existingCompetitor?.createdAt ?? Date.now(),
        ...(ircTcc != null ? { ircTcc } : {}),
        ...(vprsTcc != null ? { vprsTcc } : {}),
        ...(pyNumber != null ? { pyNumber } : {}),
        ...(nhcStartingTcf != null ? { nhcStartingTcf } : {}),
        ...(echoStartingTcf != null ? { echoStartingTcf } : {}),
      };

      // Keyed on the row's competitor id whether it ends up added, updated or
      // unchanged — an unchanged boat still gets its contact details relayed.
      if (Object.keys(relay).length > 0) relayByCompetitorId.set(competitor.id, relay);

      if (
        existingCompetitor &&
        // Sail numbers can differ when the row landed via an accepted
        // sail-number change — that must count as an update.
        existingCompetitor.sailNumber.toUpperCase() === competitor.sailNumber &&
        sameFleetIdSet(existingCompetitor.fleetIds, competitor.fleetIds) &&
        (existingCompetitor.bowNumber ?? '') === (competitor.bowNumber ?? '') &&
        (existingCompetitor.boatName ?? '') === (competitor.boatName ?? '') &&
        (existingCompetitor.boatClass ?? '') === (competitor.boatClass ?? '') &&
        samePersonNames(existingCompetitor.names, competitor.names) &&
        samePersonNames(existingCompetitor.owners, competitor.owners) &&
        samePersonNames(existingCompetitor.helms, competitor.helms) &&
        samePersonNames(existingCompetitor.crewNames, competitor.crewNames) &&
        existingCompetitor.club === competitor.club &&
        (existingCompetitor.nationality ?? '') === (competitor.nationality ?? '') &&
        existingCompetitor.gender === competitor.gender &&
        existingCompetitor.age === competitor.age &&
        subdivisionsEqual(existingCompetitor.subdivisions, competitor.subdivisions) &&
        existingCompetitor.ircTcc === competitor.ircTcc &&
        existingCompetitor.vprsTcc === competitor.vprsTcc &&
        existingCompetitor.pyNumber === competitor.pyNumber &&
        existingCompetitor.nhcStartingTcf === competitor.nhcStartingTcf &&
        existingCompetitor.echoStartingTcf === competitor.echoStartingTcf
      ) {
        unchanged++;
        continue;
      }

      log('competitors', existingCompetitor ? 'import-update' : 'import-add', competitor);
      competitorsToSave.push(competitor);
      if (existingCompetitor) {
        updated++;
      } else {
        added++;
      }
    }

    if (competitorsToSave.length > 0) {
      // Phase 7 audit: this is the one bulk path that updates *existing*
      // rows (matched-by-sail-number). It does not pass `expectedVersion`,
      // so a hand-edit in flight when a panel member runs an import would
      // be silently overwritten. Acceptable tradeoff: CSV import is a
      // setup-time event, not concurrent with race-day edits. See the
      // Phase 7 audit note in lib/repository.ts SaveOpts doc-comment.
      await saveCompetitors.mutateAsync(competitorsToSave);
    }
    const csvResult = { added, updated, unchanged, fleetsCreated: newFleetNames, errors };
    if (!rrs) {
      setImportFlow({ step: 'done', csv: csvResult, push: null });
      return;
    }
    // A division choice held by column index (a new subdivision axis) can
    // only resolve now, once the import has minted the axis: the same
    // `axisIdByColumn` entry that keyed the competitors' subdivision values
    // is the axis id the push reads them back from.
    let resolvedRrs: RrsImportConfig;
    if (rrs.divisionSource === 'newAxisColumn') {
      const axisId = rrs.divisionColumnIndex != null ? axisIdByColumn.get(rrs.divisionColumnIndex) : undefined;
      resolvedRrs = axisId
        ? { eventUuid: rrs.eventUuid, divisionSource: 'axis', divisionAxisId: axisId }
        : { eventUuid: rrs.eventUuid, divisionSource: 'none' };
    } else {
      resolvedRrs = { eventUuid: rrs.eventUuid, divisionSource: rrs.divisionSource, divisionAxisId: rrs.divisionAxisId };
    }
    // The local import has committed; now push the FULL post-import list —
    // rrs.org replaces its API-imported competitors wholesale, so a partial
    // list would delete boats from the event. Contact fields exist only for
    // rows in this CSV; other boats' go blank (stated in the dialog).
    const [allCompetitors, freshFleets] = await Promise.all([
      competitorRepo.listBySeries(seriesId),
      fleetRepo.listBySeries(seriesId),
    ]);
    const built = buildRrsOrgCompetitors(allCompetitors, freshFleets, resolvedRrs, relayByCompetitorId);
    const result = await doPush(resolvedRrs, built.competitors);
    setImportFlow({
      step: 'done',
      csv: csvResult,
      push: { config: resolvedRrs, rows: built.competitors, warnings: built.warnings, relayCount: built.relayCount, result },
    });
  }

  /** POST the built rows to our push endpoint. Failures — ours or
   *  rrs.org's — come back as a result for the done dialog, never a throw:
   *  any accompanying CSV import has already committed. */
  async function doPush(config: RrsImportConfig, rows: RrsOrgCompetitor[]): Promise<RrsOrgPushResult> {
    try {
      return await pushCompetitorsToRrsOrg(seriesId, {
        eventUuid: config.eventUuid,
        divisionSource: config.divisionSource,
        ...(config.divisionSource === 'axis' && config.divisionAxisId
          ? { divisionAxisId: config.divisionAxisId }
          : {}),
        competitors: rows,
      });
    } catch (err) {
      return {
        ok: false,
        pushed: rows.length,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Re-run a failed push with the rows exactly as first built. */
  async function retryPush() {
    if (importFlow.step !== 'done' || !importFlow.push) return;
    const { push } = importFlow;
    const result = await doPush(push.config, push.rows);
    setImportFlow({ ...importFlow, push: { ...push, result } });
  }

  /** The push-only path: no CSV — confirm what stored data becomes and push. */
  async function continueToPushConfirm(eventUuid: string, saved: RrsImportConfig | null) {
    const [series, competitors, freshFleets] = await Promise.all([
      seriesRepo.get(seriesId),
      competitorRepo.listBySeries(seriesId),
      fleetRepo.listBySeries(seriesId),
    ]);
    const axes = series ? subdivisionAxes(series) : [];
    setImportFlow({
      step: 'pushConfirm',
      config: defaultRrsConfig(eventUuid, saved, axes, freshFleets.length),
      competitors,
      fleets: freshFleets,
      axes,
    });
  }

  async function handlePushOnly() {
    if (importFlow.step !== 'pushConfirm') return;
    const { config, competitors, fleets: pushFleets } = importFlow;
    const built = buildRrsOrgCompetitors(competitors, pushFleets, config);
    const result = await doPush(config, built.competitors);
    setImportFlow({
      step: 'done',
      csv: null,
      push: { config, rows: built.competitors, warnings: built.warnings, relayCount: built.relayCount, result },
    });
  }

  return (
    <>
      {/* Trigger */}
      <span onClick={() => void openImport()} className="contents">
        {trigger ?? (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            {rrsEnabled ? 'Import' : 'Import spreadsheet'}
          </Button>
        )}
      </span>
      <input
        ref={csvInputRef}
        type="file"
        accept={TABULAR_IMPORT_ACCEPT}
        onChange={handleCsvFileSelected}
        className="hidden"
        data-testid="competitor-import-input"
      />

      {/* Multi-sheet workbook: pick the sheet, then map as usual */}
      <SheetPickerDialog
        open={importFlow.step === 'pickSheet'}
        sheets={importFlow.step === 'pickSheet' ? importFlow.sheets : []}
        onCancel={resetImport}
        onPick={(sheet) => {
          if (importFlow.step !== 'pickSheet') return;
          void openMappingFromRows(sheet.rows, importFlow.rrs);
        }}
      />
      <ImportFileErrorDialog
        open={importFlow.step === 'fileError'}
        message={importFlow.step === 'fileError' ? importFlow.message : ''}
        onClose={resetImport}
      />

      {/* Choice dialog (rrs-import only): source and/or destination */}
      <Dialog open={importFlow.step === 'choose'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Import competitors</DialogTitle>
          </DialogHeader>
          {importFlow.step === 'choose' && (
            /* DialogContent is a grid; without min-w-0 this grid item's
               min-width:auto lets a long nowrap file name widen the whole
               dialog track instead of truncating. */
            <div className="space-y-4 min-w-0">
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Import from</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importFlow.csvChecked}
                    onChange={(e) => setImportFlow({ ...importFlow, csvChecked: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  Spreadsheet file (CSV or Excel)
                </label>
                {importFlow.csvChecked && (
                  <div className="flex items-center gap-2 pl-5 min-w-0">
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => csvInputRef.current?.click()}>
                      Choose file…
                    </Button>
                    {/* min-w-0 lets the flex child shrink so a long file name
                        truncates instead of stretching the dialog. */}
                    <span className="text-sm text-muted-foreground truncate min-w-0">
                      {importFlow.file?.name ?? 'No file chosen'}
                    </span>
                  </div>
                )}
              </div>
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-sm font-medium">Import to</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importFlow.rrsChecked}
                    onChange={(e) => setImportFlow({ ...importFlow, rrsChecked: e.target.checked })}
                    className="h-3.5 w-3.5"
                  />
                  rrs.org
                </label>
                {importFlow.rrsChecked && (
                  <div className="pl-5 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="shrink-0">Event UUID</span>
                      {/* flex-1 overrides the input's default w-full, which
                          would otherwise overflow the row by the label width
                          and stretch the dialog. */}
                      <Input
                        value={importFlow.eventUuid}
                        onChange={(e) => setImportFlow({ ...importFlow, eventUuid: e.target.value.trim() })}
                        placeholder="from the rrs.org Event Panel"
                        className="h-8 font-mono text-xs flex-1 min-w-0"
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Pushing replaces <span className="font-medium">all</span>{' '}
                      competitors previously imported into the rrs.org event via
                      its API — including any edits made to them on rrs.org.
                      Competitors entered manually on rrs.org are kept.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resetImport}>Cancel</Button>
            <Button
              onClick={() => {
                if (importFlow.step !== 'choose') return;
                const saved = importFlow.savedConfig;
                if (importFlow.csvChecked && importFlow.file) {
                  void parseImportFile(
                    importFlow.file,
                    importFlow.rrsChecked ? { eventUuid: importFlow.eventUuid, saved } : null,
                  );
                } else {
                  void continueToPushConfirm(importFlow.eventUuid, saved);
                }
              }}
              disabled={(() => {
                if (importFlow.step !== 'choose') return true;
                if (!importFlow.csvChecked && !importFlow.rrsChecked) return true;
                if (importFlow.csvChecked && !importFlow.file) return true;
                if (importFlow.rrsChecked && !UUID_SHAPE.test(importFlow.eventUuid)) return true;
                return false;
              })()}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push-only confirm dialog */}
      <Dialog open={importFlow.step === 'pushConfirm'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent className="w-[90vw] max-w-2xl sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Push competitors to rrs.org</DialogTitle>
          </DialogHeader>
          {importFlow.step === 'pushConfirm' && (
            <PushConfirmBody flow={importFlow} setFlow={setImportFlow} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resetImport}>Cancel</Button>
            <Button
              onClick={() => void handlePushOnly()}
              disabled={importFlow.step !== 'pushConfirm' || importFlow.competitors.length === 0}
            >
              {importFlow.step === 'pushConfirm'
                ? `Push ${importFlow.competitors.length} competitor${importFlow.competitors.length === 1 ? '' : 's'}`
                : 'Push'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mapping dialog */}
      <Dialog open={importFlow.step === 'mapping'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent className="w-[90vw] max-w-4xl sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Import competitors — map columns</DialogTitle>
            <DialogDescription>
              Match each CSV column to a competitor field. Sail number and the
              primary identifier are required. Use <code>|</code> in the fleet
              column to assign a competitor to multiple fleets, e.g. <code>PY|M15</code>.
            </DialogDescription>
          </DialogHeader>
          {importFlow.step === 'mapping' && (
            <MappingDialogBody flow={importFlow} setFlow={setImportFlow} fleets={fleets} />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resetImport}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={(() => {
                if (importFlow.step !== 'mapping') return true;
                const t = Object.values(importFlow.columnMap);
                const primaryCount = t.filter((v) => v === 'primary').length;
                const sailCount = t.filter((v) => v === 'sailNumber').length;
                return sailCount !== 1 || primaryCount !== 1;
              })()}
            >
              {importFlow.step === 'mapping'
                ? `Import ${importFlow.rows.length} row${importFlow.rows.length === 1 ? '' : 's'}${importFlow.rrs ? ' & push' : ''}`
                : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sail-number-change review dialog */}
      <Dialog open={importFlow.step === 'renames'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent className="w-[90vw] max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sail number changes?</DialogTitle>
            <DialogDescription>
              These rows look like sail-number changes: the new number matches
              no competitor in the series, the old number is missing from the
              CSV, and the boat or person matches. Ticked rows update the
              existing competitor — keeping its recorded results — under the
              new number. Unticked rows are imported as new competitors.
            </DialogDescription>
          </DialogHeader>
          {importFlow.step === 'renames' && (
            <div className="max-h-[50vh] overflow-y-auto space-y-1">
              {importFlow.candidates.map((c, i) => (
                <label
                  key={c.rowIndex}
                  className="flex items-center gap-3 rounded-md border p-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={importFlow.accepted[i]}
                    onChange={() =>
                      setImportFlow({
                        ...importFlow,
                        accepted: importFlow.accepted.map((v, idx) => (idx === i ? !v : v)),
                      })
                    }
                    className="h-3.5 w-3.5"
                  />
                  <span className="font-mono whitespace-nowrap">
                    {c.oldSailNumber} → {c.newSailNumber}
                  </span>
                  <span className="truncate min-w-0">
                    {[c.boatName, c.personName].filter(Boolean).join(' — ')}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    matched on {c.matchedOn}
                  </span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (importFlow.step === 'renames') setImportFlow(importFlow.mapping);
              }}
            >
              Back
            </Button>
            <Button onClick={() => void confirmRenames()}>
              {importFlow.step === 'renames'
                ? (() => {
                    const n = importFlow.accepted.filter(Boolean).length;
                    return n > 0
                      ? `Apply ${n} change${n === 1 ? '' : 's'} & import`
                      : 'Import as new competitors';
                  })()
                : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Done dialog */}
      <Dialog open={importFlow.step === 'done'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {importFlow.step === 'done' && !importFlow.csv
                ? importFlow.push?.result.ok ? 'Push complete' : 'Push failed'
                : 'Import complete'}
            </DialogTitle>
          </DialogHeader>
          {importFlow.step === 'done' && (
            <div className="space-y-3">
              {importFlow.csv && (
                <>
                  <p className="text-sm">
                    {importFlow.csv.added} competitor{importFlow.csv.added === 1 ? '' : 's'} added,{' '}
                    {importFlow.csv.updated} updated,{' '}
                    {importFlow.csv.unchanged} unchanged.
                  </p>
                  {importFlow.csv.fleetsCreated.length > 0 && (
                    <p className="text-sm">
                      {importFlow.csv.fleetsCreated.length} new fleet{importFlow.csv.fleetsCreated.length === 1 ? '' : 's'} created:{' '}
                      {importFlow.csv.fleetsCreated.join(', ')}.
                    </p>
                  )}
                  {importFlow.csv.errors.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1">
                        {importFlow.csv.errors.length} row{importFlow.csv.errors.length === 1 ? '' : 's'} skipped:
                      </p>
                      <ul className="text-sm text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                        {importFlow.csv.errors.map((err) => (
                          <li key={err.rowIndex}>Row {err.rowIndex}: {err.reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {importFlow.push && (
                <div className={importFlow.csv ? 'border-t pt-3 space-y-2' : 'space-y-2'}>
                  {importFlow.push.result.ok ? (
                    <>
                      <p className="text-sm">
                        Pushed {importFlow.push.result.pushed} competitor{importFlow.push.result.pushed === 1 ? '' : 's'} to rrs.org.
                      </p>
                      <p className="text-xs text-muted-foreground">
                        rrs.org records any per-record problems (e.g. phone
                        numbers it could not use) on its Event Panel — review
                        the imported entries there.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm">
                        The push to rrs.org failed
                        {importFlow.push.result.status ? ` (HTTP ${importFlow.push.result.status})` : ''}.
                        {importFlow.csv ? ' The CSV import above has still been applied.' : ''}
                      </p>
                      {importFlow.push.result.message && (
                        <p className="text-xs text-muted-foreground font-mono max-h-24 overflow-auto whitespace-pre-wrap">
                          {importFlow.push.result.message}
                        </p>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void retryPush()}>
                        Retry push
                      </Button>
                    </>
                  )}
                  {importFlow.push.warnings.length > 0 && (
                    <div>
                      <p className="text-sm font-medium mb-1">
                        Sent with a blank phone number:
                      </p>
                      <ul className="text-sm text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                        {importFlow.push.warnings.map((w) => (
                          <li key={w.competitorId}>{w.sailNumber}: {w.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={resetImport}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
