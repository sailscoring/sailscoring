'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { HandicapUpdateRow } from '@/lib/api-repository';
import { classKey, ryaPyMatcher } from '@/lib/rya-py/class-match';
import type { RyaPyClass } from '@/lib/rya-py/types';
import type { PyClassProposal } from '@/lib/source-handicaps';
import type { Competitor } from '@/lib/types';

const TIER_LABEL: Partial<Record<RyaPyClass['tier'], string>> = {
  experimental: 'experimental',
  'limited-data': 'limited data',
};

/** Whether a resolved proposal can rename any of its boats (their stored class
 *  differs from the canonical name) and/or change any PY number. */
export function ryaPyChanges(
  p: PyClassProposal,
  competitorById: Map<string, Competitor>,
): { canRename: boolean; canSetNumber: boolean } {
  const r = p.resolved;
  if (!r) return { canRename: false, canSetNumber: false };
  return {
    canRename: p.affected.some((a) => competitorById.get(a.competitorId)?.boatClass !== r.name),
    canSetNumber: p.affected.some((a) => a.currentNumber !== r.number),
  };
}

/** Fan resolved PY proposals out to per-competitor update rows, honouring the
 *  per-class rename/number toggles (a key in the `off` sets is switched off).
 *  Only boats with a real change are included. */
export function buildRyaPyUpdates(
  proposals: PyClassProposal[],
  competitorById: Map<string, Competitor>,
  renameOff: Set<string>,
  numberOff: Set<string>,
): HandicapUpdateRow[] {
  const rows: HandicapUpdateRow[] = [];
  for (const p of proposals) {
    const r = p.resolved;
    if (!r) continue;
    const { canRename, canSetNumber } = ryaPyChanges(p, competitorById);
    const renameApplied = canRename && !renameOff.has(p.enteredKey);
    const numberApplied = canSetNumber && !numberOff.has(p.enteredKey);
    if (!renameApplied && !numberApplied) continue;

    for (const a of p.affected) {
      const comp = competitorById.get(a.competitorId);
      if (!comp || comp.version === undefined) continue;
      const needNumber = numberApplied && a.currentNumber !== r.number;
      const needRename = renameApplied && comp.boatClass !== r.name;
      if (!needNumber && !needRename) continue;
      const row: HandicapUpdateRow = { competitorId: comp.id, expectedVersion: comp.version };
      if (needNumber) row.pyNumber = r.number;
      if (needRename) row.boatClass = r.name;
      rows.push(row);
    }
  }
  return rows;
}

/** The current PY number shared across a proposal's boats, or a marker when
 *  they disagree / are unset. */
function currentNumberDisplay(p: PyClassProposal): string {
  const distinct = new Set(p.affected.map((a) => a.currentNumber));
  if (distinct.size === 1) {
    const [only] = distinct;
    return only === null ? '—' : String(only);
  }
  return 'varies';
}

export function RyaPyPreview({
  proposals,
  targetCompetitorById,
  renameOff,
  numberOff,
  onToggleRename,
  onToggleNumber,
  onChoose,
}: {
  proposals: PyClassProposal[];
  targetCompetitorById: Map<string, Competitor>;
  renameOff: Set<string>;
  numberOff: Set<string>;
  /** `on` = apply this half (remove the class from the off-set). */
  onToggleRename: (key: string, on: boolean) => void;
  onToggleNumber: (key: string, on: boolean) => void;
  /** Resolve an ambiguous/unmatched class: value is a class key, or `'__skip__'`. */
  onChoose: (key: string, value: string) => void;
}) {
  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No PY fleets with classed boats in this series.
      </p>
    );
  }

  const resolvedCount = proposals.filter((p) => p.resolved).length;
  const unresolved = proposals.length - resolvedCount;
  const summary = `${proposals.length} class${proposals.length === 1 ? '' : 'es'} in PY fleets${
    unresolved > 0 ? `, ${unresolved} needing a match` : ''
  }`;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{summary}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Class (entered)</TableHead>
            <TableHead>RYA class</TableHead>
            <TableHead className="text-right">PY number</TableHead>
            <TableHead>Apply</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map((p) => {
            const r = p.resolved;
            const { canRename, canSetNumber } = ryaPyChanges(p, targetCompetitorById);
            const renameApplied = canRename && !renameOff.has(p.enteredKey);
            const numberApplied = canSetNumber && !numberOff.has(p.enteredKey);
            const showPicker = p.matchStatus !== 'matched';
            const options = p.matchStatus === 'ambiguous' ? p.candidates : ryaPyMatcher.all();

            return (
              <TableRow key={p.enteredKey}>
                <TableCell>
                  {p.enteredClass}
                  <span className="block text-xs text-muted-foreground">
                    {p.affected.length} boat{p.affected.length === 1 ? '' : 's'}
                  </span>
                </TableCell>
                <TableCell>
                  {showPicker ? (
                    <select
                      aria-label={`RYA class for ${p.enteredClass}`}
                      value={r ? classKey(r) : ''}
                      onChange={(e) => onChoose(p.enteredKey, e.target.value)}
                      className="block max-w-[16rem] rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      <option value="">
                        {p.matchStatus === 'ambiguous' ? 'Pick a class…' : 'No match — pick…'}
                      </option>
                      {options.map((c) => (
                        <option key={classKey(c)} value={classKey(c)}>
                          {c.name} ({c.number})
                          {TIER_LABEL[c.tier] ? ` · ${TIER_LABEL[c.tier]}` : ''}
                        </option>
                      ))}
                      <option value="__skip__">— skip —</option>
                    </select>
                  ) : (
                    <span>{r?.name}</span>
                  )}
                  {r && (
                    <span className="block text-xs text-muted-foreground">
                      {p.via === 'alias' && 'matched by alias'}
                      {TIER_LABEL[r.tier] && (
                        <span className="text-amber-600 dark:text-amber-500">
                          {p.via === 'alias' ? ' · ' : ''}
                          {TIER_LABEL[r.tier]} — guide only
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r ? `${currentNumberDisplay(p)} → ${r.number}` : '—'}
                </TableCell>
                <TableCell>
                  {r && (canRename || canSetNumber) ? (
                    <div className="flex flex-col gap-0.5 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={renameApplied}
                          disabled={!canRename}
                          onChange={(e) => onToggleRename(p.enteredKey, e.target.checked)}
                        />
                        Name
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={numberApplied}
                          disabled={!canSetNumber}
                          onChange={(e) => onToggleNumber(p.enteredKey, e.target.checked)}
                        />
                        Number
                      </label>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {r ? 'no change' : '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
