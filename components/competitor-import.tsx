'use client';

import { useState, useRef, useImperativeHandle, forwardRef, useMemo, useCallback, memo } from 'react';
import Papa from 'papaparse';
import {
  seriesRepo,
  competitorRepo,
  DEFAULT_FLEET_NAME,
} from '@/lib/api-repository';
import { useUpdateSeries } from '@/hooks/use-series';
import { useSaveFleets } from '@/hooks/use-fleets';
import { useSaveCompetitors } from '@/hooks/use-competitors';
import {
  parseFleetCell,
  autoDetectField,
  matchSubdivisionAxis,
  axisColumnTarget,
  subdivisionAxisIdOf,
  isSubdivisionTarget,
  NEW_AXIS_TARGET,
  type CompetitorField,
  type ColumnTarget,
} from '@/lib/csv-import';
import { lookupAlias, normalizeCodeInput } from '@/lib/nationality';
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
  sameFleetIdSet,
  subdivisionAxes,
  newSubdivisionAxis,
  cleanSubdivisions,
  subdivisionsEqual,
} from '@/lib/competitor-fields';
import { log } from '@/lib/debug';

// ── Types ───────────────────────────────────────────────────────────────────

type ColumnMap = Record<number, ColumnTarget>;

type ImportFlow =
  | { step: 'idle' }
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
    }
  | { step: 'done'; added: number; updated: number; unchanged: number; fleetsCreated: string[]; errors: { rowIndex: number; reason: string }[] };

type MappingFlow = Extract<ImportFlow, { step: 'mapping' }>;

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
  boatName: 'Boat name',
  boatClass: 'Class',
  crewName: 'Crew name',
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
function buildFieldLabels(
  primary: PrimaryPersonLabel,
  axes: SubdivisionAxis[],
): Record<string, string> {
  const primaryText = PRIMARY_PERSON_LABEL_TEXT[primary];
  const labels: Record<string, string> = {
    sailNumber: STATIC_FIELD_LABELS.sailNumber,
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
    ignore: STATIC_FIELD_LABELS.ignore,
  });
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

/** One column-mapping row. Memoized so it re-renders only when its own
 *  column value, the sample text, or the (primary-dependent) field labels
 *  change — not for every unrelated wizard state change. */
const MappingRow = memo(function MappingRow({
  header,
  colIndex,
  columnValue,
  sampleText,
  fieldLabels,
  onChange,
}: {
  header: string;
  colIndex: number;
  columnValue: ColumnTarget;
  sampleText: string;
  fieldLabels: Record<string, string>;
  onChange: (index: number, value: ColumnTarget) => void;
}) {
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
                {fieldLabels[field]}
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
  sampleTexts,
  fieldLabels,
  onChange,
}: {
  headers: string[];
  columnMap: ColumnMap;
  sampleTexts: string[];
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
            sampleText={sampleTexts[i]}
            fieldLabels={fieldLabels}
            onChange={onChange}
          />
        ))}
      </TableBody>
    </Table>
  );
});

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
    () => buildFieldLabels(flow.proposedPrimary, flow.subdivisionAxes),
    [flow.proposedPrimary, flow.subdivisionAxes],
  );
  const targets = Object.values(flow.columnMap);
  const primaryCount = targets.filter((t) => t === 'primary').length;
  const sailCount = targets.filter((t) => t === 'sailNumber').length;
  const hasPrimary = primaryCount >= 1;
  const hasSail = sailCount >= 1;
  const tooManyPrimaries = primaryCount > 1;
  const tooManySails = sailCount > 1;

  const updateColumn = useCallback((index: number, value: ColumnTarget) => {
    setFlow((f) =>
      f.step === 'mapping'
        ? { ...f, columnMap: { ...f.columnMap, [index]: value } }
        : f,
    );
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

  // Pre-join each column's sample values once — headers and sampleRows are
  // fixed for the import session, so this never recomputes after mount.
  const sampleTexts = useMemo(
    () => flow.headers.map((_, i) =>
      flow.sampleRows
        .map((row) => row[i]?.trim() ?? '')
        .filter(Boolean)
        .slice(0, 3)
        .join(', ') || '—',
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
        sampleTexts={sampleTexts}
        fieldLabels={fieldLabels}
        onChange={updateColumn}
      />
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

// ── Component ───────────────────────────────────────────────────────────────

export interface CompetitorImportHandle {
  /** Programmatically open the file picker. */
  trigger: () => void;
}

/**
 * Reusable competitor import component. Shows a file input trigger,
 * a column-mapping dialog, and a completion dialog.
 *
 * @param seriesId - The series to import into
 * @param fleets - Current fleets (for tracking new fleet creation)
 * @param onComplete - Called after import completes (with results) or is dismissed
 * @param trigger - Optional custom trigger element. If omitted, renders a default "Import CSV" button.
 */
export const CompetitorImport = forwardRef<CompetitorImportHandle, {
  seriesId: string;
  fleets: Fleet[];
  onComplete?: (result: ImportResult | null) => void;
  trigger?: React.ReactNode;
}>(function CompetitorImport({ seriesId, fleets, onComplete, trigger }, ref) {
  const updateSeries = useUpdateSeries();
  const saveFleets = useSaveFleets();
  const saveCompetitors = useSaveCompetitors();
  const [importFlow, setImportFlow] = useState<ImportFlow>({ step: 'idle' });
  const csvInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    trigger: () => csvInputRef.current?.click(),
  }));

  function resetImport() {
    const result = importFlow.step === 'done' ? {
      added: importFlow.added,
      updated: importFlow.updated,
      unchanged: importFlow.unchanged,
      fleetsCreated: importFlow.fleetsCreated,
      errors: importFlow.errors,
    } : null;
    setImportFlow({ step: 'idle' });
    if (csvInputRef.current) csvInputRef.current.value = '';
    onComplete?.(result);
  }

  function handleCsvFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: async (result) => {
        const allRows = result.data;
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
        });
      },
    });
    e.target.value = '';
  }

  async function handleImport() {
    if (importFlow.step !== 'mapping') return;
    const { rows, headers, columnMap, proposedPrimary, proposedFields, currentPrimary, currentFields, seriesScoringMode, existingHasBoatClass, alsoCreateScratch } = importFlow;

    const existing = await competitorRepo.listBySeries(seriesId);
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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;

      let sailNumber = '';
      let boatName = '';
      let boatClass = '';
      let primaryName = '';
      let helmRole = '';
      let ownerRole = '';
      let crewName = '';
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
      Object.entries(columnMap).forEach(([colStr, field]) => {
        const col = parseInt(colStr, 10);
        const val = row[col]?.trim() ?? '';
        if (field === 'sailNumber') sailNumber = val;
        else if (field === 'boatName') boatName = val;
        else if (field === 'boatClass') boatClass = val;
        else if (field === 'primary') primaryName = val;
        else if (field === 'helm') helmRole = val;
        else if (field === 'owner') ownerRole = val;
        else if (field === 'crewName') crewName = val;
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
          const axisId = axisIdByColumn.get(col);
          if (axisId && val) subdivisionCells[axisId] = val;
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
      const existingCompetitor = sailCandidates.length <= 1
        ? sailCandidates[0] ?? null
        : sailCandidates.find((c) => sameFleetIdSet(c.fleetIds, fleetIds)) ?? sailCandidates[0];

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

      const resolvedBoatName = boatName || existingCompetitor?.boatName || '';
      // boatClass fallback: when neither the CSV nor any existing competitor
      // provides a boatClass, fall back to the original CSV fleet name so
      // grouping like "Cruisers 2" survives even when split into rating fleets.
      const fleetNameFallback = plan.shouldFillBoatClassFromFleetName
        ? (planRows[i].csvFleetNames[0]?.trim() || DEFAULT_FLEET_NAME)
        : '';
      const resolvedBoatClass = boatClass || existingCompetitor?.boatClass || fleetNameFallback || '';
      const resolvedCrewName = crewName || existingCompetitor?.crewName || '';
      const resolvedHelm = helmRole || existingCompetitor?.helm || '';
      const resolvedOwner = ownerRole || existingCompetitor?.owner || '';
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
        ...(resolvedBoatName ? { boatName: resolvedBoatName } : {}),
        ...(resolvedBoatClass ? { boatClass: resolvedBoatClass } : {}),
        name: primaryName || existingCompetitor?.name || '',
        ...(resolvedHelm ? { helm: resolvedHelm } : {}),
        ...(resolvedOwner ? { owner: resolvedOwner } : {}),
        ...(resolvedCrewName ? { crewName: resolvedCrewName } : {}),
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

      if (
        existingCompetitor &&
        sameFleetIdSet(existingCompetitor.fleetIds, competitor.fleetIds) &&
        (existingCompetitor.boatName ?? '') === (competitor.boatName ?? '') &&
        (existingCompetitor.boatClass ?? '') === (competitor.boatClass ?? '') &&
        existingCompetitor.name === competitor.name &&
        (existingCompetitor.owner ?? '') === (competitor.owner ?? '') &&
        (existingCompetitor.helm ?? '') === (competitor.helm ?? '') &&
        (existingCompetitor.crewName ?? '') === (competitor.crewName ?? '') &&
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
    setImportFlow({ step: 'done', added, updated, unchanged, fleetsCreated: newFleetNames, errors });
  }

  return (
    <>
      {/* Trigger */}
      <span onClick={() => csvInputRef.current?.click()} className="contents">
        {trigger ?? (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        )}
      </span>
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleCsvFileSelected}
        className="hidden"
      />

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
                ? `Import ${importFlow.rows.length} row${importFlow.rows.length === 1 ? '' : 's'}`
                : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Done dialog */}
      <Dialog open={importFlow.step === 'done'} onOpenChange={(open) => { if (!open) resetImport(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Import complete</DialogTitle>
          </DialogHeader>
          {importFlow.step === 'done' && (
            <div className="space-y-3">
              <p className="text-sm">
                {importFlow.added} competitor{importFlow.added === 1 ? '' : 's'} added,{' '}
                {importFlow.updated} updated,{' '}
                {importFlow.unchanged} unchanged.
              </p>
              {importFlow.fleetsCreated.length > 0 && (
                <p className="text-sm">
                  {importFlow.fleetsCreated.length} new fleet{importFlow.fleetsCreated.length === 1 ? '' : 's'} created:{' '}
                  {importFlow.fleetsCreated.join(', ')}.
                </p>
              )}
              {importFlow.errors.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-1">
                    {importFlow.errors.length} row{importFlow.errors.length === 1 ? '' : 's'} skipped:
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                    {importFlow.errors.map((err) => (
                      <li key={err.rowIndex}>Row {err.rowIndex}: {err.reason}</li>
                    ))}
                  </ul>
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
