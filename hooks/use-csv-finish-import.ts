'use client';

import { log } from '@/lib/debug';
import { finishRowsFromImport } from '@/lib/finish-entry';
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';
import type { Finish } from '@/lib/types';

export interface UseCsvFinishImportArgs {
  raceId: string;
  savedFinishes: Finish[] | undefined;
  saveFinishes: { mutateAsync: (finishes: Finish[]) => Promise<unknown> };
  deleteFinish: { mutateAsync: (input: { id: string; raceId: string }) => Promise<unknown> };
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  /** Clear in-progress entry state once the import lands. */
  onApplied: () => void;
}

/**
 * Replace the finishing order, finish times, and non-finisher codes from a
 * CSV import. Destructive: deletes the existing finishes for this race
 * before writing the imported batch. State the CSV format can't express —
 * penalties, redress, ties, start check-ins — arrives already carried
 * across onto the imported rows (the preview dialog runs
 * `carryAcrossImport` and hands over the carried result), so only what the
 * scorer was shown being cleared is cleared. The imported batch is
 * authoritative by construction, so the new rows go through one bulk save
 * rather than the per-row CAS path used for interactive autosave. The
 * existing rows are still deleted one at a time pending a bulk-DELETE
 * endpoint (#110).
 */
export function useCsvFinishImport(args: UseCsvFinishImportArgs) {
  const { raceId, savedFinishes, saveFinishes, deleteFinish, patchCache, onApplied } = args;

  return async function applyCsvImport(imported: ParseFinishSheetResult) {
    const newRows = finishRowsFromImport(raceId, imported.finishes);
    const existing = savedFinishes ?? [];
    patchCache(() => newRows);
    await Promise.all(
      existing.map((f) => deleteFinish.mutateAsync({ id: f.id, raceId })),
    );
    await saveFinishes.mutateAsync(newRows);
    onApplied();
    log('result-entry', 'csv import applied', {
      finishers: imported.summary.finishers,
      coded: imported.summary.coded,
      unresolved: imported.summary.unresolved,
    });
  };
}
