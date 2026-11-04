'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ImportFileErrorDialog, SheetPickerDialog, SkippedRowsNote } from '@/components/import-file-dialogs';
import { parseTabularFile, TABULAR_IMPORT_ACCEPT, type WorkbookSheet } from '@/lib/import-table';
import { MAX_GENERATED_RACES } from '@/lib/race-schedule';
import {
  detectScheduleField,
  findScheduleHeaderRow,
  fleetField,
  parseSchedule,
  scheduleMappingProblem,
  type ImportedRace,
  type ParseScheduleResult,
  type ScheduleColumnMap,
  type ScheduleField,
} from '@/lib/schedule-import';
import type { Fleet, StartGroup } from '@/lib/types';

type Flow =
  | { step: 'idle' }
  | { step: 'pickSheet'; sheets: WorkbookSheet[] }
  | { step: 'fileError'; message: string }
  | {
      step: 'mapping';
      headers: string[];
      rows: string[][];
      /** Lines above the column headings, left out of the import. */
      skippedRows: number;
      columnMap: ScheduleColumnMap;
    }
  | { step: 'preview'; result: ParseScheduleResult; saving: boolean; error: string };

export interface ScheduleImportHandle {
  /** Open the file picker. */
  trigger: () => void;
}

/**
 * Import a race schedule from a .csv or .xlsx: one row per race with its
 * date, and its guns either in one Start column (run through the default
 * start sequence) or in a column per fleet. A file and sheet pick, a column
 * mapping, and a preview of every race with its starts; on confirm the races
 * are handed to `onConfirm`, which appends them. A failure there keeps the
 * preview open and says so.
 */
export const ScheduleImport = forwardRef<ScheduleImportHandle, {
  fleets: readonly Fleet[];
  startSequence: readonly StartGroup[];
  /** Races with no start columns get the default sequence with no gun time. */
  untimedSequenceWhenNoStarts: boolean;
  /** Races already in the series: the imported ones are numbered after. */
  existingCount: number;
  onConfirm: (races: ImportedRace[]) => Promise<void>;
  /** Turns a failed save into the sentence the preview shows. */
  describeFailure: (err: unknown) => string;
}>(function ScheduleImport(
  { fleets, startSequence, untimedSequenceWhenNoStarts, existingCount, onConfirm, describeFailure },
  ref,
) {
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fleetName = new Map(fleets.map((f) => [f.id, f.name]));

  useImperativeHandle(ref, () => ({
    trigger: () => fileInputRef.current?.click(),
  }));

  const fieldOptions: { value: ScheduleField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Race name' },
    { value: 'race', label: 'Race number (order)' },
    { value: 'start', label: 'Start (default sequence)' },
    ...fleets.map((f) => ({ value: fleetField(f.id), label: `Start: ${f.name}` })),
    { value: 'ignore', label: '(ignore)' },
  ];

  function reset() {
    setFlow({ step: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = await parseTabularFile(file);
    if (parsed.kind === 'error') setFlow({ step: 'fileError', message: parsed.message });
    else if (parsed.kind === 'workbook') setFlow({ step: 'pickSheet', sheets: parsed.sheets });
    else openMapping(parsed.rows);
  }

  function openMapping(allRows: string[][]) {
    const headerRow = findScheduleHeaderRow(allRows);
    if (allRows.length - headerRow < 2) {
      setFlow({ step: 'fileError', message: 'This sheet has no races under its headings.' });
      return;
    }
    const headers = allRows[headerRow];
    const columnMap: ScheduleColumnMap = {};
    const taken = new Set<ScheduleField>();
    headers.forEach((h, i) => {
      // A field already claimed by a column to the left isn't offered twice.
      const field = detectScheduleField(h, fleets);
      columnMap[i] = taken.has(field) ? 'ignore' : field;
      if (field !== 'ignore') taken.add(field);
    });
    setFlow({
      step: 'mapping',
      headers,
      rows: allRows.slice(headerRow + 1),
      skippedRows: headerRow,
      columnMap,
    });
  }

  const mapping = flow.step === 'mapping' ? flow : null;
  const problem = mapping
    ? scheduleMappingProblem(mapping.columnMap, { hasStartSequence: startSequence.length > 0 })
    : null;

  function runParse() {
    if (!mapping || problem) return;
    const result = parseSchedule({
      rows: mapping.rows,
      columnMap: mapping.columnMap,
      fleets,
      startSequence,
      untimedSequenceWhenNoStarts,
      firstRowNumber: mapping.skippedRows + 2,
    });
    setFlow({ step: 'preview', result, saving: false, error: '' });
  }

  const preview = flow.step === 'preview' ? flow : null;

  async function confirm() {
    if (!preview || preview.saving || preview.result.races.length === 0) return;
    setFlow({ ...preview, saving: true, error: '' });
    try {
      await onConfirm(preview.result.races);
      reset();
    } catch (err) {
      setFlow({ ...preview, saving: false, error: describeFailure(err) });
    }
  }

  /** One line per start: its gun, then its fleets. */
  function startLines(race: ImportedRace): string[] {
    if (race.starts.length === 0) return ['—'];
    return race.starts.map((s) => {
      const names = s.fleetIds.map((id) => fleetName.get(id) ?? '?').join(', ');
      return `${s.startTime?.slice(0, 5) ?? 'No gun time'} — ${names}`;
    });
  }

  const count = preview?.result.races.length ?? 0;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={TABULAR_IMPORT_ACCEPT}
        onChange={(e) => void handleFileSelected(e)}
        className="hidden"
        data-testid="schedule-import-input"
      />

      <SheetPickerDialog
        open={flow.step === 'pickSheet'}
        sheets={flow.step === 'pickSheet' ? flow.sheets : []}
        onCancel={reset}
        onPick={(sheet) => openMapping(sheet.rows)}
      />
      <ImportFileErrorDialog
        open={flow.step === 'fileError'}
        message={flow.step === 'fileError' ? flow.message : ''}
        onClose={reset}
      />

      <Dialog open={flow.step === 'mapping'} onOpenChange={(open) => { if (!open) reset(); }}>
        <DialogContent className="max-w-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import schedule — map columns</DialogTitle>
            <DialogDescription>
              One row per race. Give each race its date, and its guns either in one Start
              column, run through the default start sequence, or in a column for each fleet —
              where a blank or a dash means that fleet doesn’t sail the race, and ASAP or TBC
              is a start with no gun time yet.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {mapping && <SkippedRowsNote count={mapping.skippedRows} />}
            {mapping && (
              <div className="overflow-x-auto">
                <Table className="table-fixed min-w-[32rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/4">Column</TableHead>
                      <TableHead className="w-1/3">Read as</TableHead>
                      <TableHead>Sample values</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mapping.headers.map((header, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-sm truncate">
                          {header || `Column ${i + 1}`}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={mapping.columnMap[i]}
                            onValueChange={(v) =>
                              setFlow((f) =>
                                f.step === 'mapping'
                                  ? { ...f, columnMap: { ...f.columnMap, [i]: v as ScheduleField } }
                                  : f,
                              )
                            }
                          >
                            <SelectTrigger className="w-full" aria-label={`Read ${header || `column ${i + 1}`} as`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {fieldOptions.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground truncate">
                          {mapping.rows
                            .slice(0, 3)
                            .map((row) => row[i]?.trim() ?? '')
                            .filter(Boolean)
                            .join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogBody>
          {problem && <p className="text-sm text-destructive">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button onClick={runParse} disabled={problem !== null}>
              {mapping ? `Preview ${mapping.rows.length} row${mapping.rows.length === 1 ? '' : 's'}` : 'Preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={flow.step === 'preview'} onOpenChange={(open) => { if (!open && !preview?.saving) reset(); }}>
        <DialogContent className="max-w-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirm schedule import</DialogTitle>
            <DialogDescription>
              {preview?.result.tooMany
                ? `This schedule has ${preview.result.tooMany} races; one import can add at most ${MAX_GENERATED_RACES}. Split it into smaller sheets.`
                : count === 0
                  ? 'No race in this sheet can be imported.'
                  : `${count} race${count === 1 ? '' : 's'} will be added${
                      existingCount > 0 ? ` after the series’ existing ${existingCount === 1 ? 'race' : 'races'}` : ''
                    }, numbered from Race ${existingCount + 1}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {preview && preview.result.errors.length > 0 && (
              <div className="rounded-md border border-destructive/40 p-2 text-sm" data-testid="schedule-import-errors">
                <p className="font-medium">
                  {preview.result.errors.length} row{preview.result.errors.length === 1 ? '' : 's'} can’t be
                  imported and will be left out:
                </p>
                <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                  {preview.result.errors.map((e) => (
                    <li key={e.rowNumber}>
                      Row {e.rowNumber}: {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {count > 0 && (
              <div className="overflow-x-auto">
                <Table className="min-w-[32rem]" data-testid="schedule-import-preview">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Race</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Starts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview!.result.races.map((race, i) => (
                      <TableRow key={race.rowNumber}>
                        <TableCell>{existingCount + i + 1}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{race.date}</TableCell>
                        <TableCell className="whitespace-normal">{race.name ?? ''}</TableCell>
                        <TableCell className="text-xs whitespace-normal" data-testid="schedule-import-starts">
                          {startLines(race).map((line, j) => (
                            <div key={j}>{line}</div>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogBody>
          {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={reset} disabled={preview?.saving}>Cancel</Button>
            <Button onClick={() => void confirm()} disabled={count === 0 || preview?.saving}>
              {count > 0 ? `Import ${count} race${count === 1 ? '' : 's'}` : 'Import'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
