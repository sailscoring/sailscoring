import 'server-only';
import { and, desc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { finishSubmissions, races } from '@/lib/db/schema/series';
import type {
  FinishSubmission,
  FinishSubmissionStatus,
  SubmittedFinish,
  SubmittedStart,
} from '@/lib/types';

/**
 * Finish sheet submissions (#671), as stored: one row per submission, at its
 * current revision. Workspace-scoped like every other read and write here;
 * the handlers in `lib/api-handlers/finish-submissions.ts` decide who may do
 * what, and this module only says what happened.
 */

/** What an upload carries: the whole recording, at one revision. */
export interface SubmissionUpload {
  id: string;
  raceId: string;
  revision: number;
  recordedBy: string | null;
  starts: SubmittedStart[];
  finishes: SubmittedFinish[];
  complete: boolean;
}

export interface Submitter {
  userId: string;
  via?: { clientId: string; name: string };
}

/** Why an upload was refused rather than stored. */
export type UploadRefusal =
  /** The id is a submission for another race, or in another workspace. */
  | 'elsewhere'
  /** The id is someone else's submission. */
  | 'not-yours'
  /** A higher revision is stored, or this revision with other contents. */
  | 'stale';

export type UploadOutcome =
  | { kind: 'created' | 'revised' | 'unchanged'; submission: FinishSubmission }
  | { kind: 'refused'; refusal: UploadRefusal };

const submitter = alias(user, 'submitter');
const reviewer = alias(user, 'reviewer');

const columns = {
  row: finishSubmissions,
  seriesId: races.seriesId,
  submitterName: submitter.name,
  reviewerName: reviewer.name,
};

type Joined = {
  row: typeof finishSubmissions.$inferSelect;
  seriesId: string;
  submitterName: string | null;
  reviewerName: string | null;
};

function toSubmission(j: Joined): FinishSubmission {
  const r = j.row;
  return {
    id: r.id,
    raceId: r.raceId,
    seriesId: j.seriesId,
    revision: r.revision,
    recordedBy: r.recordedBy,
    starts: r.starts,
    finishes: r.finishes,
    complete: r.complete,
    status: r.status,
    submittedBy: r.submittedByUserId ? { id: r.submittedByUserId, name: j.submitterName } : null,
    via: r.viaClientId ? { clientId: r.viaClientId, name: r.viaName ?? r.viaClientId } : null,
    createdAt: r.createdAt.getTime(),
    submittedAt: r.submittedAt.getTime(),
    reviewedBy: r.reviewedByUserId ? { id: r.reviewedByUserId, name: j.reviewerName } : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.getTime() : null,
    reviewedRevision: r.reviewedRevision,
  };
}

async function select(workspaceId: string, where: SQL | undefined): Promise<FinishSubmission[]> {
  const rows = await getDb()
    .select(columns)
    .from(finishSubmissions)
    .innerJoin(races, eq(finishSubmissions.raceId, races.id))
    .leftJoin(submitter, eq(finishSubmissions.submittedByUserId, submitter.id))
    .leftJoin(reviewer, eq(finishSubmissions.reviewedByUserId, reviewer.id))
    .where(and(eq(finishSubmissions.workspaceId, workspaceId), where))
    .orderBy(desc(finishSubmissions.submittedAt));
  return rows.map(toSubmission);
}

export async function getSubmission(workspaceId: string, id: string): Promise<FinishSubmission | undefined> {
  const [found] = await select(workspaceId, eq(finishSubmissions.id, id));
  return found;
}

/** A race's submissions, the latest upload first. */
export async function listRaceSubmissions(workspaceId: string, raceId: string): Promise<FinishSubmission[]> {
  return select(workspaceId, eq(finishSubmissions.raceId, raceId));
}

/** A series' submissions in the given states, the latest upload first. */
export async function listSeriesSubmissions(
  workspaceId: string,
  seriesId: string,
  statuses: readonly FinishSubmissionStatus[],
): Promise<FinishSubmission[]> {
  return select(
    workspaceId,
    and(eq(races.seriesId, seriesId), inArray(finishSubmissions.status, [...statuses])),
  );
}

/** A recording in a fixed key order: `jsonb` doesn't keep the order a
 *  client sent, so a retry is recognised by content, not by text. */
function canonical(r: Pick<SubmissionUpload, 'recordedBy' | 'complete' | 'starts' | 'finishes'>): string {
  return JSON.stringify([
    r.recordedBy,
    r.complete,
    r.starts.map((s) => [s.startId, s.startTime]),
    r.finishes.map((f) => [f.id, f.competitorId, f.sailNumber, f.finishTime, f.elapsedSecs, f.resultCode]),
  ]);
}

/**
 * Store an upload. A new id is a new submission; a known one is revised when
 * the upload's revision is higher, and goes back to pending, since it's a
 * correction the scorer hasn't seen. The same revision again with the same
 * contents is a retry, and changes nothing.
 */
export async function putSubmission(
  workspaceId: string,
  upload: SubmissionUpload,
  by: Submitter,
): Promise<UploadOutcome> {
  const now = new Date();
  const inserted = await getDb()
    .insert(finishSubmissions)
    .values({
      id: upload.id,
      workspaceId,
      raceId: upload.raceId,
      revision: upload.revision,
      recordedBy: upload.recordedBy,
      starts: upload.starts,
      finishes: upload.finishes,
      complete: upload.complete,
      status: 'pending',
      submittedByUserId: by.userId,
      viaClientId: by.via?.clientId ?? null,
      viaName: by.via?.name ?? null,
      createdAt: now,
      submittedAt: now,
    })
    .onConflictDoNothing({ target: finishSubmissions.id })
    .returning({ id: finishSubmissions.id });
  if (inserted.length > 0) {
    return { kind: 'created', submission: (await getSubmission(workspaceId, upload.id))! };
  }

  // The id is taken. Another workspace's submission reads as missing here,
  // so it is refused without saying anything about it.
  const stored = await getSubmission(workspaceId, upload.id);
  if (!stored || stored.raceId !== upload.raceId) return { kind: 'refused', refusal: 'elsewhere' };
  if (stored.submittedBy?.id !== by.userId) return { kind: 'refused', refusal: 'not-yours' };
  if (upload.revision === stored.revision && canonical(stored) === canonical(upload)) {
    return { kind: 'unchanged', submission: stored };
  }
  if (upload.revision <= stored.revision) return { kind: 'refused', refusal: 'stale' };

  const updated = await getDb()
    .update(finishSubmissions)
    .set({
      revision: upload.revision,
      recordedBy: upload.recordedBy,
      starts: upload.starts,
      finishes: upload.finishes,
      complete: upload.complete,
      status: 'pending',
      viaClientId: by.via?.clientId ?? null,
      viaName: by.via?.name ?? null,
      submittedAt: new Date(),
    })
    .where(
      and(
        eq(finishSubmissions.id, upload.id),
        eq(finishSubmissions.workspaceId, workspaceId),
        // Another upload may have landed since the read: only a lower
        // revision gives way.
        lt(finishSubmissions.revision, upload.revision),
      ),
    )
    .returning({ id: finishSubmissions.id });
  if (updated.length === 0) return { kind: 'refused', refusal: 'stale' };
  return { kind: 'revised', submission: (await getSubmission(workspaceId, upload.id))! };
}

/** Withdraw a submission. Returns whether there was one to withdraw. */
export async function deleteSubmission(workspaceId: string, id: string): Promise<boolean> {
  const gone = await getDb()
    .delete(finishSubmissions)
    .where(and(eq(finishSubmissions.id, id), eq(finishSubmissions.workspaceId, workspaceId)))
    .returning({ id: finishSubmissions.id });
  return gone.length > 0;
}

/**
 * Record the scorer's decision on `revision`. Refused (null) when the
 * submission has moved on to a newer revision since the scorer looked: the
 * decision was about a recording that is no longer the current one.
 */
export async function markReviewed(
  workspaceId: string,
  id: string,
  decision: { status: Exclude<FinishSubmissionStatus, 'pending'>; revision: number; userId: string },
): Promise<FinishSubmission | null> {
  const marked = await getDb()
    .update(finishSubmissions)
    .set({
      status: decision.status,
      reviewedByUserId: decision.userId,
      reviewedAt: new Date(),
      reviewedRevision: decision.revision,
    })
    .where(
      and(
        eq(finishSubmissions.id, id),
        eq(finishSubmissions.workspaceId, workspaceId),
        eq(finishSubmissions.revision, decision.revision),
      ),
    )
    .returning({ id: finishSubmissions.id });
  return marked.length > 0 ? (await getSubmission(workspaceId, id))! : null;
}
