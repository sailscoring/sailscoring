'use client';

import type { Candidate, ParseFinishSheetResult } from '@/lib/finish-sheet-csv';
import type { CarryOutcomeItem } from '@/lib/finish-entry';

/** Finishers without a time whose fleet needs one: handicap scoring over a
 *  timed start can't place a boat on corrected time without it. */
export function untimedHandicapCount(
  result: ParseFinishSheetResult,
  needsFinishTime: ((competitorId: string) => boolean) | undefined,
): number {
  if (!needsFinishTime) return 0;
  return result.finishes.filter(
    (f) =>
      f.sortOrder !== null &&
      !f.finishTime &&
      f.elapsedSecs == null &&
      f.competitorId != null &&
      needsFinishTime(f.competitorId),
  ).length;
}

/**
 * What a finish sheet about to be written says, and what writing it does:
 * the counts, the rows matched other than by sail number, the untimed
 * finishers, the rows skipped and why, and — when it replaces a race's sheet
 * — what of the current sheet carries across and what it clears. Shared by
 * a spreadsheet import, a submission's review, and a recorder's submit, so
 * each says the same things the same way.
 */
export function FinishSheetPreviewSummary({
  kind,
  result,
  candidates,
  existingFinishCount,
  outcome,
  untimedHandicap,
}: {
  /** A spreadsheet import, a scorer's review of a submission (both replace
   *  the race's sheet), or a recorder's submit (which replaces nothing). */
  kind: 'import' | 'review' | 'submit';
  result: ParseFinishSheetResult;
  candidates: readonly Candidate[];
  /** How many finishes the race's sheet has now; unused for a submit. */
  existingFinishCount: number;
  outcome: { kept: CarryOutcomeItem[]; cleared: CarryOutcomeItem[] } | null;
  untimedHandicap: number;
}) {
  const replaces = kind !== 'submit';
  const doing = kind === 'review' ? 'Applying it' : 'This import';
  const { summary } = result;
  const boatOf = (item: CarryOutcomeItem) =>
    item.competitorId
      ? candidates.find((c) => c.id === item.competitorId)?.sailNumber ?? item.competitorId
      : item.unknownSailNumber ?? '?';
  const listed = (items: CarryOutcomeItem[]) => items.map((i) => `${i.what} on ${boatOf(i)}`).join(', ');

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {summary.finishers} finisher{summary.finishers === 1 ? '' : 's'},{' '}
        {summary.coded} coded entr{summary.coded === 1 ? 'y' : 'ies'}
        {summary.unresolved > 0 && (
          <>
            {' '}({summary.unresolved} unresolved sail number{summary.unresolved === 1 ? '' : 's'})
          </>
        )}
        .
      </p>
      {summary.matchedOnBow > 0 && (
        <p className="text-sm text-muted-foreground">
          {summary.matchedOnBow} row{summary.matchedOnBow === 1 ? '' : 's'} matched on a bow
          number rather than a sail number.
        </p>
      )}
      {summary.untimed > 0 && (
        <p className="text-sm text-muted-foreground">
          {summary.untimed} finisher{summary.untimed === 1 ? ' has' : 's have'} no finish time.
          {kind === 'import' && ' If the sheet records times, check the Finish time column mapping.'}
        </p>
      )}
      {untimedHandicap > 0 && (
        <p className="text-sm font-medium text-destructive">
          {untimedHandicap} untimed finisher{untimedHandicap === 1 ? ' is' : 's are'} in a handicap fleet
          with a timed start — a finish without a time cannot be scored on corrected time.
        </p>
      )}
      {replaces && (
        <p className="text-sm text-muted-foreground">
          {kind === 'review' ? 'Applying it replaces' : 'This will replace'} the {existingFinishCount} existing finish
          {existingFinishCount === 1 ? '' : 'es'} for this race.
        </p>
      )}
      {replaces && outcome && outcome.kept.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Carried across from the current finishes: {listed(outcome.kept)}.
        </p>
      )}
      {replaces && outcome && outcome.cleared.length > 0 && (
        <p className="text-sm font-medium text-destructive">
          {doing} clears: {listed(outcome.cleared)}. Re-enter anything
          that should survive in the editor afterwards.
        </p>
      )}
      {result.warnings.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-1">
            {result.warnings.length} warning{result.warnings.length === 1 ? '' : 's'}:
          </p>
          <ul className="text-sm text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
            {result.warnings.map((w) => (
              <li key={w.rowIndex}>Row {w.rowIndex}: {w.reason}</li>
            ))}
          </ul>
        </div>
      )}
      {result.errors.length > 0 && (
        <div>
          <p className="text-sm font-medium text-destructive mb-1">
            {result.errors.length} row{result.errors.length === 1 ? '' : 's'} will be skipped:
          </p>
          <ul className="text-sm text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
            {result.errors.map((err) => (
              <li key={err.rowIndex}>Row {err.rowIndex}: {err.reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
