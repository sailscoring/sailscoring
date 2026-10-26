'use client';

import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';

import { FinishSheetPreviewSummary, untimedHandicapCount } from '@/components/finish-sheet-preview-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useReviewFinishSubmission, useRaceSubmissions } from '@/hooks/use-finish-submissions';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useSaveRaceStart } from '@/hooks/use-race-starts';
import { ConflictApiError } from '@/lib/api-client';
import { carryAcrossImport, carryOutcome } from '@/lib/finish-entry';
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';
import { diffSheets, raceCandidates, readSubmission, type SheetLine } from '@/lib/finish-submission';
import { formatRelativeTime } from '@/lib/relative-time';
import type { Competitor, Finish, FinishSubmission, Fleet, RaceStart } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Who sent a submission, as the panel and the dialog name them. */
export function submittedByLabel(s: FinishSubmission): string {
  const who = s.submittedBy?.name || s.recordedBy || 'Someone';
  return s.via ? `${who} via ${s.via.name}` : who;
}

function lineText(line: SheetLine | null): string {
  if (!line) return '—';
  if (line.code) return line.code;
  const place = line.place !== null ? `${line.place}` : '';
  return [place, line.time].filter(Boolean).join(' · ') || '—';
}

/**
 * Finish sheet submissions waiting on this race (#671): recordings of its
 * finishes made by someone who may not be the scorer, held beside the race
 * until a scorer applies one into the finish sheet or dismisses it. Renders
 * nothing while none is waiting.
 *
 * Applying goes the way a spreadsheet import does: the submission is read
 * as an imported sheet, what the sheet can't express is carried across from
 * the current finishes, and the result replaces them. The start times taken
 * on the water go onto the starts. Only then is the submission marked
 * applied, against the revision the scorer reviewed.
 */
export function FinishSubmissionsPanel({
  raceId,
  competitors,
  raceStarts,
  fleets,
  savedFinishes,
  needsFinishTime,
  applyImport,
}: {
  raceId: string;
  /** The series' competitors, under the numbers they sail in this race. */
  competitors: Competitor[];
  raceStarts: RaceStart[];
  fleets: Fleet[];
  savedFinishes: Finish[];
  needsFinishTime: (competitorId: string) => boolean;
  /** Replace the race's finishes with an imported sheet's. */
  applyImport: (result: ParseFinishSheetResult) => Promise<void>;
}) {
  const { data: submissions } = useRaceSubmissions(raceId, { enabled: true });
  const [reviewing, setReviewing] = useState<FinishSubmission | null>(null);
  const waiting = (submissions ?? []).filter((s) => s.status === 'pending');
  useShortcuts([
    {
      key: 'v',
      description: 'Review the latest finish sheet waiting for review',
      section: 'Finish entry',
      when: () => waiting.length > 0 && reviewing === null,
      handler: () => setReviewing(waiting[0]),
    },
  ]);
  if (waiting.length === 0) return null;

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3" data-testid="finish-submissions-panel">
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-primary" />
        <h3 className="font-medium text-sm">
          {waiting.length === 1 ? 'A finish sheet is' : `${waiting.length} finish sheets are`} waiting for review
        </h3>
      </div>
      <ul className="space-y-2">
        {waiting.map((s) => {
          const timed = s.finishes.filter((f) => !f.resultCode).length;
          const coded = s.finishes.length - timed;
          return (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card border px-3 py-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium">{submittedByLabel(s)}</span>
                {s.recordedBy && s.submittedBy?.name && (
                  <span className="text-muted-foreground"> · {s.recordedBy}</span>
                )}
                <span className="text-muted-foreground">
                  {' '}· {timed} finish{timed === 1 ? '' : 'es'}
                  {coded > 0 && `, ${coded} coded`} · {formatRelativeTime(s.submittedAt)}
                  {s.revision > 1 && ` · revision ${s.revision}`}
                </span>
                {!s.complete && (
                  <Badge variant="outline" className="ml-2">still recording</Badge>
                )}
                {s.reviewedRevision !== null && (
                  <Badge variant="secondary" className="ml-2">revised since review</Badge>
                )}
              </div>
              <Button size="sm" onClick={() => setReviewing(s)} title="Review (v)">Review</Button>
            </li>
          );
        })}
      </ul>
      {reviewing && (
        <ReviewDialog
          key={`${reviewing.id}:${reviewing.revision}`}
          submission={reviewing}
          competitors={competitors}
          raceStarts={raceStarts}
          fleets={fleets}
          savedFinishes={savedFinishes}
          needsFinishTime={needsFinishTime}
          applyImport={applyImport}
          onClose={() => setReviewing(null)}
        />
      )}
    </section>
  );
}

function ReviewDialog({
  submission,
  competitors,
  raceStarts,
  fleets,
  savedFinishes,
  needsFinishTime,
  applyImport,
  onClose,
}: {
  submission: FinishSubmission;
  competitors: Competitor[];
  raceStarts: RaceStart[];
  fleets: Fleet[];
  savedFinishes: Finish[];
  needsFinishTime: (competitorId: string) => boolean;
  applyImport: (result: ParseFinishSheetResult) => Promise<void>;
  onClose: () => void;
}) {
  const review = useReviewFinishSubmission();
  const saveStart = useSaveRaceStart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fleetName = useMemo(() => new Map(fleets.map((f) => [f.id, f.name])), [fleets]);
  const byId = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);
  const candidates = useMemo(
    () => raceCandidates(competitors, raceStarts, (id) => fleetName.get(id)),
    [competitors, raceStarts, fleetName],
  );
  const read = useMemo(
    () => readSubmission(submission.finishes, candidates, (id) => byId.get(id)?.sailNumber),
    [submission, candidates, byId],
  );
  const carried = useMemo(() => carryAcrossImport(savedFinishes, read.finishes), [savedFinishes, read]);
  const outcome = useMemo(() => carryOutcome(savedFinishes, carried), [savedFinishes, carried]);
  const diff = useMemo(() => diffSheets(savedFinishes, carried), [savedFinishes, carried]);
  const startChanges = submission.starts.flatMap((s) => {
    const start = raceStarts.find((r) => r.id === s.startId);
    if (!start || start.startTime === s.startTime) return [];
    return [{ start, after: s.startTime, fleets: start.fleetIds.map((id) => fleetName.get(id) ?? '?').join(', ') }];
  });
  const existingFinishCount = savedFinishes.filter((f) => f.sortOrder !== null || f.resultCode !== null).length;
  const changed = diff.filter((r) => r.changed).length;

  async function decide(status: 'applied' | 'dismissed') {
    setBusy(true);
    setError(null);
    try {
      if (status === 'applied') {
        await applyImport({ ...read, finishes: carried });
        for (const c of startChanges) await saveStart.mutateAsync({ ...c.start, startTime: c.after });
      }
      await review.mutateAsync({
        raceId: submission.raceId,
        submissionId: submission.id,
        status,
        revision: submission.revision,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof ConflictApiError
          ? status === 'applied'
            ? 'The finishes were applied, but the recorder sent a newer revision meanwhile. It is waiting for review again.'
            : 'The recorder sent a newer revision meanwhile; review that one.'
          : err instanceof Error
            ? err.message
            : 'That didn’t work.',
      );
    } finally {
      setBusy(false);
    }
  }

  const boat = (competitorId: string | null, unknown: string | null) => {
    if (!competitorId) return <span className="font-mono">{unknown}</span>;
    const c = byId.get(competitorId);
    return (
      <>
        <span className="font-mono">{c?.sailNumber ?? '?'}</span>
        {c?.boatName && <span className="text-muted-foreground"> {c.boatName}</span>}
      </>
    );
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review finishes from {submittedByLabel(submission)}</DialogTitle>
          <DialogDescription>
            {submission.recordedBy ? `${submission.recordedBy}, ` : ''}
            revision {submission.revision}, {formatRelativeTime(submission.submittedAt)}
            {!submission.complete && ' — still recording, so more may follow'}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <FinishSheetPreviewSummary
            kind="review"
            result={read}
            candidates={candidates}
            existingFinishCount={existingFinishCount}
            outcome={outcome}
            untimedHandicap={untimedHandicapCount(read, needsFinishTime)}
          />
          {startChanges.length > 0 && (
            <ul className="text-sm space-y-0.5" data-testid="submission-start-changes">
              {startChanges.map((c) => (
                <li key={c.start.id}>
                  Start for {c.fleets}: {c.start.startTime ?? 'no time'} → <span className="font-medium">{c.after}</span>
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              {changed === 0 ? 'No boat’s line changes.' : `${changed} boat${changed === 1 ? '’s line changes' : 's’ lines change'}.`}
            </p>
            <Table data-testid="submission-diff">
              <TableHeader>
                <TableRow>
                  <TableHead>Boat</TableHead>
                  <TableHead>Now</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diff.map((row) => (
                  <TableRow
                    key={row.competitorId ?? `?${row.unknownSailNumber}`}
                    className={cn(!row.changed && 'text-muted-foreground')}
                    data-changed={row.changed || undefined}
                  >
                    <TableCell>{boat(row.competitorId, row.unknownSailNumber)}</TableCell>
                    <TableCell>{lineText(row.before)}</TableCell>
                    <TableCell className={cn(row.changed && 'font-medium')}>{lineText(row.after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="outline" onClick={() => void decide('dismissed')} disabled={busy}>Dismiss</Button>
          <Button onClick={() => void decide('applied')} disabled={busy || read.finishes.length === 0}>
            {busy ? 'Applying…' : 'Apply to the finish sheet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
