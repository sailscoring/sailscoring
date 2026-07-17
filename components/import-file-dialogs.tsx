'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkbookSheet } from '@/lib/import-table';

/**
 * Sheet chooser for a multi-sheet workbook import. Shown by the importers
 * only when the picked .xlsx has more than one non-empty sheet — CSVs and
 * single-sheet workbooks go straight to column mapping.
 */
export function SheetPickerDialog({
  open,
  sheets,
  onCancel,
  onPick,
}: {
  open: boolean;
  sheets: WorkbookSheet[];
  onCancel: () => void;
  onPick: (sheet: WorkbookSheet) => void;
}) {
  const [selected, setSelected] = useState(0);
  // Reset the selection whenever the dialog (re)opens, without an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSelected(0);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose a sheet</DialogTitle>
          <DialogDescription>
            This workbook has several sheets with data. Pick the one to import.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {sheets.map((sheet, i) => (
            <label
              key={sheet.name}
              className="flex items-center gap-2 text-sm cursor-pointer rounded-md border p-2"
            >
              <input
                type="radio"
                name="import-sheet"
                checked={selected === i}
                onChange={() => setSelected(i)}
                className="h-3.5 w-3.5"
              />
              <span className="flex-1 truncate">{sheet.name}</span>
              <span className="text-muted-foreground shrink-0">
                {sheet.rows.length} row{sheet.rows.length === 1 ? '' : 's'}
              </span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onPick(sheets[selected])} disabled={sheets.length === 0}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Import-file problem report (old .xls, unreadable workbook, no data). */
export function ImportFileErrorDialog({
  open,
  message,
  onClose,
}: {
  open: boolean;
  message: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Can&apos;t import this file</DialogTitle>
        </DialogHeader>
        <p className="text-sm">{message}</p>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
