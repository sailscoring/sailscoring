/**
 * The archive ingest document (ADR-010, #283): one as-published series, as
 * generated in an archive repo and uploaded through `/api/v1/archive`.
 *
 * Deliberately a distinct format from `.sailscoring` — a different contract
 * (no revision history, no open-in-app, no round-trip; the original captures
 * in git are the provenance). Every id is minted deterministically by the
 * generator from stable archive-repo inputs, so re-ingesting an updated
 * document updates rows in place and can never mint duplicates.
 *
 * Zod is the format definition; `parseArchiveSeriesDoc` is the only door.
 * Cross-references (row → competitor, competitor → fleet, cell alignment)
 * are validated here so the ingest handler can trust the shape outright.
 */

import { z } from 'zod';

import type { AsPublishedFleetResults } from './types';

const uuid = z.string().uuid();

/** Slug/sub-path segment: same character set and cap as the publish surface. */
const slugSegment = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase hyphen-separated slug');

/** Fleet page sub-path: one or two slug segments. Two-level paths let a
 *  corpus share one slug per season and group its fleet pages beneath it
 *  (`/p/dbsc/2022/saturday-overall/beneteau-211-echo`). */
const subPathSegments = z
  .string()
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/,
    'one or two lowercase hyphen-separated slug segments',
  );

const columnSchema = z.object({
  key: z.string().min(1).max(40),
  label: z.string().max(80),
});

const raceHeaderSchema = z.object({
  label: z.string().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const raceCellSchema = z.object({
  text: z.string().max(80),
  discard: z.boolean().optional(),
  rank: z.number().int().min(1).max(10_000).optional(),
});

const rowSchema = z.object({
  competitorId: uuid,
  rank: z.number().int().min(1).max(10_000).nullable(),
  rankLabel: z.string().max(20),
  leadCells: z.array(z.string().max(200)).max(20),
  raceCells: z.array(raceCellSchema).max(60),
  summaryCells: z.array(z.string().max(80)).max(20),
});

const raceTableRowSchema = z.object({
  competitorId: uuid.optional(),
  rank: z.number().int().min(1).max(10_000).optional(),
  cells: z.array(z.string().max(200)).max(30),
});

const raceTableSchema = z.object({
  label: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  caption: z.string().max(400).optional(),
  columns: z.array(columnSchema).min(1).max(30),
  rows: z.array(raceTableRowSchema).max(2000),
});

const fleetResultsSchema = z.object({
  caption: z.string().max(400).optional(),
  leadColumns: z.array(columnSchema).max(20),
  raceHeaders: z.array(raceHeaderSchema).max(60),
  summaryColumns: z.array(columnSchema).max(20),
  rows: z.array(rowSchema).max(2000),
  raceTables: z.array(raceTableSchema).max(60).optional(),
});

const fleetSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(120),
  /** Pinned public sub-path under the series slug — URL stability is data,
   *  never derived at ingest. */
  subPath: subPathSegments,
  results: fleetResultsSchema,
});

const competitorSchema = z.object({
  id: uuid,
  fleetIds: z.array(uuid).min(1).max(10),
  sailNumber: z.string().max(40),
  name: z.string().max(120),
  club: z.string().max(200).optional(),
  nationality: z.string().max(10).optional(),
  gender: z.enum(['M', 'F', '']).optional(),
  age: z.number().int().min(0).max(120).optional(),
  boatName: z.string().max(120).optional(),
  boatClass: z.string().max(120).optional(),
  helm: z.string().max(120).optional(),
  owner: z.string().max(120).optional(),
  crewName: z.string().max(200).optional(),
});

/** Structured rank for a per-race detail row: the leading column, where it
 *  is a rank/place column carrying a clean integer. Both HalSail ("Place")
 *  and Sailwave ("Ranking") race tables lead with one. */
export function raceTableRowRank(
  columns: Array<{ label: string }>,
  cells: string[],
): number | undefined {
  if (!columns[0] || !/rank|place/i.test(columns[0].label)) return undefined;
  const cell = (cells[0] ?? '').trim();
  return /^\d{1,4}$/.test(cell) ? Number(cell) : undefined;
}

export const archiveSeriesDocSchema = z
  .object({
    formatVersion: z.literal(1),
    series: z.object({
      id: uuid,
      name: z.string().trim().min(1).max(200),
      venue: z.string().max(200).optional(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      eventUrl: z.string().url().max(400).optional(),
      venueUrl: z.string().url().max(400).optional(),
      /** Header logo slots, as on a full-fidelity series (canonical-library
       *  URLs in practice). */
      venueLogoUrl: z.string().url().max(400).optional(),
      eventLogoUrl: z.string().url().max(400).optional(),
      /** Which engine originally published these results ('sailwave',
       *  'halsail', …). Free-form but bounded; display context only. */
      source: z.string().max(40).optional(),
      /** Initial category filing (by name; created in the workspace if
       *  absent). Applied when the series is first ingested only — category
       *  is workspace-local organisation, so re-ingests never move a series
       *  a scorer has refiled. */
      category: z.string().trim().min(1).max(80).optional(),
      /** Pinned public slug — the `/p/{ws}/{slug}` namespace this series
       *  publishes into. */
      publishedSlug: slugSegment,
    }),
    fleets: z.array(fleetSchema).min(1).max(50),
    competitors: z.array(competitorSchema).max(2000),
  })
  .superRefine((doc, ctx) => {
    const fleetIds = new Set(doc.fleets.map((f) => f.id));
    if (fleetIds.size !== doc.fleets.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate fleet id', path: ['fleets'] });
    }
    const subPaths = new Set(doc.fleets.map((f) => f.subPath));
    if (subPaths.size !== doc.fleets.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate fleet subPath', path: ['fleets'] });
    }
    const competitorIds = new Set<string>();
    doc.competitors.forEach((c, i) => {
      if (competitorIds.has(c.id)) {
        ctx.addIssue({ code: 'custom', message: 'duplicate competitor id', path: ['competitors', i, 'id'] });
      }
      competitorIds.add(c.id);
      for (const fid of c.fleetIds) {
        if (!fleetIds.has(fid)) {
          ctx.addIssue({ code: 'custom', message: 'competitor references unknown fleet', path: ['competitors', i, 'fleetIds'] });
        }
      }
    });
    doc.fleets.forEach((fleet, fi) => {
      const { leadColumns, raceHeaders, summaryColumns, rows } = fleet.results;
      (fleet.results.raceTables ?? []).forEach((table, ti) => {
        table.rows.forEach((row, ri) => {
          if (row.cells.length !== table.columns.length) {
            ctx.addIssue({ code: 'custom', message: 'race-table cells misaligned with columns', path: ['fleets', fi, 'results', 'raceTables', ti, 'rows', ri, 'cells'] });
          }
          if (row.competitorId && !competitorIds.has(row.competitorId)) {
            ctx.addIssue({ code: 'custom', message: 'race-table row references unknown competitor', path: ['fleets', fi, 'results', 'raceTables', ti, 'rows', ri, 'competitorId'] });
          }
        });
      });
      rows.forEach((row, ri) => {
        if (!competitorIds.has(row.competitorId)) {
          ctx.addIssue({ code: 'custom', message: 'row references unknown competitor', path: ['fleets', fi, 'results', 'rows', ri, 'competitorId'] });
        }
        if (row.leadCells.length !== leadColumns.length) {
          ctx.addIssue({ code: 'custom', message: 'leadCells misaligned with leadColumns', path: ['fleets', fi, 'results', 'rows', ri, 'leadCells'] });
        }
        if (row.raceCells.length !== raceHeaders.length) {
          ctx.addIssue({ code: 'custom', message: 'raceCells misaligned with raceHeaders', path: ['fleets', fi, 'results', 'rows', ri, 'raceCells'] });
        }
        if (row.summaryCells.length !== summaryColumns.length) {
          ctx.addIssue({ code: 'custom', message: 'summaryCells misaligned with summaryColumns', path: ['fleets', fi, 'results', 'rows', ri, 'summaryCells'] });
        }
      });
    });
  });

export type ArchiveSeriesDoc = z.infer<typeof archiveSeriesDocSchema>;
export type ArchiveSeriesDocFleet = ArchiveSeriesDoc['fleets'][number];
export type ArchiveSeriesDocCompetitor = ArchiveSeriesDoc['competitors'][number];

export function parseArchiveSeriesDoc(value: unknown): ArchiveSeriesDoc {
  return archiveSeriesDocSchema.parse(value);
}

/** Manifest identity slug — the app's competitor-slug shape (name +
 *  suffix), same character set as slugSegment but longer to fit full names. */
const identitySlug = z
  .string()
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase hyphen-separated slug');

const rankingRowSchema = z.object({
  identity: identitySlug.nullable(),
  rank: z.number().int().min(1).max(10_000).nullable(),
  rankLabel: z.string().max(20),
  name: z.string().min(1).max(120),
  leadCells: z.array(z.string().max(200)).max(20),
  eventCells: z.array(raceCellSchema).max(30),
  summaryCells: z.array(z.string().max(80)).max(20),
});

const rankingTableSchema = z.object({
  caption: z.string().max(400).optional(),
  leadColumns: z.array(columnSchema).max(20),
  eventHeaders: z.array(raceHeaderSchema).max(30),
  summaryColumns: z.array(columnSchema).max(20),
  rows: z.array(rankingRowSchema).max(2000),
});

/** An as-published season ranking (#309) — the ranking analogue of the
 *  series ingest document. Rows reference cross-series identities by
 *  manifest slug; the app maps slugs to its deterministic identity ids and
 *  never matches names itself. */
export const archiveRankingDocSchema = z
  .object({
    formatVersion: z.literal(1),
    ranking: z.object({
      id: uuid,
      name: z.string().trim().min(1).max(200),
      /** Pinned public slug under `/p/{ws}/ranking/` — shared namespace
       *  with computed rankings. */
      slug: slugSegment,
      season: z.number().int().min(1950).max(2100),
      /** "Junior" / "Senior"; omitted for combined (pre-2008) rankings. */
      fleetLabel: z.string().trim().min(1).max(40).optional(),
      /** The rule the season was ranked under, for the public footer. */
      ruleNote: z.string().max(400).optional(),
      source: z
        .object({
          url: z.string().url().max(400).optional(),
          capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          note: z.string().max(400).optional(),
        })
        .optional(),
    }),
    table: rankingTableSchema,
  })
  .superRefine((doc, ctx) => {
    const { leadColumns, eventHeaders, summaryColumns, rows } = doc.table;
    rows.forEach((row, ri) => {
      if (row.leadCells.length !== leadColumns.length) {
        ctx.addIssue({ code: 'custom', message: 'leadCells misaligned with leadColumns', path: ['table', 'rows', ri, 'leadCells'] });
      }
      if (row.eventCells.length !== eventHeaders.length) {
        ctx.addIssue({ code: 'custom', message: 'eventCells misaligned with eventHeaders', path: ['table', 'rows', ri, 'eventCells'] });
      }
      if (row.summaryCells.length !== summaryColumns.length) {
        ctx.addIssue({ code: 'custom', message: 'summaryCells misaligned with summaryColumns', path: ['table', 'rows', ri, 'summaryCells'] });
      }
    });
  });

export type ArchiveRankingDoc = z.infer<typeof archiveRankingDocSchema>;

export function parseArchiveRankingDoc(value: unknown): ArchiveRankingDoc {
  return archiveRankingDocSchema.parse(value);
}

/** JSON with object keys sorted at every level — a canonical byte form so
 *  the ingest hash is stable across generator implementations. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Content hash of a parsed document — the ingest's idempotency key: same
 *  hash as the stored `as_published_hash` means nothing to do. */
export async function archiveDocHash(
  doc: ArchiveSeriesDoc | ArchiveRankingDoc,
): Promise<string> {
  const data = new TextEncoder().encode(stableStringify(doc));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Narrow a doc fleet's results to the stored shape (identity today, but the
 *  seam where format-version migrations will live). */
export function toStoredResults(
  fleet: ArchiveSeriesDocFleet,
): AsPublishedFleetResults {
  return fleet.results;
}
