/**
 * The Record finishes page, as pure logic: the races a recorder picks from,
 * and a recording taken down on the Finish tab turned into a submission
 * upload and back. Client-safe.
 */

import type { Candidate } from './finish-sheet-csv';
import { finishRowsFromImport } from './finish-entry';
import { readSubmission } from './finish-submission';
import { normalizeTimeInput } from './time-parse';
import type { Finish, FinishSubmission, SubmittedFinish } from './types';
import type { SubmitFinishesInput } from './validation/finish-submission';

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

/**
 * A submission as the finish rows the Finish tab edits, read the way the
 * scorer's review reads it: a sail number that has since been entered
 * matches its boat, and a row the review would leave out is left out here.
 */
export function sheetFromSubmission(
  raceId: string,
  submission: Pick<FinishSubmission, 'finishes'>,
  candidates: Candidate[],
  sailNumberOf: (competitorId: string) => string | undefined,
): Finish[] {
  return finishRowsFromImport(raceId, readSubmission(submission.finishes, candidates, sailNumberOf).finishes);
}

/** The recording's lines as an upload carries them: the finishers in
 *  crossing order, then the boats given a code. A start check-in with
 *  neither is no line of the sheet. */
export function submittedFinishes(finishes: readonly Finish[]): SubmittedFinish[] {
  const placed = finishes.filter((f) => f.sortOrder !== null).sort((a, b) => a.sortOrder! - b.sortOrder!);
  const coded = finishes.filter((f) => f.sortOrder === null && f.resultCode);
  return [...placed, ...coded].map((f) => ({
    id: f.id,
    competitorId: f.competitorId,
    sailNumber: f.competitorId ? null : (f.unknownSailNumber ?? null),
    finishTime: f.finishTime ?? null,
    elapsedSecs: f.elapsedSecs ?? null,
    ...(f.laps != null ? { laps: f.laps } : {}),
    resultCode: f.resultCode ?? null,
  }));
}

/**
 * The upload for the recording as it stands, at `revision`, with the start
 * times the recorder filled in (by start id; blank ones are left out). The
 * problems name the start times that can't be sent yet.
 */
export function uploadOf(args: {
  finishes: readonly Finish[];
  startTimes: Readonly<Record<string, string>>;
  recordedBy: string;
  complete: boolean;
  revision: number;
}): { input: SubmitFinishesInput; problems: string[] } {
  const problems: string[] = [];
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
      finishes: submittedFinishes(args.finishes).map((f) => ({
        ...f,
        resultCode: f.resultCode as SubmitFinishesInput['finishes'][number]['resultCode'],
      })),
      complete: args.complete,
    },
    problems,
  };
}
