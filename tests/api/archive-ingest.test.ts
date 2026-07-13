// @vitest-environment node

/**
 * The archive ingest surface (ADR-010, #283): idempotent as-published series
 * upserts with auto-publish, the convert path over a full-fidelity series,
 * read-only enforcement on the standard surface, and manifest-driven
 * archive-managed identities with the scoped auto-pass.
 *
 * Skipped when DATABASE_URL is unset. Blob storage falls back to the
 * published_blobs table locally, so publication is asserted end to end.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import { ArchivedError, BadRequestError } from '@/app/api/v1/_lib/handler';
import * as archive from '@/lib/api-handlers/archive';
import * as competitorsApi from '@/lib/api-handlers/competitors';
import * as identityApi from '@/lib/api-handlers/competitor-identity';
import { getCareerArc } from '@/lib/career-arc';
import { computeRankingStandings } from '@/lib/ranking-standings';
import type { ArchiveSeriesDoc } from '@/lib/archive-kit/format';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { hasPermission } from '@/lib/auth/permissions';
import { identityIdForSlug } from '@/lib/competitor-identity-manifest';
import { readPublishedHtml } from '@/lib/blob-storage';
import * as schema from '@/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('archive ingest', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  let ctx!: WorkspaceContext;

  const seriesId = uuid();
  const fleetId = uuid();
  const holly = uuid();
  const sean = uuid();

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_arch_${uuid().replace(/-/g, '')}`;
    ctx = {
      userId: 'archivist-user',
      email: 'archivist@sailscoring.test',
      workspaceId,
      workspaceSlug: 'arch-ws',
      role: 'archivist',
      features: [],
    };
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'archive-ingest-test',
      slug: `arch-${workspaceId.slice(9, 17)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  function doc(over: {
    name?: string;
    competitors?: ArchiveSeriesDoc['competitors'];
    rows?: ArchiveSeriesDoc['fleets'][number]['results']['rows'];
  } = {}): ArchiveSeriesDoc {
    const competitors = over.competitors ?? [
      {
        id: holly,
        fleetIds: [fleetId],
        sailNumber: 'IRL1641',
        name: 'Holly Cantwell',
        club: 'RSGYC',
      },
      {
        id: sean,
        fleetIds: [fleetId],
        sailNumber: '1605',
        name: 'Seán Murphy',
        club: 'HYC',
      },
    ];
    const rows =
      over.rows ??
      competitors.map((c, i) => ({
        competitorId: c.id,
        rank: i + 1,
        rankLabel: String(i + 1),
        leadCells: [c.sailNumber, c.name, c.club ?? ''],
        raceCells: [
          { text: String(i + 1) },
          { text: i === 0 ? '(3 DNC)' : String(i + 1), discard: i === 0 },
        ],
        summaryCells: [String(2 * i + 2), String(i + 1)],
      }));
    return {
      formatVersion: 1,
      series: {
        id: seriesId,
        name: over.name ?? 'Ulsters 2015 Optimists',
        venue: 'BYC',
        startDate: '2015-06-13',
        publishedSlug: 'iodai-ulsters-2015',
        source: 'sailwave',
      },
      fleets: [
        {
          id: fleetId,
          name: 'Main Fleet',
          subPath: 'main-fleet',
          results: {
            caption: 'Sailed: 2, Discards: 1, Entries: 2',
            leadColumns: [
              { key: 'sailno', label: 'Sail Number' },
              { key: 'helmname', label: 'Helm' },
              { key: 'club', label: 'Club' },
            ],
            raceHeaders: [{ label: 'R1' }, { label: 'R2' }],
            summaryColumns: [
              { key: 'total', label: 'Total' },
              { key: 'nett', label: 'Nett' },
            ],
            rows,
          },
        },
      ],
      competitors,
    };
  }

  test('archivist role: read + archive-ingest, nothing else', () => {
    expect(hasPermission('archivist', 'archive-ingest')).toBe(true);
    expect(hasPermission('archivist', 'read')).toBe(true);
    expect(hasPermission('archivist', 'score')).toBe(false);
    expect(hasPermission('archivist', 'manage-series')).toBe(false);
    expect(hasPermission('archivist', 'manage-workspace')).toBe(false);
    // And owners keep operator convenience.
    expect(hasPermission('owner', 'archive-ingest')).toBe(true);
  });

  test('ingest creates the series, stores results, and auto-publishes', async () => {
    const result = await archive.putArchiveSeries(ctx, seriesId, doc());
    expect(result.unchanged).toBe(false);
    expect(result.published).toEqual({
      slug: 'iodai-ulsters-2015',
      pages: [{ fleetName: 'Main Fleet', subPath: 'main-fleet' }],
    });

    const [row] = await db
      .select()
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));
    expect(row.asPublished).toBe(true);
    expect(row.asPublishedHash).toBeTruthy();
    expect(row.name).toBe('Ulsters 2015 Optimists');

    const stored = await db
      .select()
      .from(schema.asPublishedResults)
      .where(eq(schema.asPublishedResults.seriesId, seriesId));
    expect(stored).toHaveLength(1);
    expect(stored[0].results.rows).toHaveLength(2);

    // The publication exists and the page HTML carries the as-published table.
    const [pub] = await db
      .select()
      .from(schema.publishedSeries)
      .where(eq(schema.publishedSeries.seriesId, seriesId));
    expect(pub.slug).toBe('iodai-ulsters-2015');
    const html = await readPublishedHtml(pub.pages[0].blobUrl);
    expect(html).toContain('Holly Cantwell');
    expect(html).toContain('(3 DNC)');
    expect(html).toContain('Ulsters 2015 Optimists');
  });

  test('same document is a no-op; a changed one updates in place', async () => {
    const before = await db
      .select({ version: schema.series.version })
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));

    const again = await archive.putArchiveSeries(ctx, seriesId, doc());
    expect(again.unchanged).toBe(true);
    const after = await db
      .select({ version: schema.series.version })
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));
    expect(after[0].version).toBe(before[0].version);

    // Link one competitor to an identity, then re-ingest with a renamed
    // series: the row keeps its id and its identity link.
    const identityId = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: identityId,
      workspaceId,
      label: 'Holly Cantwell',
      slug: 'holly-cantwell-test',
      managedBy: 'archive',
    });
    await db
      .update(schema.competitors)
      .set({ identityId })
      .where(eq(schema.competitors.id, holly));

    const renamed = await archive.putArchiveSeries(
      ctx,
      seriesId,
      doc({ name: 'IODAI Ulsters 2015' }),
    );
    expect(renamed.unchanged).toBe(false);
    const [hollyRow] = await db
      .select({ identityId: schema.competitors.identityId })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, holly));
    expect(hollyRow.identityId).toBe(identityId);
  });

  test('the standard write surface rejects the regime with 423', async () => {
    await expect(
      competitorsApi.putCompetitor(
        { ...ctx, role: 'owner' },
        seriesId,
        holly,
        {
          id: holly,
          seriesId,
          fleetIds: [fleetId],
          sailNumber: 'IRL1641',
          name: 'Renamed By Hand',
          club: '',
          gender: '',
          age: null,
          createdAt: Date.now(),
        },
      ),
    ).rejects.toThrow(ArchivedError);
  });

  test('a competitor dropped from the document is removed', async () => {
    const one = doc();
    const only = {
      ...one,
      competitors: one.competitors.filter((c) => c.id === holly),
      fleets: [
        {
          ...one.fleets[0],
          results: {
            ...one.fleets[0].results,
            rows: one.fleets[0].results.rows.filter(
              (r) => r.competitorId === holly,
            ),
          },
        },
      ],
    };
    await archive.putArchiveSeries(ctx, seriesId, only);
    const rows = await db
      .select({ id: schema.competitors.id })
      .from(schema.competitors)
      .where(eq(schema.competitors.seriesId, seriesId));
    expect(rows.map((r) => r.id)).toEqual([holly]);
    // Restore both for later tests.
    await archive.putArchiveSeries(ctx, seriesId, doc());
  });

  test('convert: takes over a full-fidelity series, deleting its races', async () => {
    const ffId = uuid();
    const ffFleet = uuid();
    await db.insert(schema.series).values({
      id: ffId,
      workspaceId,
      name: 'Munsters 2016',
      startDate: '2016-06-01',
      displayOrder: 99,
    });
    await db.insert(schema.fleets).values({
      id: ffFleet,
      seriesId: ffId,
      workspaceId,
      name: 'Main Fleet',
      displayOrder: 0,
      scoringSystem: 'scratch',
    });
    await db.insert(schema.races).values({
      id: uuid(),
      seriesId: ffId,
      workspaceId,
      raceNumber: 1,
      date: '2016-06-01',
    });

    const compId = uuid();
    const convertDoc: ArchiveSeriesDoc = {
      formatVersion: 1,
      series: {
        id: ffId,
        name: 'Munsters 2016 Optimists',
        publishedSlug: 'iodai-munsters-2016',
      },
      fleets: [
        {
          id: ffFleet,
          name: 'Main Fleet',
          subPath: 'main-fleet',
          results: {
            leadColumns: [{ key: 'helmname', label: 'Helm' }],
            raceHeaders: [{ label: 'R1' }],
            summaryColumns: [{ key: 'nett', label: 'Nett' }],
            rows: [
              {
                competitorId: compId,
                rank: 1,
                rankLabel: '1st',
                leadCells: ['Cara Long'],
                raceCells: [{ text: '1' }],
                summaryCells: ['1'],
              },
            ],
          },
        },
      ],
      competitors: [
        { id: compId, fleetIds: [ffFleet], sailNumber: 'IRL800', name: 'Cara Long' },
      ],
    };

    // Without convert: refused.
    await expect(
      archive.putArchiveSeries(ctx, ffId, convertDoc),
    ).rejects.toThrow(BadRequestError);

    // With convert: races go, regime flips.
    await archive.putArchiveSeries(ctx, ffId, convertDoc, { convert: true });
    const races = await db
      .select({ id: schema.races.id })
      .from(schema.races)
      .where(eq(schema.races.seriesId, ffId));
    expect(races).toHaveLength(0);
    const [row] = await db
      .select({ asPublished: schema.series.asPublished })
      .from(schema.series)
      .where(eq(schema.series.id, ffId));
    expect(row.asPublished).toBe(true);
  });

  test('cross-workspace id squatting is refused', async () => {
    const otherWs = `org_arch2_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: otherWs,
      name: 'other-ws',
      slug: `arch2-${otherWs.slice(10, 18)}`,
      createdAt: new Date(),
    });
    try {
      const foreignCtx: WorkspaceContext = {
        ...ctx,
        workspaceId: otherWs,
        workspaceSlug: 'arch2-ws',
      };
      await expect(
        archive.putArchiveSeries(foreignCtx, seriesId, doc()),
      ).rejects.toThrow();
    } finally {
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, otherWs));
    }
  });

  test('manifest identities are archive-managed; auto-pass never touches live rows', async () => {
    // Reset the earlier manual link so the manifest owns Holly.
    await db
      .delete(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));

    // A full-fidelity series with an unlinked row that would cluster with
    // Seán (same name + sail): the archive pass must leave it alone.
    const liveSeries = uuid();
    const liveRow = uuid();
    await db.insert(schema.series).values({
      id: liveSeries,
      workspaceId,
      name: 'Live 2026',
      startDate: '2026-06-01',
      displayOrder: 100,
    });
    await db.insert(schema.competitors).values({
      id: liveRow,
      seriesId: liveSeries,
      workspaceId,
      fleetIds: [],
      sailNumber: '1605',
      name: 'Seán Murphy',
      club: 'HYC',
      gender: '',
      age: null,
    });

    const manifest = {
      version: 1,
      series: { 'iodai-ulsters-2015': seriesId },
      identities: [
        {
          slug: 'holly-cantwell-x1y2',
          name: 'Holly Cantwell',
          club: 'RSGYC',
          members: [['iodai-ulsters-2015', 'IRL1641']],
        },
      ],
    };
    const result = await archive.applyArchiveIdentities(ctx, manifest);
    expect(result.manifest.identitiesWritten).toBe(1);
    expect(result.manifest.competitorsLinked).toBe(1);
    // Seán (uncovered archive row) gets a drafted archive identity; the
    // convert-test's Cara too. The live row must not be linked.
    expect(result.autoPass.identitiesCreated).toBeGreaterThanOrEqual(1);

    const [hollyRow] = await db
      .select({ identityId: schema.competitors.identityId })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, holly));
    expect(hollyRow.identityId).toBe(
      identityIdForSlug(workspaceId, 'holly-cantwell-x1y2'),
    );
    const [identity] = await db
      .select()
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.id, hollyRow.identityId!));
    expect(identity.managedBy).toBe('archive');
    expect(identity.slug).toBe('holly-cantwell-x1y2');

    const [live] = await db
      .select({ identityId: schema.competitors.identityId })
      .from(schema.competitors)
      .where(eq(schema.competitors.id, liveRow));
    expect(live.identityId).toBeNull();

    // Every identity in the workspace is archive-managed — none drafted 'app'.
    const identities = await db
      .select({ managedBy: schema.competitorIdentities.managedBy })
      .from(schema.competitorIdentities)
      .where(eq(schema.competitorIdentities.workspaceId, workspaceId));
    expect(identities.every((i) => i.managedBy === 'archive')).toBe(true);
  });

  test('career arc and rankings read the stored ranks', async () => {
    const hollyIdentity = identityIdForSlug(workspaceId, 'holly-cantwell-x1y2');
    const arc = await getCareerArc(workspaceId, hollyIdentity);
    expect(arc).not.toBeNull();
    const entry = arc!.entries.find((e) => e.seriesId === seriesId);
    expect(entry).toBeDefined();
    // Holly is rank 1 of the 2 ranked rows in the stored table — read, not
    // re-scored (the series has no races at all).
    expect(entry!.rank).toBe(1);
    expect(entry!.fleetSize).toBe(2);

    const standings = await computeRankingStandings(workspaceId, {
      buckets: [
        {
          id: 'all',
          name: 'All',
          seriesIds: [seriesId],
          countBest: 1,
          requiredMin: 1,
        },
      ],
    });
    const holly = standings.result.rows.find(
      (r) => r.identityId === hollyIdentity,
    );
    expect(holly).toBeDefined();
    expect(holly!.total).toBe(1);
  });

  test('jurisdiction: the reconcile surface defers to the archive', async () => {
    const reconcileCtx: WorkspaceContext = {
      ...ctx,
      role: 'owner',
      features: ['competitor-reconcile'],
    };
    const hollyIdentity = identityIdForSlug(workspaceId, 'holly-cantwell-x1y2');

    // Rename, review, and merging-away are the manifest's to change.
    await expect(
      identityApi.patchIdentity(reconcileCtx, hollyIdentity, {
        label: 'Renamed In App',
      }),
    ).rejects.toThrow(/archive/);
    await expect(
      identityApi.reviewIdentity(reconcileCtx, hollyIdentity, {
        reviewed: true,
      }),
    ).rejects.toThrow(/archive/);

    // An app identity merges INTO the archive one — the archive survives —
    // but never the other way around.
    const appIdentity = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: appIdentity,
      workspaceId,
      label: 'Holly Cantwell',
      slug: 'holly-cantwell-app',
      managedBy: 'app',
    });
    await expect(
      identityApi.mergeIntoIdentity(reconcileCtx, appIdentity, {
        sourceId: hollyIdentity,
      }),
    ).rejects.toThrow(/archive/);
    const merged = await identityApi.mergeIntoIdentity(
      reconcileCtx,
      hollyIdentity,
      { sourceId: appIdentity },
    );
    expect(merged.identity.id).toBe(hollyIdentity);
    expect(merged.identity.managedBy).toBe('archive');

    // Splitting an as-published entry off is refused — even off an
    // archive identity that also carries it.
    await expect(
      identityApi.splitFromIdentity(reconcileCtx, hollyIdentity, {
        competitorIds: [holly],
      }),
    ).rejects.toThrow(/archive/);
  });

  test('delete removes the publication and the series', async () => {
    await archive.deleteArchiveSeries(ctx, seriesId);
    const rows = await db
      .select({ id: schema.series.id })
      .from(schema.series)
      .where(eq(schema.series.id, seriesId));
    expect(rows).toHaveLength(0);
    const pubs = await db
      .select({ id: schema.publishedSeries.id })
      .from(schema.publishedSeries)
      .where(
        and(
          eq(schema.publishedSeries.workspaceId, workspaceId),
          eq(schema.publishedSeries.slug, 'iodai-ulsters-2015'),
        ),
      );
    expect(pubs).toHaveLength(0);
  });
});
