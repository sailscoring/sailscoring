/**
 * The Record finishes page (#671), as pure logic: the races a recorder picks
 * from, and turning what they took down into a submission upload. Client-
 * safe.
 */

import { normalizeTimeInput } from './time-parse';
import type { FinishSubmission, SubmittedFinish } from './types';
import type { SubmitFinishesInput } from './validation/finish-submission';

/** One line of the recording as the recorder edits it. */
export interface RecordingRow {
  id: string;
  /** Set when the row came from a sheet whose sail number matched an
   *  entry; a typed row is matched by the scorer's review instead. */
  competitorId: string | null;
  sailNumber: string;
  /** As typed; normalised on submit. */
  finishTime: string;
  elapsedSecs: number | null;
  resultCode: string;
}

/** Days either side of today a recorder can pick a race from. */
export const RACE_WINDOW_DAYS = 7;

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function raceWindow(today: string): { from: string; to: string } {
  return { from: shiftDate(today, -RACE_WINDOW_DAYS), to: shiftDate(today, RACE_WINDOW_DAYS) };
}

/** Today's races first, then the days ahead in order, then the days behind,
 *  latest first: a recorder is usually after today's, or catching up. */
export function groupRaces<T extends { race: { date: string } }>(
  races: readonly T[],
  today: string,
): { today: T[]; upcoming: T[]; earlier: T[] } {
  return {
    today: races.filter((r) => r.race.date === today),
    upcoming: races.filter((r) => r.race.date > today),
    earlier: races.filter((r) => r.race.date < today).reverse(),
  };
}

export function rowsFromSubmission(
  submission: FinishSubmission,
  sailNumberOf: (competitorId: string) => string | undefined,
): RecordingRow[] {
  return submission.finishes.map((f) => ({
    id: f.id,
    competitorId: f.competitorId,
    sailNumber: f.sailNumber ?? (f.competitorId ? sailNumberOf(f.competitorId) : undefined) ?? '',
    finishTime: f.finishTime ?? '',
    elapsedSecs: f.elapsedSecs,
    resultCode: f.resultCode ?? '',
  }));
}

/** A row as the upload carries it, or why it can't be sent. */
export function submittedFinishOf(row: RecordingRow): SubmittedFinish | { problem: string } {
  const sail = row.sailNumber.trim();
  if (!row.competitorId && !sail) return { problem: 'needs a sail number' };
  let finishTime: string | null = null;
  if (!row.resultCode && row.finishTime.trim()) {
    finishTime = normalizeTimeInput(row.finishTime);
    if (!finishTime) return { problem: `“${row.finishTime.trim()}” isn’t a time (HH:MM:SS)` };
  }
  return {
    id: row.id,
    competitorId: row.competitorId,
    sailNumber: row.competitorId ? null : sail,
    finishTime,
    elapsedSecs: row.resultCode || finishTime ? null : row.elapsedSecs,
    resultCode: row.resultCode || null,
  };
}

/**
 * The upload for the rows as they stand, at `revision`, with the start
 * times the recorder filled in (by start id; blank ones are left out). The
 * problems name the rows (1-based) and starts that can't be sent yet.
 */
export function uploadOf(args: {
  rows: readonly RecordingRow[];
  startTimes: Readonly<Record<string, string>>;
  recordedBy: string;
  complete: boolean;
  revision: number;
}): { input: SubmitFinishesInput; problems: string[] } {
  const problems: string[] = [];
  const finishes: SubmittedFinish[] = [];
  args.rows.forEach((row, i) => {
    const f = submittedFinishOf(row);
    if ('problem' in f) problems.push(`Row ${i + 1} ${f.problem}.`);
    else finishes.push(f);
  });
  const starts: SubmitFinishesInput['starts'] = [];
  for (const [startId, raw] of Object.entries(args.startTimes)) {
    if (!raw.trim()) continue;
    const startTime = normalizeTimeInput(raw);
    if (!startTime) problems.push(`“${raw.trim()}” isn’t a start time (HH:MM:SS).`);
    else starts.push({ startId, startTime });
  }
  return {
    input: {
      revision: args.revision,
      recordedBy: args.recordedBy.trim() || null,
      starts,
      finishes: finishes.map((f) => ({
        id: f.id,
        competitorId: f.competitorId,
        sailNumber: f.sailNumber,
        finishTime: f.finishTime,
        elapsedSecs: f.elapsedSecs,
        resultCode: f.resultCode as SubmitFinishesInput['finishes'][number]['resultCode'],
      })),
      complete: args.complete,
    },
    problems,
  };
}
