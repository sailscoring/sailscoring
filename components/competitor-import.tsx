'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import Papa from 'papaparse';
import { competitorRepo, fleetRepo, seriesRepo, ensureFleet } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import { parseFleetCell } from '@/lib/csv-import';
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
import type { Competitor, Fleet, CompetitorFieldKey, PrimaryPersonLabel } from '@/lib/types';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
} from '@/lib/competitor-fields';
import { log } from '@/lib/debug';

// ── Types ───────────────────────────────────────────────────────────────────

/** Internal dropdown targets. The single required primary-name slot is `primary`;
 *  its dropdown label is rendered dynamically from the series primary label.
 *  `helm` and `owner` are optional *role* targets — shown only when the primary
 *  label doesn't already occupy that role. Under the hood both route to
 *  `Competitor.helm` / `Competitor.owner`, or to `Competitor.name` when they
 *  match the primary. */
type CompetitorField = 'sailNumber' | 'boatName' | 'boatClass' | 'primary' | 'helm' | 'owner' | 'crewName' | 'club' | 'gender' | 'age' | 'fleet' | 'tcc' | 'py' | 'nhcStartingTcf' | 'ignore';
type ColumnMap = Record<number, CompetitorField>;

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
    }
  | { step: 'done'; added: number; updated: number; unchanged: number; fleetsCreated: string[]; errors: { rowIndex: number; reason: string }[] };

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
  gender: 'Gender',
  age: 'Age',
  fleet: 'Fleet',
  tcc: 'IRC TCC',
  py: 'PY number',
  nhcStartingTcf: 'NHC starting TCF',
  ignore: '(ignore)',
};

/** Build the dropdown list for the current primary label. The primary slot
 *  and role slots are emitted in a shared order; the role that matches the
 *  primary is hidden (it's already covered by `primary`). */
function buildFieldLabels(primary: PrimaryPersonLabel): Partial<Record<CompetitorField, string>> {
  const primaryText = PRIMARY_PERSON_LABEL_TEXT[primary];
  const labels: Partial<Record<CompetitorField, string>> = {
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
    gender: STATIC_FIELD_LABELS.gender,
    age: STATIC_FIELD_LABELS.age,
    fleet: STATIC_FIELD_LABELS.fleet,
    tcc: STATIC_FIELD_LABELS.tcc,
    py: STATIC_FIELD_LABELS.py,
    nhcStartingTcf: STATIC_FIELD_LABELS.nhcStartingTcf,
    ignore: STATIC_FIELD_LABELS.ignore,
  });
  return labels;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sameFleetIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const id of b) if (!set.has(id)) return false;
  return true;
}

function autoDetectField(header: string): CompetitorField {
  const h = header.trim().toLowerCase();
  if (/sail/.test(h)) return 'sailNumber';
  if (/\bboat\b/.test(h)) return 'boatName';
  if (/\bclass\b/.test(h)) return 'boatClass';
  if (/crew/.test(h)) return 'crewName';
  if (/\bhelm\b|skipper/.test(h)) return 'helm';
  if (/\bowner\b|\bentrant\b/.test(h)) return 'owner';
  if (/name/.test(h)) return 'primary';
  if (/club/.test(h)) return 'club';
  if (/gender|sex/.test(h)) return 'gender';
  if (/age/.test(h)) return 'age';
  if (/fleet|division/.test(h)) return 'fleet';
  if (/tcc|irc.*rating|rating.*irc/.test(h)) return 'tcc';
  if (/\bpy\b|portsmouth/.test(h)) return 'py';
  if (/\bnhc\b|starting.*tcf|nhc.*tcf|nhc.*rating/.test(h)) return 'nhcStartingTcf';
  return 'ignore';
}

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
        const initialMap: ColumnMap = {};
        headers.forEach((h, i) => { initialMap[i] = autoDetectField(h); });

        const series = await seriesRepo.get(seriesId);
        const existingCompetitors = await competitorRepo.listBySeries(seriesId);
        const firstImport = existingCompetitors.length === 0;
        const currentPrimary = series?.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
        const currentFields = series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();

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
        const optionalAdditions: CompetitorFieldKey[] = [];
        for (const field of ALL_COMPETITOR_FIELDS) {
          if (isFieldDisabledByPrimary(field, proposedPrimary)) continue;
          if (currentFields.includes(field)) continue;
          // Map CompetitorField dropdown values to CompetitorFieldKey where they overlap
          const dropdownField: CompetitorField | null =
            field === 'boatName' ? 'boatName' :
            field === 'boatClass' ? 'boatClass' :
            field === 'helm' ? 'helm' :
            field === 'owner' ? 'owner' :
            field === 'crewName' ? 'crewName' :
            field === 'club' ? 'club' :
            field === 'gender' ? 'gender' :
            field === 'age' ? 'age' :
            null;
          if (dropdownField && targets.has(dropdownField)) optionalAdditions.push(field);
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
        });
      },
    });
    e.target.value = '';
  }

  async function handleImport() {
    if (importFlow.step !== 'mapping') return;
    const { rows, columnMap, proposedPrimary, proposedFields, currentPrimary, currentFields } = importFlow;

    // Persist series-level proposals (primary label + additively-enabled fields)
    // before touching competitors so downstream UI reads the correct config.
    const seriesPatch: {
      primaryPersonLabel?: PrimaryPersonLabel;
      enabledCompetitorFields?: CompetitorFieldKey[];
      lastModifiedAt?: number;
    } = {};
    if (proposedPrimary !== currentPrimary) seriesPatch.primaryPersonLabel = proposedPrimary;
    const fieldsChanged =
      proposedFields.length !== currentFields.length ||
      proposedFields.some((f, i) => f !== currentFields[i]);
    if (fieldsChanged) seriesPatch.enabledCompetitorFields = proposedFields;
    if (Object.keys(seriesPatch).length > 0) {
      seriesPatch.lastModifiedAt = Date.now();
      await db.series.update(seriesId, seriesPatch);
    }

    const existing = await competitorRepo.listBySeries(seriesId);
    const bysail = new Map<string, Competitor[]>();
    for (const c of existing) {
      const key = c.sailNumber.toUpperCase();
      const arr = bysail.get(key);
      if (arr) arr.push(c);
      else bysail.set(key, [c]);
    }
    const existingFleetNames = new Set(fleets.map((f) => f.name.toLowerCase()));
    const newFleetNames = new Set<string>();
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    const errors: { rowIndex: number; reason: string }[] = [];

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
      let gender = '';
      let age = '';
      let fleet = '';
      let tcc = '';
      let py = '';
      let nhcStartingTcfStr = '';
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
        else if (field === 'gender') gender = val;
        else if (field === 'age') age = val;
        else if (field === 'fleet') fleet = val;
        else if (field === 'tcc') tcc = val;
        else if (field === 'py') py = val;
        else if (field === 'nhcStartingTcf') nhcStartingTcfStr = val;
      });

      if (!sailNumber) {
        errors.push({ rowIndex: rowNumber, reason: 'missing sail number' });
        continue;
      }

      const normSail = sailNumber.toUpperCase();
      const parsedAge = age ? parseInt(age, 10) : null;
      const normGender = gender.toUpperCase();

      const fleetNames = parseFleetCell(fleet);
      const resolvedFleetIds =
        fleetNames.length === 0
          ? [await ensureFleet(seriesId, '')]
          : await Promise.all(fleetNames.map((n) => ensureFleet(seriesId, n)));
      const fleetIds = [...new Set(resolvedFleetIds)];
      for (const fn of fleetNames) {
        if (fn.trim() && !existingFleetNames.has(fn.trim().toLowerCase())) {
          newFleetNames.add(fn.trim());
          existingFleetNames.add(fn.trim().toLowerCase());
        }
      }

      const sailCandidates = bysail.get(normSail) ?? [];
      const existingCompetitor = sailCandidates.length <= 1
        ? sailCandidates[0] ?? null
        : sailCandidates.find((c) => sameFleetIdSet(c.fleetIds, fleetIds)) ?? sailCandidates[0];

      const parsedTcc = tcc ? parseFloat(tcc) : null;
      const parsedPy = py ? parseInt(py, 10) : null;
      const parsedNhc = nhcStartingTcfStr ? parseFloat(nhcStartingTcfStr) : null;
      const ircTcc = parsedTcc != null && !isNaN(parsedTcc) ? parsedTcc : existingCompetitor?.ircTcc;
      const pyNumber = parsedPy != null && !isNaN(parsedPy) ? parsedPy : existingCompetitor?.pyNumber;
      const nhcStartingTcf = parsedNhc != null && !isNaN(parsedNhc) ? parsedNhc : existingCompetitor?.nhcStartingTcf;

      const resolvedBoatName = boatName || existingCompetitor?.boatName || '';
      const resolvedBoatClass = boatClass || existingCompetitor?.boatClass || '';
      const resolvedCrewName = crewName || existingCompetitor?.crewName || '';
      const resolvedHelm = helmRole || existingCompetitor?.helm || '';
      const resolvedOwner = ownerRole || existingCompetitor?.owner || '';
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
        gender: (normGender === 'M' || normGender === 'F') ? normGender : (existingCompetitor?.gender ?? ''),
        age: parsedAge !== null && !isNaN(parsedAge) ? parsedAge : (existingCompetitor?.age ?? null),
        createdAt: existingCompetitor?.createdAt ?? Date.now(),
        ...(ircTcc != null ? { ircTcc } : {}),
        ...(pyNumber != null ? { pyNumber } : {}),
        ...(nhcStartingTcf != null ? { nhcStartingTcf } : {}),
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
        existingCompetitor.gender === competitor.gender &&
        existingCompetitor.age === competitor.age &&
        existingCompetitor.ircTcc === competitor.ircTcc &&
        existingCompetitor.pyNumber === competitor.pyNumber &&
        existingCompetitor.nhcStartingTcf === competitor.nhcStartingTcf
      ) {
        unchanged++;
        continue;
      }

      log('competitors', existingCompetitor ? 'import-update' : 'import-add', competitor);
      await competitorRepo.save(competitor);
      if (existingCompetitor) {
        updated++;
      } else {
        added++;
      }
    }

    await seriesRepo.touch(seriesId);
    setImportFlow({ step: 'done', added, updated, unchanged, fleetsCreated: [...newFleetNames], errors });
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
          {importFlow.step === 'mapping' && (() => {
            const flow = importFlow;
            const fieldLabels = buildFieldLabels(flow.proposedPrimary);
            const targets = Object.values(flow.columnMap);
            const primaryCount = targets.filter((t) => t === 'primary').length;
            const sailCount = targets.filter((t) => t === 'sailNumber').length;
            const hasPrimary = primaryCount >= 1;
            const hasSail = sailCount >= 1;
            const tooManyPrimaries = primaryCount > 1;
            const tooManySails = sailCount > 1;

            function updateColumn(index: number, value: CompetitorField) {
              setImportFlow((f) =>
                f.step === 'mapping'
                  ? { ...f, columnMap: { ...f.columnMap, [index]: value } }
                  : f,
              );
            }

            function updatePrimary(label: PrimaryPersonLabel) {
              setImportFlow((f) => {
                if (f.step !== 'mapping') return f;
                const nextMap = reconcileColumnMap(f.columnMap, label);
                // Drop optional additions that are disabled by the new primary.
                const nextProposedFields = f.proposedFields.filter(
                  (field) => !isFieldDisabledByPrimary(field, label),
                );
                return { ...f, proposedPrimary: label, columnMap: nextMap, proposedFields: nextProposedFields };
              });
            }

            function toggleField(field: CompetitorFieldKey, checked: boolean) {
              setImportFlow((f) => {
                if (f.step !== 'mapping') return f;
                const set = new Set(f.proposedFields);
                if (checked) set.add(field); else set.delete(field);
                const nextArray = ALL_COMPETITOR_FIELDS.filter((ff) => set.has(ff));
                return { ...f, proposedFields: nextArray };
              });
            }

            const primaryChanged = flow.proposedPrimary !== flow.currentPrimary;
            const fieldAdditions = flow.proposedFields.filter((f) => !flow.currentFields.includes(f));
            const fieldRemovals = flow.currentFields.filter((f) => !flow.proposedFields.includes(f));

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

                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/5">Column</TableHead>
                      <TableHead className="w-1/5">Map to</TableHead>
                      <TableHead className="w-3/5">Sample values</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {flow.headers.map((header, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm truncate">{header || `Column ${i + 1}`}</TableCell>
                        <TableCell>
                          <Select
                            value={flow.columnMap[i]}
                            onValueChange={(v) => updateColumn(i, v as CompetitorField)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(fieldLabels) as CompetitorField[]).map((field) => (
                                <SelectItem key={field} value={field}>
                                  {fieldLabels[field]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate">
                          {flow.sampleRows
                            .map((row) => row[i]?.trim() ?? '')
                            .filter(Boolean)
                            .slice(0, 3)
                            .join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
          })()}
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
