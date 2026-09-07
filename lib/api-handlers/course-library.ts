import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import {
  seriesCourseInputSchema,
  seriesCoursesBulkInputSchema,
  seriesMarkInputSchema,
  seriesMarksBulkInputSchema,
} from '@/lib/validation/course-library';
import type { SeriesCourse, SeriesMark } from '@/lib/types';

/**
 * The course library (ORC constructed courses): a series' marks and the
 * courses built from them. Both are plain named collections with an upsert
 * apiece; the one rule the handlers enforce beyond the schema is that a mark
 * a course still names cannot be deleted (a 400 naming the courses — not a
 * 409, which the client reserves for version conflicts), and that a course
 * names only marks of its own series. Starts keep their own snapshot of a course, so a course
 * may be deleted while starts still reference it.
 */

async function assertSeriesInWorkspace(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const series = await repos.series.get(seriesId);
  if (!series) throw new NotFoundError('series');
}

// ─── Marks ───────────────────────────────────────────────────────────────────

export async function listSeriesMarks(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<SeriesMark[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.seriesMarks.listBySeries(seriesId);
}

/** A laid mark's origin must be a mark of the same series; otherwise the
 *  provenance is dropped rather than left pointing across series. */
function sanitizeFrom(
  from: SeriesMark['from'],
  seriesMarkIds: Set<string>,
  selfId: string,
): SeriesMark['from'] {
  if (!from) return undefined;
  if (!seriesMarkIds.has(from.markId) || from.markId === selfId) return undefined;
  return from;
}

export async function putSeriesMark(
  workspace: WorkspaceContext,
  seriesId: string,
  pathMarkId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<SeriesMark> {
  await assertSeriesWritable(workspace, seriesId);
  const input = seriesMarkInputSchema.parse(body);
  const id = input.id ?? pathMarkId;
  if (id !== pathMarkId) throw new NotFoundError('mark id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('mark series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [existing, marks] = await Promise.all([
    repos.seriesMarks.get(id),
    repos.seriesMarks.listBySeries(seriesId),
  ]);
  const from = sanitizeFrom(input.from, new Set(marks.map((m) => m.id)), id);
  const saved = await repos.seriesMarks.save(
    { ...input, id, ...(from ? { from } : { from: undefined }) },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackChange(workspace, {
    action: existing ? 'mark.updated' : 'mark.created',
    seriesId,
    summary: existing ? `Updated mark ${saved.name}` : `Added mark ${saved.name}`,
    sessionKey: 'course-library',
    dedupeKey: existing ? `mark:${id}` : undefined,
  });
  return saved;
}

/** Bulk upsert — card adoption writes a set's marks in one request. */
export async function putSeriesMarks(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SeriesMark[]> {
  await assertSeriesWritable(workspace, seriesId);
  const input = seriesMarksBulkInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const marks: SeriesMark[] = input.marks.map((m) => {
    if (m.seriesId !== seriesId) throw new NotFoundError('mark series mismatch');
    return { ...m, id: m.id ?? crypto.randomUUID() };
  });
  const ids = new Set(marks.map((m) => m.id));
  const existingIds = new Set((await repos.seriesMarks.listBySeries(seriesId)).map((m) => m.id));
  for (const m of marks) {
    const from = sanitizeFrom(m.from, new Set([...ids, ...existingIds]), m.id);
    if (from) m.from = from;
    else delete m.from;
  }
  await repos.seriesMarks.saveMany(marks, { updatedBy: workspace.userId });
  if (marks.length > 0) {
    const fresh = marks.filter((m) => !existingIds.has(m.id)).length;
    await trackChange(workspace, {
      action: fresh > 0 ? 'mark.created' : 'mark.updated',
      seriesId,
      summary:
        fresh > 0
          ? `Added ${fresh} mark${fresh === 1 ? '' : 's'}${marks[0].card ? ' from the course card' : ''}`
          : `Updated ${marks.length} mark${marks.length === 1 ? '' : 's'}`,
      sessionKey: 'course-library',
    });
  }
  return repos.seriesMarks.listBySeries(seriesId);
}

/**
 * Remove a mark. Refused while a course names it — the caller is
 * told which courses, and deletes or edits those first. Starts are not
 * consulted: their snapshots carry the position.
 */
export async function deleteSeriesMark(
  workspace: WorkspaceContext,
  seriesId: string,
  markId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.seriesMarks.get(markId);
  if (!existing || existing.seriesId !== seriesId) return;
  const users = (await repos.seriesCourses.listBySeries(seriesId)).filter((c) =>
    c.marks.some((cm) => cm.markId === markId),
  );
  if (users.length > 0) {
    // Structured, like the publish dialog's slug clash: the client names the
    // courses in its own words.
    throw new BadRequestError('mark in use', {
      code: 'mark-in-use',
      courses: users.map((c) => c.name),
    });
  }
  await repos.seriesMarks.delete(markId);
  await trackChange(workspace, {
    action: 'mark.deleted',
    seriesId,
    summary: `Removed mark ${existing.name}`,
    sessionKey: 'course-library',
  });
}

/** Raw collection delete (the file-import replace path). Courses go first:
 *  they name the marks. */
export async function bulkDeleteSeriesMarks(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.seriesCourses.deleteBySeries(seriesId);
  await repos.seriesMarks.deleteBySeries(seriesId);
  await trackChange(workspace, {
    action: 'marks.cleared',
    seriesId,
    summary: 'Cleared the course library',
    sessionKey: 'course-library',
  });
}

// ─── Courses ─────────────────────────────────────────────────────────────────

export async function listSeriesCourses(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<SeriesCourse[]> {
  await assertSeriesInWorkspace(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.seriesCourses.listBySeries(seriesId);
}

/** A course names only marks of its own series; an entry naming anything
 *  else is dropped rather than written dangling. */
function sanitizeSequence(
  marks: SeriesCourse['marks'],
  seriesMarkIds: Set<string>,
): SeriesCourse['marks'] {
  return marks.filter((cm) => seriesMarkIds.has(cm.markId));
}

export async function putSeriesCourse(
  workspace: WorkspaceContext,
  seriesId: string,
  pathCourseId: string,
  body: unknown,
  opts?: { expectedVersion?: number },
): Promise<SeriesCourse> {
  await assertSeriesWritable(workspace, seriesId);
  const input = seriesCourseInputSchema.parse(body);
  const id = input.id ?? pathCourseId;
  if (id !== pathCourseId) throw new NotFoundError('course id mismatch');
  if (input.seriesId !== seriesId) throw new NotFoundError('course series mismatch');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [existing, marks] = await Promise.all([
    repos.seriesCourses.get(id),
    repos.seriesMarks.listBySeries(seriesId),
  ]);
  const saved = await repos.seriesCourses.save(
    { ...input, id, marks: sanitizeSequence(input.marks, new Set(marks.map((m) => m.id))) },
    { expectedVersion: opts?.expectedVersion, updatedBy: workspace.userId },
  );
  await trackChange(workspace, {
    action: existing ? 'course.updated' : 'course.created',
    seriesId,
    summary: existing
      ? existing.name !== saved.name
        ? `Renamed course ${existing.name} to ${saved.name}`
        : `Updated course ${saved.name}`
      : `Added course ${saved.name}`,
    sessionKey: 'course-library',
    dedupeKey: existing ? `course:${id}` : undefined,
  });
  return saved;
}

/** Bulk upsert (file replay). */
export async function putSeriesCourses(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SeriesCourse[]> {
  await assertSeriesWritable(workspace, seriesId);
  const input = seriesCoursesBulkInputSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const markIds = new Set((await repos.seriesMarks.listBySeries(seriesId)).map((m) => m.id));
  const courses: SeriesCourse[] = input.courses.map((c) => {
    if (c.seriesId !== seriesId) throw new NotFoundError('course series mismatch');
    return { ...c, id: c.id ?? crypto.randomUUID(), marks: sanitizeSequence(c.marks, markIds) };
  });
  await repos.seriesCourses.saveMany(courses, { updatedBy: workspace.userId });
  if (courses.length > 0) {
    await trackChange(workspace, {
      action: 'course.updated',
      seriesId,
      summary: `Updated ${courses.length} course${courses.length === 1 ? '' : 's'}`,
      sessionKey: 'course-library',
    });
  }
  return repos.seriesCourses.listBySeries(seriesId);
}

/** Remove a course. Starts that sailed it keep their snapshot and its name. */
export async function deleteSeriesCourse(
  workspace: WorkspaceContext,
  seriesId: string,
  courseId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.seriesCourses.get(courseId);
  if (!existing || existing.seriesId !== seriesId) return;
  await repos.seriesCourses.delete(courseId);
  await trackChange(workspace, {
    action: 'course.deleted',
    seriesId,
    summary: `Removed course ${existing.name}`,
    sessionKey: 'course-library',
  });
}

/** Raw collection delete (the file-import replace path). */
export async function bulkDeleteSeriesCourses(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.seriesCourses.deleteBySeries(seriesId);
  await trackChange(workspace, {
    action: 'courses.cleared',
    seriesId,
    summary: 'Cleared all courses',
    sessionKey: 'course-library',
  });
}
