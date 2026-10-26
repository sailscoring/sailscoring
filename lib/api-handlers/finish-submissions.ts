import 'server-only';

import { BadRequestError, NotFoundError, WouldReplaceError } from '@/app/api/v1/_lib/handler';
import { recordActivity } from '@/lib/activity-log';
import { assertRaceWritable } from '@/lib/api-handlers/series-access';
import { ForbiddenError, requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import {
  deleteSubmission,
  getSubmission,
  listRaceSubmissions,
  listSeriesSubmissions,
  markReviewed,
  putSubmission,
} from '@/lib/finish-submission-store';
import { matchOf, raceCandidates, readSubmission, type SubmissionMatch } from '@/lib/finish-submission';
import { createRepos } from '@/lib/postgres-repository';
import type { FinishSubmission, Race } from '@/lib/types';
import type { ReviewSubmissionInput, SubmitFinishesInput } from '@/lib/validation/finish-submission';

/**
 * Finish sheet submissions (#671): a recording of one race's finishes, made
 * by someone who may not be the scorer, held beside the race until a scorer
 * applies it or dismisses it. These handlers serve both the Record finishes
 * page (`/api/v1`) and race-day apps (the public API), so the rules are the
 * same whichever way a submission comes in:
 *
 * - anyone with `submit-finishes` submits, revises and withdraws their own;
 * - a scorer (`score`) reviews them; applying writes the finish sheet through
 *   the ordinary finish writes, and only then records the decision;
 * - the workspace needs the `finish-submissions` feature for any of it.
 */

export interface SubmissionReceipt {
  submission: FinishSubmission;
  match: SubmissionMatch;
}

async function raceOf(workspace: WorkspaceContext, raceId: string): Promise<Race> {
  const race = await createRepos({ workspaceId: workspace.workspaceId }).races.get(raceId);
  if (!race) throw new NotFoundError('race');
  return race;
}

const raceLabel = (race: Race) => race.name || `Race ${race.raceNumber}`;

function submitterLabel(s: FinishSubmission): string {
  const who = s.submittedBy?.name || s.recordedBy || 'someone';
  return s.via ? `${who} via ${s.via.name}` : who;
}

/** What the race's sheet would make of a submission's rows, as the review
 *  will: matched boats, unknown sail numbers, rows left out. Reads the
 *  race's entries once, for any number of submissions. */
export async function matcherFor(
  workspace: WorkspaceContext,
  race: Race,
): Promise<(finishes: FinishSubmission['finishes']) => SubmissionMatch> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [competitors, fleets, starts] = await Promise.all([
    repos.competitors.listBySeries(race.seriesId),
    repos.fleets.listBySeries(race.seriesId),
    repos.raceStarts.listByRace(race.id),
  ]);
  const fleetNames = new Map(fleets.map((f) => [f.id, f.name]));
  const sailNumbers = new Map(competitors.map((c) => [c.id, c.sailNumber]));
  const candidates = raceCandidates(competitors, starts, (id) => fleetNames.get(id));
  return (finishes) => matchOf(finishes, readSubmission(finishes, candidates, (id) => sailNumbers.get(id)));
}

/** The race, refused where the workspace has no such race. */
export async function submissionRace(workspace: WorkspaceContext, raceId: string): Promise<Race> {
  requireFeature(workspace, 'finish-submissions');
  return raceOf(workspace, raceId);
}

export async function listSubmissionsForRace(workspace: WorkspaceContext, raceId: string): Promise<FinishSubmission[]> {
  requireFeature(workspace, 'finish-submissions');
  await raceOf(workspace, raceId);
  return listRaceSubmissions(workspace.workspaceId, raceId);
}

/** A series' submissions waiting for review, for the Races tab's badges. */
export async function listPendingSubmissionsForSeries(workspace: WorkspaceContext, seriesId: string): Promise<FinishSubmission[]> {
  requireFeature(workspace, 'finish-submissions');
  const series = await createRepos({ workspaceId: workspace.workspaceId }).series.get(seriesId);
  if (!series) throw new NotFoundError('series');
  return listSeriesSubmissions(workspace.workspaceId, seriesId, ['pending']);
}

export async function getSubmissionForRace(
  workspace: WorkspaceContext,
  raceId: string,
  submissionId: string,
): Promise<SubmissionReceipt> {
  requireFeature(workspace, 'finish-submissions');
  const race = await raceOf(workspace, raceId);
  const submission = await getSubmission(workspace.workspaceId, submissionId);
  if (!submission || submission.raceId !== raceId) throw new NotFoundError('submission');
  return { submission, match: (await matcherFor(workspace, race))(submission.finishes) };
}

/**
 * Submit a recording, or revise one. The body is the whole recording; a
 * row naming a boat by id must name one entered in the series, and a start
 * time must be for one of the race's starts. A sail number that matches no
 * entry isn't an error: the scorer resolves it, as on a typed sheet.
 */
export async function submitFinishes(
  workspace: WorkspaceContext,
  raceId: string,
  submissionId: string,
  input: SubmitFinishesInput,
): Promise<SubmissionReceipt> {
  requireFeature(workspace, 'finish-submissions');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new BadRequestError('A submission id is a UUID the app chooses.');
  }
  await assertRaceWritable(workspace, raceId);
  const race = await raceOf(workspace, raceId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });

  const problems: { path: (string | number)[]; message: string }[] = [];
  const startIds = new Set((await repos.raceStarts.listByRace(raceId)).map((s) => s.id));
  const seenStarts = new Set<string>();
  input.starts.forEach((s, i) => {
    if (!startIds.has(s.startId)) problems.push({ path: ['starts', i, 'startId'], message: 'Not one of this race\'s starts.' });
    else if (seenStarts.has(s.startId)) problems.push({ path: ['starts', i, 'startId'], message: 'This start is already given a time.' });
    seenStarts.add(s.startId);
  });
  const entered = new Set((await repos.competitors.listBySeries(race.seriesId)).map((c) => c.id));
  const seenRows = new Set<string>();
  input.finishes.forEach((f, i) => {
    if (seenRows.has(f.id)) problems.push({ path: ['finishes', i, 'id'], message: 'Each row\'s id is its own.' });
    seenRows.add(f.id);
    if (f.competitorId && !entered.has(f.competitorId)) {
      problems.push({ path: ['finishes', i, 'competitorId'], message: 'No such boat entered in the series.' });
    }
  });
  if (problems.length > 0) throw new BadRequestError('The submission names something the race doesn’t have.', problems);

  const finishes = input.finishes.map((f) => ({
    id: f.id,
    competitorId: f.competitorId ?? null,
    sailNumber: f.competitorId ? null : (f.sailNumber ?? null),
    finishTime: f.finishTime ? (f.finishTime.length === 5 ? `${f.finishTime}:00` : f.finishTime) : null,
    elapsedSecs: f.elapsedSecs ?? null,
    resultCode: f.resultCode ?? null,
  }));
  const starts = input.starts.map((s) => ({
    startId: s.startId,
    startTime: s.startTime.length === 5 ? `${s.startTime}:00` : s.startTime,
  }));

  const outcome = await putSubmission(
    workspace.workspaceId,
    {
      id: submissionId,
      raceId,
      revision: input.revision,
      recordedBy: input.recordedBy || null,
      starts,
      finishes,
      complete: input.complete,
    },
    { userId: workspace.userId, ...(workspace.via ? { via: workspace.via } : {}) },
  );
  if (outcome.kind === 'refused') {
    if (outcome.refusal === 'not-yours') throw new ForbiddenError('submission-not-yours');
    if (outcome.refusal === 'elsewhere') {
      throw new WouldReplaceError('That submission id is already used for another race; choose a new one.');
    }
    const stored = await getSubmission(workspace.workspaceId, submissionId);
    throw new WouldReplaceError(
      `Revision ${stored?.revision ?? input.revision} of this submission is already stored; send a higher revision.`,
    );
  }

  if (outcome.kind !== 'unchanged') {
    const n = finishes.length;
    await recordActivity(workspace, {
      action: 'finishes.submitted',
      seriesId: race.seriesId,
      summary: `Submitted ${n} finish${n === 1 ? '' : 'es'} for ${raceLabel(race)} for review`,
      // Each revision of one submission folds into its entry.
      dedupeKey: `submission:${submissionId}`,
      metadata: { raceId, submissionId, revision: input.revision },
    });
  }
  return { submission: outcome.submission, match: (await matcherFor(workspace, race))(finishes) };
}

/** Withdraw one's own submission. */
export async function withdrawSubmission(
  workspace: WorkspaceContext,
  raceId: string,
  submissionId: string,
): Promise<void> {
  requireFeature(workspace, 'finish-submissions');
  const race = await raceOf(workspace, raceId);
  const submission = await getSubmission(workspace.workspaceId, submissionId);
  if (!submission || submission.raceId !== raceId) throw new NotFoundError('submission');
  if (submission.submittedBy?.id !== workspace.userId) throw new ForbiddenError('submission-not-yours');
  // An applied submission is the record of where the sheet came from; the
  // finishes it wrote are the scorer's now.
  if (submission.status === 'applied') {
    throw new WouldReplaceError('This submission has been applied to the finish sheet; ask the scorer to change the sheet.');
  }
  await deleteSubmission(workspace.workspaceId, submissionId);
  await recordActivity(workspace, {
    action: 'finishes.submission-withdrawn',
    seriesId: race.seriesId,
    summary: `Withdrew a finish submission for ${raceLabel(race)}`,
    metadata: { raceId, submissionId },
  });
}

/**
 * Record a scorer's decision on one revision of a submission. Applying
 * writes the finish sheet first, through the ordinary finish writes (the
 * review dialog does that, as a spreadsheet import does); this records that
 * it was applied. Refused when the submission has been revised since the
 * scorer looked, so a decision never sticks to a recording they didn't see.
 */
export async function reviewSubmission(
  workspace: WorkspaceContext,
  raceId: string,
  submissionId: string,
  input: ReviewSubmissionInput,
): Promise<FinishSubmission> {
  requireFeature(workspace, 'finish-submissions');
  const race = await raceOf(workspace, raceId);
  const existing = await getSubmission(workspace.workspaceId, submissionId);
  if (!existing || existing.raceId !== raceId) throw new NotFoundError('submission');
  const reviewed = await markReviewed(workspace.workspaceId, submissionId, {
    status: input.status,
    revision: input.revision,
    userId: workspace.userId,
  });
  if (!reviewed) {
    throw new WouldReplaceError(
      `This submission was revised (it's at revision ${existing.revision}) since revision ${input.revision} was reviewed; review it again.`,
    );
  }
  const applied = input.status === 'applied';
  await recordActivity(workspace, {
    action: applied ? 'finishes.submission-applied' : 'finishes.submission-dismissed',
    seriesId: race.seriesId,
    summary: `${applied ? 'Applied' : 'Dismissed'} finishes submitted by ${submitterLabel(reviewed)} for ${raceLabel(race)}`,
    metadata: { raceId, submissionId, revision: input.revision },
  });
  return reviewed;
}
