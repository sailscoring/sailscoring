'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PreviewRow } from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

import { formatPrimaryNames } from '@/lib/competitor-fields';
import {
  SYSTEM_LABEL,
  describeMatch,
  formatDelta,
  formatTcf,
  rowKey,
  systemLabel,
} from './shared';

export function PreviewSection({
  changedRows,
  unchangedRows,
  notFoundRows,
  excludedRowIds,
  onToggleRow,
  targetCompetitorById,
  targetFleetById,
  sourceFleetById,
  onChooseCert,
}: {
  changedRows: PreviewRow[];
  unchangedRows: PreviewRow[];
  notFoundRows: PreviewRow[];
  excludedRowIds: Set<string>;
  onToggleRow: (key: string, included: boolean) => void;
  targetCompetitorById: Map<string, Competitor>;
  targetFleetById: Map<string, Fleet>;
  sourceFleetById: Map<string, Fleet>;
  /** Switch which certificate a boat uses (Irish Sailing primary/secondary). */
  onChooseCert?: (competitorId: string, certId: string) => void;
}) {
  // Suppress the unused-prop warning — kept for future "source fleet" column.
  void sourceFleetById;

  const summary = `Preview: ${changedRows.length} change${changedRows.length === 1 ? '' : 's'}, ${unchangedRows.length} unchanged, ${notFoundRows.length} not found`;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{summary}</div>

      {changedRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Sail no.</TableHead>
              <TableHead>Boat</TableHead>
              <TableHead>Fleet</TableHead>
              <TableHead>System</TableHead>
              <TableHead className="text-right">Current → New</TableHead>
              <TableHead className="text-right">Δ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changedRows.map((r) => {
              const comp = targetCompetitorById.get(r.competitorId);
              const fleet = targetFleetById.get(r.targetFleetId);
              const key = rowKey(r);
              const included = !excludedRowIds.has(key);
              return (
                <TableRow key={key}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => onToggleRow(key, e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                  </TableCell>
                  <TableCell>{comp?.sailNumber}</TableCell>
                  <TableCell>
                    {comp?.boatName ?? formatPrimaryNames(comp?.names ?? [])}
                    {r.match && (
                      <span className="block text-xs text-amber-600 dark:text-amber-500">
                        {describeMatch(r.match)}
                      </span>
                    )}
                    {r.certChoice && onChooseCert && (
                      <select
                        aria-label="Certificate"
                        value={r.certChoice.chosen}
                        onChange={(e) => onChooseCert(r.competitorId, e.target.value)}
                        className="mt-1 block rounded border bg-background px-1 py-0.5 text-xs"
                      >
                        {r.certChoice.options.map((o) => (
                          <option key={o.certId} value={o.certId}>
                            {o.label}
                            {o.tcc !== null ? ` — ${o.tcc.toFixed(3)}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell>{fleet?.name}</TableCell>
                  <TableCell>{systemLabel(r)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTcf(r.currentTcf, r.system)} → {formatTcf(r.newTcf, r.system)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.newTcf !== null ? formatDelta(r.currentTcf, r.newTcf, r.system) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {(unchangedRows.length > 0 || notFoundRows.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {unchangedRows.length} unchanged
            {notFoundRows.length > 0 && `, ${notFoundRows.length} not found`}
          </summary>
          <div className="mt-2 space-y-2">
            {notFoundRows.length > 0 && (
              <div>
                <div className="text-muted-foreground">
                  Not found in source — will keep current handicap:
                </div>
                <ul className="ml-5 list-disc">
                  {notFoundRows.map((r) => {
                    const comp = targetCompetitorById.get(r.competitorId);
                    const fleet = targetFleetById.get(r.targetFleetId);
                    return (
                      <li key={rowKey(r)} className="text-muted-foreground">
                        {comp?.sailNumber} {comp?.boatName ?? formatPrimaryNames(comp?.names ?? [])} ({fleet?.name},{' '}
                        {SYSTEM_LABEL[r.system]}) — {r.notFoundReason?.replaceAll('-', ' ')}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
