/**
 * DB-backed tests for revision history capture (#166).
 *
 * Exercises `lib/revision-log.ts` against a real Postgres: an auto revision
 * inserts and reads back with its actor + snapshot; consecutive edits by the
 * same actor coalesce into one row; a stale (out-of-window) session opens a new
 * row; a different actor never coalesces; named revisions always append.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import {
  captureRevision,
  getRevisionSnapshot,
  importRevisions,
  listRevisions,
  listRevisionsForExport,
  sealOpenRevisions,
} from '@/lib/revision-log';
import type { Series } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

function makeSeries(id: string, name: string): Series {
  const now = Date.now();
  return {
    id,
    name,
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: now,
    lastSavedAt: null,
    lastModifiedAt: now,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('revision log', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let actorA: string;
  let actorB: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });

    workspaceId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Revision workspace',
      slug: `revision-${workspaceId.slice(4, 12)}`,
      createdAt: new Date(),
    });

    actorA = `usr_${uuid().replace(/-/g, '')}`;
    actorB = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values([
      { id: actorA, name: 'Mark', email: `mark-${actorA}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      { id: actorB, name: 'Sarah', email: `sarah-${actorB}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
    ]);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.seriesRevision).where(eq(schema.seriesRevision.workspaceId, workspaceId));
      await db.delete(schema.series).where(eq(schema.series.workspaceId, workspaceId));
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (actorA) await db.delete(schema.user).where(eq(schema.user.id, actorA));
    if (actorB) await db.delete(schema.user).where(eq(schema.user.id, actorB));
    await sql?.end();
  });

  /** Seed a fresh series row owned by the test workspace. */
  async function seedSeries(name: string): Promise<string> {
    const repos = createRepos({ workspaceId });
    const id = uuid();
    await repos.series.save(makeSeries(id, name));
    return id;
  }

  test('captures an auto revision with actor and a retrievable snapshot', async () => {
    const seriesId = await seedSeries('Captured Series');
    await captureRevision({ workspaceId, userId: actorA }, seriesId, {
      summary: 'Created the series',
    });

    const revs = await listRevisions({ workspaceId, userId: actorA }, seriesId);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({
      seriesId,
      kind: 'auto',
      summary: 'Created the series',
      actor: { id: actorA, displayName: 'Mark' },
    });

    const snapshot = await getRevisionSnapshot({ workspaceId, userId: actorA }, revs[0].id);
    expect(snapshot?.seriesId).toBe(seriesId);
    expect(snapshot?.series.name).toBe('Captured Series');
  });

  test('coalesces consecutive same-actor edits within the window into one row', async () => {
    const seriesId = await seedSeries('Coalesce Series');
    const actor = { workspaceId, userId: actorA };
    await captureRevision(actor, seriesId, { summary: 'edit 1' });
    await captureRevision(actor, seriesId, { summary: 'edit 2' });
    await captureRevision(actor, seriesId, { summary: 'edit 3' });

    const revs = await listRevisions(actor, seriesId);
    expect(revs).toHaveLength(1);
    // The single row reflects the latest edit.
    expect(revs[0].summary).toBe('edit 3');
  });

  test('edits with the same context key coalesce; a different key starts a new revision', async () => {
    const seriesId = await seedSeries('Context Key Series');
    const actor = { workspaceId, userId: actorA };
    await captureRevision(actor, seriesId, { summary: 'finishes a', sessionKey: 'finishes:race-1' });
    await captureRevision(actor, seriesId, { summary: 'finishes b', sessionKey: 'finishes:race-1' });
    await captureRevision(actor, seriesId, { summary: 'settings', sessionKey: 'settings' });

    const revs = await listRevisions(actor, seriesId);
    expect(revs).toHaveLength(2);
    // The finishes:race-1 pair coalesced (latest summary), settings is its own.
    expect(revs.map((r) => r.summary).sort()).toEqual(['finishes b', 'settings'].sort());
  });

  test('sealing the open revision forces the next same-key edit into a new one', async () => {
    const seriesId = await seedSeries('Seal Series');
    const actor = { workspaceId, userId: actorA };
    await captureRevision(actor, seriesId, { summary: 'before', sessionKey: 'finishes:race-1' });
    await sealOpenRevisions(workspaceId, seriesId);
    await captureRevision(actor, seriesId, { summary: 'after', sessionKey: 'finishes:race-1' });

    const revs = await listRevisions(actor, seriesId);
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.summary)).toEqual(['after', 'before']);
  });

  test('a stale session (outside the idle window) opens a new revision', async () => {
    const seriesId = await seedSeries('Stale Session Series');
    const actor = { workspaceId, userId: actorA };
    await captureRevision(actor, seriesId, { summary: 'session 1' });

    // Backdate the open revision past the 5-minute window.
    await db
      .update(schema.seriesRevision)
      .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) })
      .where(and(eq(schema.seriesRevision.seriesId, seriesId), eq(schema.seriesRevision.actorUserId, actorA)));

    await captureRevision(actor, seriesId, { summary: 'session 2' });

    const revs = await listRevisions(actor, seriesId);
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.summary)).toEqual(['session 2', 'session 1']);
  });

  test('a different actor never coalesces into another actor’s session', async () => {
    const seriesId = await seedSeries('Two Actor Series');
    await captureRevision({ workspaceId, userId: actorA }, seriesId, { summary: 'by A' });
    await captureRevision({ workspaceId, userId: actorB }, seriesId, { summary: 'by B' });

    const revs = await listRevisions({ workspaceId, userId: actorA }, seriesId);
    expect(revs).toHaveLength(2);
    expect(revs.map((r) => r.actor?.id).sort()).toEqual([actorA, actorB].sort());
  });

  test('named revisions always append, even inside the window', async () => {
    const seriesId = await seedSeries('Named Series');
    const actor = { workspaceId, userId: actorA };
    await captureRevision(actor, seriesId, { summary: 'auto edit' });
    await captureRevision(actor, seriesId, { kind: 'named', label: 'Before protest', summary: 'Checkpoint' });

    const revs = await listRevisions(actor, seriesId);
    expect(revs).toHaveLength(2);
    expect(revs.find((r) => r.kind === 'named')).toMatchObject({ label: 'Before protest' });
  });

  test('exports the history (with snapshots + actor) and re-imports it into a fresh series', async () => {
    const seriesId = await seedSeries('Export Source');
    await captureRevision({ workspaceId, userId: actorA }, seriesId, { summary: 'first' });
    await captureRevision({ workspaceId, userId: actorB }, seriesId, { kind: 'named', label: 'Pinned', summary: 'second' });

    const exported = await listRevisionsForExport({ workspaceId, userId: actorA }, seriesId);
    expect(exported).toHaveLength(2);
    // Oldest-first, full snapshots, actor display preserved on export.
    expect(exported[0].summary).toBe('first');
    expect(exported[0].snapshot.series.name).toBe('Export Source');
    expect(exported[0].actor?.displayName).toBe('Mark');
    expect(exported[1]).toMatchObject({ kind: 'named', label: 'Pinned' });

    // Re-import into a different series.
    const targetId = await seedSeries('Import Target');
    await importRevisions({ workspaceId, userId: actorA }, targetId, exported);

    const imported = await listRevisions({ workspaceId, userId: actorA }, targetId);
    expect(imported).toHaveLength(2);
    // Original timestamps and kinds survive; actor attribution is dropped.
    expect(imported.map((r) => r.kind).sort()).toEqual(['auto', 'named']);
    expect(imported.every((r) => r.actor === null)).toBe(true);
    const named = imported.find((r) => r.kind === 'named')!;
    const snap = await getRevisionSnapshot({ workspaceId, userId: actorA }, named.id);
    expect(snap?.series.name).toBe('Export Source');
  });
});
