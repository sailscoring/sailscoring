'use client';

import { useState, useRef, useImperativeHandle, forwardRef } from 'react';
import Papa from 'papaparse';
import { competitorRepo, fleetRepo, seriesRepo, ensureFleet } from '@/lib/dexie-repository';
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
import type { Competitor, Fleet } from '@/lib/types';
import { log } from '@/lib/debug';

// ── Types ───────────────────────────────────────────────────────────────────

type CompetitorField = 'sailNumber' | 'boatName' | 'boatClass' | 'name' | 'crewName' | 'club' | 'gender' | 'age' | 'fleet' | 'tcc' | 'py' | 'nhcStartingTcf' | 'ignore';
type ColumnMap = Record<number, CompetitorField>;

type ImportFlow =
  | { step: 'idle' }
  | { step: 'mapping'; headers: string[]; sampleRows: string[][]; rows: string[][]; columnMap: ColumnMap }
  | { step: 'done'; added: number; updated: number; unchanged: number; fleetsCreated: string[]; errors: { rowIndex: number; reason: string }[] };

export interface ImportResult {
  added: number;
  updated: number;
  unchanged: number;
  fleetsCreated: string[];
  errors: { rowIndex: number; reason: string }[];
}

const FIELD_LABELS: Record<CompetitorField, string> = {
  sailNumber: 'Sail number',
  boatName: 'Boat name',
  boatClass: 'Class',
  name: 'Helm name',
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
  if (/helm|name/.test(h)) return 'name';
  if (/club/.test(h)) return 'club';
  if (/gender|sex/.test(h)) return 'gender';
  if (/age/.test(h)) return 'age';
  if (/fleet|division/.test(h)) return 'fleet';
  if (/tcc|irc.*rating|rating.*irc/.test(h)) return 'tcc';
  if (/\bpy\b|portsmouth/.test(h)) return 'py';
  if (/\bnhc\b|starting.*tcf|nhc.*tcf|nhc.*rating/.test(h)) return 'nhcStartingTcf';
  return 'ignore';
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
      complete: (result) => {
        const allRows = result.data;
        if (allRows.length < 2) return;
        const headers = allRows[0];
        const dataRows = allRows.slice(1);
        const sampleRows = dataRows.slice(0, 3);
        const columnMap: ColumnMap = {};
        headers.forEach((h, i) => { columnMap[i] = autoDetectField(h); });
        setImportFlow({ step: 'mapping', headers, sampleRows, rows: dataRows, columnMap });
      },
    });
    e.target.value = '';
  }

  async function handleImport() {
    if (importFlow.step !== 'mapping') return;
    const { rows, columnMap } = importFlow;
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
      let name = '';
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
        else if (field === 'name') name = val;
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
      const competitor: Competitor = {
        id: existingCompetitor?.id ?? crypto.randomUUID(),
        seriesId,
        fleetIds,
        sailNumber: normSail,
        ...(resolvedBoatName ? { boatName: resolvedBoatName } : {}),
        ...(resolvedBoatClass ? { boatClass: resolvedBoatClass } : {}),
        name: name || existingCompetitor?.name || '',
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
              Match each CSV column to a competitor field. Sail number is required.
              Use <code>|</code> in the fleet column to assign a competitor to multiple
              fleets, e.g. <code>PY|M15</code>.
            </DialogDescription>
          </DialogHeader>
          {importFlow.step === 'mapping' && (
            <div className="overflow-y-auto max-h-96">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/5">Column</TableHead>
                    <TableHead className="w-1/5">Map to</TableHead>
                    <TableHead className="w-3/5">Sample values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importFlow.headers.map((header, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-sm truncate">{header || `Column ${i + 1}`}</TableCell>
                      <TableCell>
                        <Select
                          value={importFlow.columnMap[i]}
                          onValueChange={(v) =>
                            setImportFlow((f) =>
                              f.step === 'mapping'
                                ? { ...f, columnMap: { ...f.columnMap, [i]: v as CompetitorField } }
                                : f
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_LABELS) as CompetitorField[]).map((field) => (
                              <SelectItem key={field} value={field}>
                                {FIELD_LABELS[field]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate">
                        {importFlow.sampleRows
                          .map((row) => row[i]?.trim() ?? '')
                          .filter(Boolean)
                          .slice(0, 3)
                          .join(', ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={resetImport}>Cancel</Button>
            <Button
              onClick={handleImport}
              disabled={
                importFlow.step !== 'mapping' ||
                !Object.values(importFlow.columnMap).includes('sailNumber')
              }
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
