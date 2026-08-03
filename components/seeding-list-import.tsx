'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImportFileErrorDialog, SheetPickerDialog } from '@/components/import-file-dialogs';
import { useSaveCompetitors } from '@/hooks/use-competitors';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import { TABULAR_IMPORT_ACCEPT, parseTabularFile, type WorkbookSheet } from '@/lib/import-table';
import {
  autoDetectSeedingColumn,
  planSeedingImport,
  type SeedingColumn,
  type SeedingListRow,
  type SeedingPlan,
} from '@/lib/seeding-list';
import type { Competitor } from '@/lib/types';

export interface SeedingListImportHandle {
  trigger: () => void;
}

const COLUMN_LABELS: Record<SeedingColumn, string> = {
  rank: 'Rank',
  worldSailingId: 'World Sailing ID',
  name: 'Sailor name',
  nationality: 'Nation',
  ignore: '(ignore)',
};

type Flow =
  | { step: 'idle' }
  | { step: 'fileError'; message: string }
  | { step: 'pickSheet'; sheets: WorkbookSheet[] }
  | {
      step: 'mapping';
      headers: string[];
      dataRows: string[][];
      columnMap: Record<number, SeedingColumn>;
    }
  | {
      step: 'review';
      plan: SeedingPlan;
      /** Suggestions the scorer has accepted, keyed by source row number. */
      accepted: Set<number>;
    }
  | { step: 'done'; seeded: number; cleared: number };

/**
 * Import an organising authority's seed ranking and write each matched
 * sailor's seeding rank.
 *
 * Lives on the Competitors tab rather than with the split-fleet ceremonies:
 * a seeding rank is a property of the entry list, and a scorer may well want
 * one recorded — for a start order, for a ladder, or simply because the OA
 * sent one — at an event that never splits into qualifying fleets.
 */
export const SeedingListImport = forwardRef<SeedingListImportHandle, {
  competitors: Competitor[];
}>(function SeedingListImport({ competitors }, ref) {
  const saveCompetitors = useSaveCompetitors();
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ trigger: () => fileInputRef.current?.click() }));

  const byId = new Map(competitors.map((c) => [c.id, c]));

  function openMapping(allRows: string[][]) {
    if (allRows.length < 2) {
      setFlow({ step: 'fileError', message: 'That file has no rows below its header.' });
      return;
    }
    const headers = allRows[0];
    const columnMap: Record<number, SeedingColumn> = {};
    headers.forEach((h, i) => { columnMap[i] = autoDetectSeedingColumn(h); });
    setFlow({ step: 'mapping', headers, dataRows: allRows.slice(1), columnMap });
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = await parseTabularFile(file);
    if (parsed.kind === 'error') setFlow({ step: 'fileError', message: parsed.message });
    else if (parsed.kind === 'workbook') setFlow({ step: 'pickSheet', sheets: parsed.sheets });
    else openMapping(parsed.rows);
  }

  function buildPlan(dataRows: string[][], columnMap: Record<number, SeedingColumn>) {
    const col = (role: SeedingColumn): number | undefined => {
      const hit = Object.entries(columnMap).find(([, r]) => r === role);
      return hit ? parseInt(hit[0], 10) : undefined;
    };
    const rankCol = col('rank');
    const idCol = col('worldSailingId');
    const nameCol = col('name');
    const natCol = col('nationality');
    const rows: SeedingListRow[] = dataRows.map((row, i) => ({
      rowNumber: i + 2,  // 1-based, past the header
      rank: rankCol != null ? parseInt((row[rankCol] ?? '').trim(), 10) : NaN,
      ...(idCol != null && row[idCol]?.trim() ? { worldSailingId: row[idCol].trim() } : {}),
      ...(nameCol != null && row[nameCol]?.trim() ? { name: row[nameCol].trim() } : {}),
      ...(natCol != null && row[natCol]?.trim() ? { nationality: row[natCol].trim() } : {}),
    }));
    return planSeedingImport(rows, competitors);
  }

  async function apply(plan: SeedingPlan, accepted: Set<number>) {
    const toApply = [
      ...plan.matched,
      ...plan.suggested.filter((s) => accepted.has(s.row.rowNumber)),
    ];
    const seedByCompetitor = new Map(toApply.map((m) => [m.competitorId, m.row.rank]));
    const updates: Competitor[] = [];
    let cleared = 0;
    for (const c of competitors) {
      const seed = seedByCompetitor.get(c.id);
      if (seed != null) {
        if (c.seed !== seed) updates.push({ ...c, seed });
      } else if (c.seed != null) {
        // A re-import of a revised ranking replaces rather than merges: a
        // sailor dropped from the ranking should not keep the rank an earlier
        // version of it gave them.
        const { seed: _dropped, ...rest } = c;
        void _dropped;
        updates.push(rest);
        cleared += 1;
      }
    }
    if (updates.length > 0) await saveCompetitors.mutateAsync(updates);
    setFlow({ step: 'done', seeded: toApply.length, cleared });
  }

  const competitorLabel = (id: string) => {
    const c = byId.get(id);
    if (!c) return id;
    const name = formatPrimaryNames(c.names);
    return c.sailNumber ? `${name} (${c.sailNumber})` : name;
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={TABULAR_IMPORT_ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        Import seeding list
      </Button>

      {flow.step === 'fileError' && (
        <ImportFileErrorDialog
          open
          message={flow.message}
          onClose={() => setFlow({ step: 'idle' })}
        />
      )}

      {flow.step === 'pickSheet' && (
        <SheetPickerDialog
          open
          sheets={flow.sheets}
          onPick={(sheet) => openMapping(sheet.rows)}
          onCancel={() => setFlow({ step: 'idle' })}
        />
      )}

      {flow.step === 'mapping' && (
        <Dialog open onOpenChange={() => setFlow({ step: 'idle' })}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Import seeding list</DialogTitle>
              <DialogDescription>
                Match the ranking&apos;s columns. The World Sailing ID is what the sailors
                are matched on; name and nation are used only to suggest a match
                where an ID is missing.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {flow.headers.map((header, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-1/2 truncate text-sm" title={header}>{header || `Column ${i + 1}`}</span>
                  <select
                    className="border rounded-md px-2 py-1 text-sm bg-background"
                    aria-label={`Column ${header || i + 1}`}
                    value={flow.columnMap[i]}
                    onChange={(e) =>
                      setFlow({
                        ...flow,
                        columnMap: { ...flow.columnMap, [i]: e.target.value as SeedingColumn },
                      })
                    }
                  >
                    {(Object.keys(COLUMN_LABELS) as SeedingColumn[]).map((role) => (
                      <option key={role} value={role}>{COLUMN_LABELS[role]}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFlow({ step: 'idle' })}>Cancel</Button>
              <Button
                disabled={!Object.values(flow.columnMap).includes('rank')}
                onClick={() =>
                  setFlow({
                    step: 'review',
                    plan: buildPlan(flow.dataRows, flow.columnMap),
                    accepted: new Set(),
                  })
                }
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {flow.step === 'review' && (
        <Dialog open onOpenChange={() => setFlow({ step: 'idle' })}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Review the seeding</DialogTitle>
              <DialogDescription>
                {flow.plan.matched.length} matched on their World Sailing ID.
                Applying replaces every seeding rank in this series — a sailor
                the ranking doesn&apos;t list ends up with none.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto space-y-4 text-sm">
              {flow.plan.suggested.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">
                    Matched on name and nation — check before accepting
                  </h3>
                  {flow.plan.suggested.map((s) => (
                    <label key={s.row.rowNumber} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={flow.accepted.has(s.row.rowNumber)}
                        onChange={(e) => {
                          const next = new Set(flow.accepted);
                          if (e.target.checked) next.add(s.row.rowNumber);
                          else next.delete(s.row.rowNumber);
                          setFlow({ ...flow, accepted: next });
                        }}
                      />
                      <span>
                        <span className="font-mono">{s.row.rank}</span>{' '}
                        {s.row.name}{s.row.nationality ? ` (${s.row.nationality})` : ''} →{' '}
                        {competitorLabel(s.competitorId)}
                      </span>
                    </label>
                  ))}
                </section>
              )}

              {flow.plan.unrankedCompetitorIds.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">
                    Not in the ranking ({flow.plan.unrankedCompetitorIds.length})
                  </h3>
                  <p className="text-muted-foreground">
                    These sailors get no seeding rank, so they sort below every ranked
                    one.
                  </p>
                  <ul className="list-disc pl-5">
                    {flow.plan.unrankedCompetitorIds.map((id) => (
                      <li key={id}>{competitorLabel(id)}</li>
                    ))}
                  </ul>
                </section>
              )}

              {flow.plan.unmatchedRows.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">
                    Ranking rows matching nobody ({flow.plan.unmatchedRows.length})
                  </h3>
                  <p className="text-muted-foreground">
                    Normal: a ranking covers a class, an entry list covers an event.
                  </p>
                </section>
              )}

              {flow.plan.rejected.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">Rows skipped ({flow.plan.rejected.length})</h3>
                  <ul className="list-disc pl-5">
                    {flow.plan.rejected.map((r) => (
                      <li key={r.row.rowNumber}>Row {r.row.rowNumber}: {r.reason}</li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setFlow({ step: 'idle' })}>Cancel</Button>
              <Button
                disabled={saveCompetitors.isPending}
                onClick={() => void apply(flow.plan, flow.accepted)}
              >
                Apply seeding
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {flow.step === 'done' && (
        <Dialog open onOpenChange={() => setFlow({ step: 'idle' })}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Seeding imported</DialogTitle>
              <DialogDescription>
                {flow.seeded} competitor{flow.seeded === 1 ? '' : 's'} seeded
                {flow.cleared > 0 ? `; ${flow.cleared} left without a seeding rank` : ''}.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setFlow({ step: 'idle' })}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
});
