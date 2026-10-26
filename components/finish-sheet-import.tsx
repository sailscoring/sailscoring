'use client';

import { useState, useRef, useImperativeHandle, forwardRef, useMemo } from 'react';
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
import {
  autoDetectFinishSheetField,
  parseFinishSheetCsv,
  type Candidate,
  type FinishSheetColumnMap,
  type FinishSheetField,
  type ParseFinishSheetResult,
} from '@/lib/finish-sheet-csv';
import { carryAcrossImport, carryOutcome } from '@/lib/finish-entry';
import {
  parseTabularFile,
  TABULAR_IMPORT_ACCEPT,
  type WorkbookSheet,
} from '@/lib/import-table';
import type { Finish } from '@/lib/types';
import { SheetPickerDialog, ImportFileErrorDialog } from '@/components/import-file-dialogs';
import { FinishSheetPreviewSummary, untimedHandicapCount } from '@/components/finish-sheet-preview-summary';

const FIELD_LABELS: Record<FinishSheetField, string> = {
  sailNumber: 'Sail number',
  finishTime: 'Finish time',
  elapsed: 'Elapsed time',
  resultCode: 'Result code',
  fleet: 'Class / fleet',
  ignore: '(ignore)',
};

type ImportFlow =
  | { step: 'idle' }
  | { step: 'pickSheet'; sheets: WorkbookSheet[] }
  | { step: 'fileError'; message: string }
  | {
      step: 'mapping';
      headers: string[];
      sampleRows: string[][];
      rows: string[][];
      columnMap: FinishSheetColumnMap;
    }
  | {
      step: 'preview';
      result: ParseFinishSheetResult;
    };

export interface FinishSheetImportHandle {
  /** Programmatically open the file picker. */
  trigger: () => void;
}

/**
 * Per-race finish sheet importer (CSV or .xlsx). Presents a file picker, a
 * sheet picker for multi-sheet workbooks, a column-mapping dialog, and a
 * preview dialog. On confirm, the parsed finishes are returned via
 * `onConfirm` (replace-all semantics; caller updates race state and
 * persists).
 *
 * What the sheet can't express — penalties, redress, ties, start check-ins —
 * is carried across from the race's existing finishes wherever it still
 * attaches; the preview says what carries and, more importantly, what this
 * import clears. The result handed to `onConfirm` is the carried one.
 */
export const FinishSheetImport = forwardRef<FinishSheetImportHandle, {
  candidates: Candidate[];
  /** The race's finishes as stored, for the replace warning and the carry. */
  existingFinishes: Finish[];
  /** Keyboard finish entry's gate, passed through: true when the competitor's
   *  fleet scores on handicap over a timed start, so a finish without a time
   *  cannot be scored on corrected time. Used to warn on place-only imports. */
  needsFinishTime?: (competitorId: string) => boolean;
  onConfirm: (result: ParseFinishSheetResult) => void;
  trigger?: React.ReactNode;
  /** The sheet becomes a recording to submit for review, not the race's
   *  finishes: nothing is replaced, and the preview says so. */
  submitting?: boolean;
}>(function FinishSheetImport({ candidates, existingFinishes, needsFinishTime, onConfirm, trigger, submitting = false }, ref) {
  const [flow, setFlow] = useState<ImportFlow>({ step: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    trigger: () => fileInputRef.current?.click(),
  }));

  function reset() {
    setFlow({ step: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = await parseTabularFile(file);
    if (parsed.kind === 'error') {
      setFlow({ step: 'fileError', message: parsed.message });
    } else if (parsed.kind === 'workbook') {
      setFlow({ step: 'pickSheet', sheets: parsed.sheets });
    } else {
      openMapping(parsed.rows);
    }
  }

  function openMapping(allRows: string[][]) {
    if (allRows.length < 2) {
      // No data rows — bail silently rather than opening an empty dialog.
      reset();
      return;
    }
    const headers = allRows[0];
    const dataRows = allRows.slice(1);
    const sampleRows = dataRows.slice(0, 3);
    const columnMap: FinishSheetColumnMap = {};
    headers.forEach((h, i) => {
      columnMap[i] = autoDetectFinishSheetField(h);
    });
    setFlow({ step: 'mapping', headers, sampleRows, rows: dataRows, columnMap });
  }

  function runParse() {
    if (flow.step !== 'mapping') return;
    const result = parseFinishSheetCsv({
      rows: flow.rows,
      columnMap: flow.columnMap,
      candidates,
    });
    setFlow({ step: 'preview', result });
  }

  const mapping = flow.step === 'mapping' ? flow : null;
  const hasSailMapping =
    mapping != null && Object.values(mapping.columnMap).includes('sailNumber');

  const existingFinishCount = existingFinishes.filter(
    (f) => f.sortOrder !== null || f.resultCode !== null,
  ).length;

  // The finishes that would actually be written: the parsed sheet with the
  // stored penalties, redress, ties and check-ins carried across wherever
  // they still attach — and the fate of each such item, for the preview.
  const preview = flow.step === 'preview' ? flow : null;
  const carried = useMemo(
    () => (preview ? carryAcrossImport(existingFinishes, preview.result.finishes) : null),
    [preview, existingFinishes],
  );
  const outcome = useMemo(
    () => (carried ? carryOutcome(existingFinishes, carried) : null),
    [carried, existingFinishes],
  );
  function confirmImport() {
    if (flow.step !== 'preview' || !carried) return;
    onConfirm({ ...flow.result, finishes: carried });
    reset();
  }

  const untimedHandicap =
    flow.step === 'preview' ? untimedHandicapCount(flow.result, needsFinishTime) : 0;

  return (
    <>
      {/* Trigger */}
      <span onClick={() => fileInputRef.current?.click()} className="contents">
        {trigger ?? (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Import sheet
          </Button>
        )}
      </span>
      <input
        ref={fileInputRef}
        type="file"
        accept={TABULAR_IMPORT_ACCEPT}
        onChange={(e) => void handleFileSelected(e)}
        className="hidden"
        data-testid="finish-sheet-csv-input"
      />

      {/* Multi-sheet workbook: pick the sheet, then map as usual */}
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

      {/* Mapping dialog */}
      <Dialog open={flow.step === 'mapping'} onOpenChange={(open) => { if (!open) reset(); }}>
        <DialogContent className="w-[90vw] max-w-3xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import finish sheet — map columns</DialogTitle>
            <DialogDescription>
              Match each column to a field. Sail number is required.
              Row order is the crossing order. Rows with a result code
              (DNF, DSQ, OCS, etc.) are recorded as non-finishers.
            </DialogDescription>
          </DialogHeader>
          {mapping && (
            <div className="overflow-y-auto max-h-96">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/4">Column</TableHead>
                    <TableHead className="w-1/4">Map to</TableHead>
                    <TableHead className="w-1/2">Sample values</TableHead>
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
                                ? {
                                    ...f,
                                    columnMap: { ...f.columnMap, [i]: v as FinishSheetField },
                                  }
                                : f,
                            )
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(FIELD_LABELS) as FinishSheetField[]).map((field) => (
                              <SelectItem key={field} value={field}>
                                {FIELD_LABELS[field]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground truncate">
                        {mapping.sampleRows
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
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button onClick={runParse} disabled={!hasSailMapping}>
              {mapping ? `Preview ${mapping.rows.length} row${mapping.rows.length === 1 ? '' : 's'}` : 'Preview'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <Dialog open={flow.step === 'preview'} onOpenChange={(open) => { if (!open) reset(); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Confirm finish sheet import</DialogTitle>
          </DialogHeader>
          {flow.step === 'preview' && (
            <FinishSheetPreviewSummary
              kind={submitting ? 'submit' : 'import'}
              result={flow.result}
              candidates={candidates}
              existingFinishCount={existingFinishCount}
              outcome={outcome}
              untimedHandicap={untimedHandicap}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button
              onClick={confirmImport}
              disabled={flow.step !== 'preview' || flow.result.finishes.length === 0}
            >
              {submitting ? 'Use these finishes' : 'Import and replace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
