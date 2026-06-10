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
  exportRevisions,
  importRevisions,
  listRevisions,
  sealOpenRevisions,
  thinRevisions,
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

    const exported = await exportRevisions({ workspaceId, userId: actorA }, seriesId);
    expect(exported.revisions).toHaveLength(2);
    // Oldest-first metadata; actor display preserved on export.
    expect(exported.revisions[0].summary).toBe('first');
    expect(exported.revisions[0].actor?.displayName).toBe('Mark');
    expect(exported.revisions[1]).toMatchObject({ kind: 'named', label: 'Pinned' });
    // Snapshots ride in the opaque blob, not the metadata.
    expect(exported.revisions[0]).not.toHaveProperty('snapshot');
    expect(typeof exported.revisionSnapshots).toBe('string');

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

  test('thinning drops old auto snapshot blobs by age tier, protecting milestones and the latest', async () => {
    const seriesId = await seedSeries('Thinning Series');
    const actor = { workspaceId, userId: actorA };
    const DAY = 24 * 60 * 60 * 1000;

    // Distinct sessionKeys so none coalesce; backdate each by id afterwards.
    await captureRevision(actor, seriesId, { summary: 'recent', sessionKey: 'k-recent' });
    await captureRevision(actor, seriesId, { summary: 'old40', sessionKey: 'k-old40' });
    await captureRevision(actor, seriesId, { summary: 'dayA', sessionKey: 'k-dayA' });
    await captureRevision(actor, seriesId, { summary: 'dayB', sessionKey: 'k-dayB' });
    await captureRevision(actor, seriesId, { kind: 'named', label: 'pinned', sessionKey: 'k-named' });

    const byText = (revs: Awaited<ReturnType<typeof listRevisions>>, t: string) =>
      revs.find((r) => r.summary === t || r.label === t)!;

    const initial = await listRevisions(actor, seriesId);
    async function backdate(id: string, when: Date) {
      await db.update(schema.seriesRevision).set({ createdAt: when }).where(eq(schema.seriesRevision.id, id));
    }
    const sameDay = new Date(Date.now() - 10 * DAY);
    sameDay.setUTCHours(12, 0, 0, 0);
    // 'recent' stays at ~now (newest auto). The rest are aged into the tiers.
    await backdate(byText(initial, 'old40').id, new Date(Date.now() - 40 * DAY));
    await backdate(byText(initial, 'dayA').id, sameDay); // 12:00
    await backdate(byText(initial, 'dayB').id, new Date(sameDay.getTime() + 3600_000)); // 13:00, same day
    await backdate(byText(initial, 'pinned').id, new Date(Date.now() - 40 * DAY));

    await thinRevisions(workspaceId, seriesId);

    const after = await listRevisions(actor, seriesId);
    const has = (t: string) => byText(after, t).hasSnapshot;
    expect(has('recent')).toBe(true); // <7d (and newest auto)
    expect(has('old40')).toBe(false); // >30d → dropped
    expect(has('dayB')).toBe(true); // newest of its day in the daily tier → kept
    expect(has('dayA')).toBe(false); // older same-day duplicate → dropped
    expect(has('pinned')).toBe(true); // named milestone → never thinned

    // The thinned rows survive for the timeline, just not restorable.
    expect(after).toHaveLength(5);
    expect(await getRevisionSnapshot(actor, byText(after, 'old40').id)).toBeNull();
  });

  test('reads legacy gzip and uncompressed jsonb snapshots (codec sniffing)', async () => {
    const { gzipSync } = await import('node:zlib');
    const seriesId = await seedSeries('Legacy Codec');
    const actor = { workspaceId, userId: actorA };
    const snap = {
      formatVersion: 8, seriesId, exportedAt: new Date().toISOString(),
      series: { id: seriesId, name: 'Legacy State' }, fleets: [], competitors: [], races: [],
    };

    // A round-2 gzip row (snapshot_gz holds gzip bytes).
    const gzId = uuid();
    await db.insert(schema.seriesRevision).values({
      id: gzId, workspaceId, seriesId, actorUserId: actorA, kind: 'auto',
      snapshotGz: gzipSync(Buffer.from(JSON.stringify(snap))),
    });
    // A round-1 uncompressed row (jsonb `snapshot`, no blob).
    const jsonId = uuid();
    await db.insert(schema.seriesRevision).values({
      id: jsonId, workspaceId, seriesId, actorUserId: actorA, kind: 'auto',
      snapshot: snap as never,
    });

    expect((await getRevisionSnapshot(actor, gzId))?.series.name).toBe('Legacy State');
    expect((await getRevisionSnapshot(actor, jsonId))?.series.name).toBe('Legacy State');
  });

  test('import strips a planted nested `revisions` block (and unknown keys) from a snapshot', async () => {
    const { zstdCompressSync } = await import('node:zlib');
    const seriesId = await seedSeries('Strip Target');
    const tamperedSnapshot = {
      formatVersion: 8,
      seriesId: 'x',
      exportedAt: new Date().toISOString(),
      series: { id: 'x', name: 'Tampered' },
      fleets: [],
      competitors: [],
      races: [],
      // Junk that must not survive the import:
      revisions: [{ kind: 'auto', snapshot: { deeply: 'nested' } }],
      evil: 'payload',
    };
    const revisionSnapshots = zstdCompressSync(
      Buffer.from(JSON.stringify([tamperedSnapshot])),
    ).toString('base64');

    await importRevisions({ workspaceId, userId: actorA }, seriesId, {
      revisions: [{ kind: 'auto', label: null, summary: 'tampered', createdAt: new Date().toISOString(), actor: null }],
      revisionSnapshots,
    });
    const [rev] = await listRevisions({ workspaceId, userId: actorA }, seriesId);
    const snap = await getRevisionSnapshot({ workspaceId, userId: actorA }, rev.id);
    expect(snap).not.toBeNull();
    expect(snap).not.toHaveProperty('revisions');
    expect(snap).not.toHaveProperty('evil');
    expect(snap?.series.name).toBe('Tampered');
  });
});
