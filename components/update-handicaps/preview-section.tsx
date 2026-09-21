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
import { formatRatingValue } from '@/lib/competitor-ratings';
import { CertComparison } from './cert-comparison';
import {
  SYSTEM_LABEL,
  SelectAllCheckbox,
  describeMatch,
  formatDelta,
  rowAppliesByDefault,
  rowKey,
  systemLabel,
  type RowSelection,
} from './shared';

export function PreviewSection({
  changedRows,
  unchangedRows,
  notFoundRows,
  rowSelection,
  targetCompetitorById,
  targetFleetById,
  sourceFleetById,
  onChooseCert,
}: {
  changedRows: PreviewRow[];
  unchangedRows: PreviewRow[];
  notFoundRows: PreviewRow[];
  rowSelection: RowSelection;
  targetCompetitorById: Map<string, Competitor>;
  targetFleetById: Map<string, Fleet>;
  sourceFleetById: Map<string, Fleet>;
  /** Switch which certificate a boat uses (Irish Sailing primary/secondary). */
  onChooseCert?: (competitorId: string, certId: string) => void;
}) {
  // Suppress the unused-prop warning — kept for future "source fleet" column.
  void sourceFleetById;

  // Every change applies unless unticked, so the header box reads "all in" on
  // arrival and is there to clear them — the scorer re-running a source to
  // pick up one boat's new certificate wants none of the rest. It governs only
  // the rows that apply by default: a name-only match has to be ticked in one
  // at a time, which a select-all that swept it up would defeat.
  const selectableRows = changedRows.filter(rowAppliesByDefault);
  const includedCount = selectableRows.filter((r) => rowSelection.applies(r)).length;

  const summary = `Preview: ${changedRows.length} change${changedRows.length === 1 ? '' : 's'}, ${unchangedRows.length} unchanged, ${notFoundRows.length} not found`;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{summary}</div>

      {changedRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                {selectableRows.length > 0 && (
                  <SelectAllCheckbox
                    selectedCount={includedCount}
                    total={selectableRows.length}
                    onToggleAll={(on) => rowSelection.toggleAllRows(selectableRows, on)}
                  />
                )}
              </TableHead>
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
              const included = rowSelection.applies(r);
              return (
                <TableRow key={key}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => rowSelection.toggleRow(r, e.target.checked)}
                      className="h-3.5 w-3.5"
                      aria-label={`Apply the change to ${comp?.sailNumber ?? ''}`}
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
                    {/* The sail number did not make this match by itself, so
                        the boat it landed on is shown beside the entry. */}
                    {r.match && r.ircCert && (
                      <CertComparison competitor={comp} cert={r.ircCert} />
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
                            {o.tcc !== null ? ` — ${formatRatingValue(o.tcc, 'irc')}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell>{fleet?.name}</TableCell>
                  <TableCell>{systemLabel(r)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRatingValue(r.currentTcf, r.system)} → {formatRatingValue(r.newTcf, r.system)}
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
