import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  boolean,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
  customType,
} from 'drizzle-orm/pg-core';

/** Postgres `bytea` ↔ Node `Buffer` (Drizzle has no built-in bytea type). */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

import { organization } from './auth';
import type {
  CompetitorFieldKey,
  DiscardThreshold,
  NhcProfile,
  PrimaryPersonLabel,
  SeriesSource,
  StartGroup,
  PublishedSeriesPage,
} from '@/lib/types';
import type { SeriesFile } from '@/lib/series-file';

/**
 * ADR-008 Phase 2 schema. Mirrors `lib/types.ts` 1:1.
 *
 * Conventions:
 * - UUID primary keys; client-supplied (matches Dexie + JSON file format).
 * - `workspace_id` references the Better Auth `organization.id`. Denormalised
 *   onto `series`, `fleets`, `competitors`, `races` so tenancy filters are a
 *   single indexed lookup; child rows of races (`race_starts`, `finishes`)
 *   reach the workspace via their parent and don't carry the column.
 *   App-level invariant: child saves copy `workspace_id` from the parent
 *   series.
 * - `version` + `updated_at` on every mutable row. Saves bump `version`;
 *   Phase 4 wires the 409 response.
 * - JSONB for arrays/objects we never query by content (start sequences,
 *   discard thresholds, redress arrays). `competitors.fleet_ids`
 *   uses a real `uuid[]` with a GIN index because we *do* filter by fleet.
 */

// Reusable mutable-row columns.
const versionCol = integer('version').notNull().default(1);
const updatedAtCol = timestamp('updated_at', { withTimezone: true })
  .notNull()
  .defaultNow();
// ADR-008 Phase 7: actor attribution. Nullable — pre-Phase-7 rows render
// as "unknown" until next write rather than backfilled. References
// `user.id` semantically; not a real FK, so deleting a user doesn't cascade
// or block (orphan rows just lose their attribution display).
const updatedByCol = text('updated_by');

/**
 * Scorer-defined series categories (#154). Per-workspace, scorer-editable
 * (add / rename / reorder / delete). Not seeded for the scorer's own season
 * structure — different orgs partition differently, so series sit in the
 * synthetic "Uncategorized" bucket (`series.category_id` NULL) until the scorer
 * creates categories. The one exception is onboarding: a brand-new workspace's
 * sample series are grouped under a seeded "Samples" category
 * (`lib/sample-series/seed.ts`).
 *
 * Deleting a category drops its members back to Uncategorized via the
 * `ON DELETE SET NULL` on `series.category_id` — no row rewrite, and
 * "Uncategorized" can't be deleted because it isn't a row.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('categories_workspace_order_idx').on(
      table.workspaceId,
      table.displayOrder,
    ),
    // Case-insensitive duplicate prevention is enforced at the validation
    // layer; this constraint is the exact-match backstop.
    uniqueIndex('categories_workspace_name_uidx').on(
      table.workspaceId,
      table.name,
    ),
  ],
);

export const series = pgTable(
  'series',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    venue: text('venue').notNull().default(''),
    // ISO date strings ("YYYY-MM-DD"); the engine reads them as text.
    startDate: text('start_date').notNull().default(''),
    endDate: text('end_date').notNull().default(''),
    venueLogoUrl: text('venue_logo_url').notNull().default(''),
    eventLogoUrl: text('event_logo_url').notNull().default(''),
    venueUrl: text('venue_url').notNull().default(''),
    eventUrl: text('event_url').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // File-tracking fields. Carried for round-trip with the .sailscoring
    // file format and migration of local-first data.
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),
    lastModifiedAt: timestamp('last_modified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Scoring config.
    scoringMode: text('scoring_mode').notNull().default('scratch'),
    defaultStartSequence: jsonb('default_start_sequence').$type<StartGroup[]>(),
    discardThresholds: jsonb('discard_thresholds')
      .$type<DiscardThreshold[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    dnfScoring: text('dnf_scoring').notNull().default('seriesEntries'),
    // Publishing.
    ftpHost: text('ftp_host').notNull().default(''),
    ftpPath: text('ftp_path').notNull().default(''),
    ftpPaths: jsonb('ftp_paths')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    includeJsonExport: boolean('include_json_export').notNull().default(true),
    publishRatingCalculations: boolean('publish_rating_calculations')
      .notNull()
      .default(true),
    showPerRaceRatingsInSummary: boolean('show_per_race_ratings_in_summary')
      .notNull()
      .default(true),
    // Display.
    enabledCompetitorFields: jsonb('enabled_competitor_fields')
      .$type<CompetitorFieldKey[]>()
      .notNull()
      .default(sql`'["boatName","club"]'::jsonb`),
    primaryPersonLabel: text('primary_person_label')
      .$type<PrimaryPersonLabel>()
      .notNull()
      .default('competitor'),
    // Freeform label for the subdivision competitor field. No CHECK constraint
    // — the value is arbitrary text (length is bounded at the Zod layer).
    subdivisionLabel: text('subdivision_label').notNull().default('Division'),
    // Series-list organisation (#154). Both are workspace-local: deliberately
    // excluded from the .sailscoring file format and public JSON export, and
    // reset by copySeries (a copy lands active and uncategorised in its target
    // workspace). `category_id` NULL is the synthetic "Uncategorized" bucket.
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    // Archive = read-only + collapsed out of the active list (#154). Subsumes
    // the horizon "lock" concept: archived series reject edits, and are the
    // only ones that may be deleted (deliberate archive-then-delete friction).
    archived: boolean('archived').notNull().default(false),
    // Import provenance. Workspace-local (like category_id): nullable, set to
    // 'sailwave' for series born of a Sailwave import so the settings page can
    // offer "Update from Sailwave file". NULL for .sailscoring opens and
    // hand-built series. No CHECK — the value space is the SeriesSource union,
    // bounded at the Zod layer; a future source needn't touch the schema.
    source: text('source').$type<SeriesSource>(),
    // Lineage: the series this one was created as a follow-on of, with
    // competitors and starting handicaps carried forward. Workspace-local
    // (like category_id): excluded from the .sailscoring file format and
    // public JSON export. Set once at creation, immutable thereafter (not in
    // the update column set). Non-cascading: deleting the predecessor leaves
    // the follow-on intact with its lineage cleared.
    previousSeriesId: uuid('previous_series_id').references(
      (): AnyPgColumn => series.id,
      { onDelete: 'set null' },
    ),
    // Manual sort position within the active list. Seeded on insert
    // (new series append to the end) and rewritten by drag-reorder.
    displayOrder: integer('display_order').notNull(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('series_workspace_idx').on(table.workspaceId),
    index('series_workspace_order_idx').on(table.workspaceId, table.displayOrder),
    check(
      'series_scoring_mode_chk',
      sql`${table.scoringMode} in ('scratch','handicap')`,
    ),
    check(
      'series_dnf_scoring_chk',
      sql`${table.dnfScoring} in ('seriesEntries','startingArea','startingAreaInclDnc')`,
    ),
    check(
      'series_primary_person_label_chk',
      sql`${table.primaryPersonLabel} in ('competitor','entrant','helm','owner')`,
    ),
  ],
);

/**
 * Soft-delete tombstone for a deleted series ("Recover a deleted series").
 *
 * Deleting a series hard-deletes the live rows (as before) but first writes one
 * self-contained tombstone here: a whole-series `.sailscoring` snapshot
 * (including the embedded revision history) zstd-compressed into `snapshot_gz`.
 * Recovery decodes the blob and re-inserts the series — under its **original**
 * `series_id` — via the same file-replay path an import uses. A daily cron
 * purges tombstones past the retention window; permanent delete-from-Trash drops
 * the row immediately.
 *
 * Deliberately keeps all cost off the hot query path: the active series list is
 * untouched (no `deleted_at IS NULL` filter to forget), there are no lingering
 * child rows, and a deleted series no longer squats its name.
 *
 * `series_id` is the original id but is *not* a foreign key — the series row it
 * named is gone. `deleted_by` references `user.id` semantically only, like the
 * other actor-attribution columns.
 */
export const deletedSeries = pgTable(
  'deleted_series',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id').notNull(),
    name: text('name').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedBy: text('deleted_by'),
    // Whether the series had a live publication when deleted — the published
    // page is left orphaned, so the Trash view surfaces this as a note.
    hadPublication: boolean('had_publication').notNull().default(false),
    // Whole-series `.sailscoring` snapshot (incl. revision history), zstd.
    snapshotGz: bytea('snapshot_gz').notNull(),
  },
  (table) => [
    // Trash view: newest-first within a workspace.
    index('deleted_series_workspace_idx').on(
      table.workspaceId,
      table.deletedAt.desc(),
    ),
    // Retention sweep scans by age across all workspaces.
    index('deleted_series_purge_idx').on(table.deletedAt),
  ],
);

export const fleets = pgTable(
  'fleets',
  {
    id: uuid('id').primaryKey(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull(),
    scoringSystem: text('scoring_system').notNull(),
    echoAlpha: real('echo_alpha'),
    nhcProfile: jsonb('nhc_profile').$type<NhcProfile>(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('fleets_series_order_idx').on(table.seriesId, table.displayOrder),
    index('fleets_workspace_idx').on(table.workspaceId),
    check(
      'fleets_scoring_system_chk',
      sql`${table.scoringSystem} in ('scratch','irc','py','nhc','echo','vprs')`,
    ),
  ],
);

export const competitors = pgTable(
  'competitors',
  {
    id: uuid('id').primaryKey(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    fleetIds: uuid('fleet_ids').array().notNull(),
    sailNumber: text('sail_number').notNull(),
    boatName: text('boat_name'),
    boatClass: text('boat_class'),
    name: text('name').notNull(),
    owner: text('owner'),
    helm: text('helm'),
    crewName: text('crew_name'),
    club: text('club').notNull().default(''),
    nationality: text('nationality'),
    gender: text('gender').notNull().default(''),
    age: integer('age'),
    subdivision: text('subdivision'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ircTcc: real('irc_tcc'),
    vprsTcc: real('vprs_tcc'),
    pyNumber: real('py_number'),
    nhcStartingTcf: real('nhc_starting_tcf'),
    echoStartingTcf: real('echo_starting_tcf'),
    // Cross-series competitor-identity link (#212). Workspace-local: the row a
    // sailor's identity collapses onto across series. Nullable; written only by
    // the reconcile pass, never the standard competitor CRUD path (so an in-app
    // edit preserves it — it's absent from competitorUpdateColumns). Excluded
    // from the .sailscoring file format and public JSON export by virtue of not
    // being on the `Competitor` domain type at all. `set null` on identity
    // delete leaves the event data intact.
    identityId: uuid('identity_id').references(
      (): AnyPgColumn => competitorIdentities.id,
      { onDelete: 'set null' },
    ),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('competitors_series_idx').on(table.seriesId),
    index('competitors_workspace_idx').on(table.workspaceId),
    index('competitors_identity_idx').on(table.identityId),
    index('competitors_fleet_gin').using('gin', table.fleetIds),
    check(
      'competitors_gender_chk',
      sql`${table.gender} in ('M','F','')`,
    ),
  ],
);

/**
 * Cross-series competitor identity (#212) — the workspace-scoped recurring
 * competitor that per-series `competitors` rows collapse onto. For the IODAI
 * career-arc use case the recurring identity is a *person* (single-handed
 * dinghy class), but the fields mirror the polymorphism a competitor row
 * already carries so a boat-centric campaign reads correctly too. The
 * denormalised fields are a stable display snapshot, not the source of truth —
 * a sailor's name in a given event is still the competitor row's. `label` is
 * what the reconcile UI and the career-arc page show; it seeds from the
 * first-linked competitor and is editable. Workspace-local throughout.
 *
 * Deliberately no `birth_year` column: implied birth year (race-year − age) is
 * a *transient reconciliation input*, recomputed from the linked rows when the
 * reconcile pass runs, never persisted and never published.
 */
export const competitorIdentities = pgTable(
  'competitor_identities',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    // Vanity slug — the public URL handle and the iodai-archive manifest key
    // (#217/#218). Minted once from the label + a random suffix, persisted, and
    // never recomputed on rename, so it's stable. Nullable only to allow a
    // backfill window; the reconcile pass stamps it on create and fills any
    // gaps. Unique per workspace (partial index, below).
    slug: text('slug'),
    sailNumber: text('sail_number').notNull().default(''),
    boatName: text('boat_name'),
    club: text('club'),
    nationality: text('nationality'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('competitor_identities_workspace_idx').on(table.workspaceId),
    uniqueIndex('competitor_identities_workspace_slug_uidx')
      .on(table.workspaceId, table.slug)
      .where(sql`${table.slug} is not null`),
  ],
);

export const subSeries = pgTable(
  'sub_series',
  {
    id: uuid('id').primaryKey(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayOrder: integer('display_order').notNull(),
    // The fleets this sub-series scores. Null (the common case) means all the
    // series' fleets; a non-null list scopes it to those fleets only.
    fleetIds: uuid('fleet_ids').array(),
    // Where the progressive-handicap chain seeds from when this sub-series is
    // scored: 'base' (class / series-start numbers) or 'continue' (the end-of-
    // chain handicaps of `continueFromSubSeriesId`). See the handicap-scoring
    // design doc, "Shared progressive chain across overlapping series".
    startingHandicapSource: text('starting_handicap_source')
      .notNull()
      .default('base'),
    continueFromSubSeriesId: uuid('continue_from_sub_series_id').references(
      (): AnyPgColumn => subSeries.id,
      { onDelete: 'set null' },
    ),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('sub_series_series_idx').on(table.seriesId),
    index('sub_series_workspace_idx').on(table.workspaceId),
  ],
);

export const races = pgTable(
  'races',
  {
    id: uuid('id').primaryKey(),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    raceNumber: integer('race_number').notNull(),
    name: text('name'),
    date: text('date').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    uniqueIndex('races_series_number_uidx').on(table.seriesId, table.raceNumber),
    index('races_workspace_idx').on(table.workspaceId),
  ],
);

/**
 * Sub-series ↔ race membership (many-to-many): a sub-series is a named
 * selection of races, and a race may belong to several sub-series. Replaces the
 * old single `races.sub_series_id` partition FK.
 */
export const subSeriesRaces = pgTable(
  'sub_series_races',
  {
    subSeriesId: uuid('sub_series_id')
      .notNull()
      .references(() => subSeries.id, { onDelete: 'cascade' }),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Fleets for which this race doesn't count *in this sub-series* — a heat
    // struck for one fleet only. Empty (the common case) means it counts for
    // every scored fleet. The exclusion is a property of membership, so it
    // lives on the join row.
    excludedFleetIds: uuid('excluded_fleet_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
  },
  (table) => [
    primaryKey({ columns: [table.subSeriesId, table.raceId] }),
    index('sub_series_races_race_idx').on(table.raceId),
    index('sub_series_races_workspace_idx').on(table.workspaceId),
  ],
);

export const raceStarts = pgTable(
  'race_starts',
  {
    id: uuid('id').primaryKey(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    fleetIds: uuid('fleet_ids').array().notNull(),
    // Nullable: a membership-only start declares fleets with no gun time.
    startTime: text('start_time'),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [index('race_starts_race_idx').on(table.raceId)],
);

export const raceRatingOverrides = pgTable(
  'race_rating_overrides',
  {
    id: uuid('id').primaryKey(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    value: real('value').notNull(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('race_rating_overrides_race_idx').on(table.raceId),
    uniqueIndex('race_rating_overrides_race_comp_field_idx').on(
      table.raceId,
      table.competitorId,
      table.field,
    ),
    check(
      'race_rating_overrides_field_chk',
      sql`${table.field} in ('ircTcc','pyNumber','vprsTcc')`,
    ),
  ],
);

export const finishes = pgTable(
  'finishes',
  {
    id: uuid('id').primaryKey(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id').references(() => competitors.id, {
      onDelete: 'cascade',
    }),
    unknownSailNumber: text('unknown_sail_number'),
    sortOrder: integer('sort_order'),
    // Tied with the immediately-prior row at the same display position.
    // Engine averages ranks per RRS A8.1; display sortOrder stays distinct.
    tiedWithPrevious: boolean('tied_with_previous').notNull().default(false),
    finishTime: text('finish_time'),
    resultCode: text('result_code'),
    startPresent: boolean('start_present'),
    penaltyCode: text('penalty_code'),
    penaltyOverride: real('penalty_override'),
    // Per-fleet DPI points (fleetId → added points) for multi-fleet boats.
    penaltyOverrideByFleet: jsonb('penalty_override_by_fleet').$type<Record<string, number>>(),
    redressMethod: text('redress_method'),
    redressExcludeRaceIds: jsonb('redress_exclude_race_ids').$type<string[]>(),
    redressIncludeRaceIds: jsonb('redress_include_race_ids').$type<string[]>(),
    redressIncludeAllLater: boolean('redress_include_all_later')
      .notNull()
      .default(false),
    redressPoints: real('redress_points'),
    // Per-fleet stated redress points (fleetId → points) for multi-fleet boats.
    redressPointsByFleet: jsonb('redress_points_by_fleet').$type<Record<string, number>>(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('finishes_race_idx').on(table.raceId),
    index('finishes_competitor_idx').on(table.competitorId),
  ],
);

/**
 * ADR-008 Phase 9/10 — published results state, the in-app path that replaces
 * bilge (issue #153). A published page is identified by `(workspace_id, slug)`
 * and lives at `/p/{workspaceSlug}/{slug}/...`. There is no
 * `version`/optimistic-concurrency column — publish is the only writer and
 * last publish wins.
 *
 * The row is **decoupled from the series lifecycle**: `series_id` is nullable
 * with `ON DELETE SET NULL`, so deleting a series *orphans* its published page
 * (the page stays live and listed) rather than removing it. The partial
 * `unique(series_id)` keeps one live publication per series. This is what lets
 * the workspace "Published" management page (#164) manage orphans with no
 * schema change. `pages` stores one entry per fleet's stored HTML blob, keyed
 * to mirror the public URL path so the static read path (#162) is config-only.
 *
 * A slug is a *shared namespace*, not exclusive to one series: several series
 * may publish into the same `(workspace_id, slug)` and the read path unions
 * their `pages`, so e.g. "Lambay Races Cruisers" and "Lambay Races One Designs"
 * both land under `/p/{ws}/2026-lambay-races`. Hence `(workspace_id, slug)` is a
 * plain (non-unique) lookup index, not a unique constraint; the publish handler
 * keeps each contributor's fleet sub-paths from colliding within a slug.
 */
export const publishedSeries = pgTable(
  'published_series',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id').references(() => series.id, {
      onDelete: 'set null',
    }),
    slug: text('slug').notNull(),
    pages: jsonb('pages').$type<PublishedSeriesPage[]>().notNull(),
    contentHash: text('content_hash').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedVersion: integer('published_version').notNull(),
  },
  (table) => [
    // Non-unique: a slug is a shared namespace (several series can publish into
    // the same `(workspace, slug)`); this index serves the read-path lookup.
    index('published_series_workspace_slug_idx').on(
      table.workspaceId,
      table.slug,
    ),
    uniqueIndex('published_series_series_uidx')
      .on(table.seriesId)
      .where(sql`${table.seriesId} is not null`),
  ],
);

/**
 * Local fallback store for published HTML (ADR-008 Phase 9). In production,
 * rendered results are uploaded to Vercel Blob and `published_series.pages[]`
 * holds the absolute blob URL. When `BLOB_READ_WRITE_TOKEN` is unset
 * (local dev, CI, e2e), `lib/blob-storage.ts` writes the HTML here instead and
 * stores a `db:{key}` locator — so the whole flow works without an external
 * blob service, matching the ADR's "local dev needs only Postgres + Resend"
 * goal. Unused in production. Keyed by the blob pathname (which embeds the
 * unguessable slug); content is public, so no workspace scoping.
 */
export const publishedBlobs = pgTable('published_blobs', {
  key: text('key').primaryKey(),
  html: text('html').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * FTP server credentials, workspace-scoped. The password column holds the
 * AES-256-GCM ciphertext produced by `lib/crypto.ts` (IV + tag + ciphertext,
 * base64) — never the plaintext. Repository code is the only consumer that
 * encrypts or decrypts; HTTP handlers move plaintext only over TLS.
 */
export const ftpServers = pgTable(
  'ftp_servers',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    port: integer('port').notNull().default(21),
    username: text('username').notNull(),
    encryptedPassword: text('encrypted_password').notNull(),
    ftps: boolean('ftps').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [index('ftp_servers_workspace_idx').on(table.workspaceId)],
);

/**
 * Feedback submissions. Write-once sink populated by the in-app feedback
 * form (issue #123). The table doubles as the rate-limit log: the handler
 * counts rows for the submitting user inside the past hour to enforce the
 * per-user cap. Identifying fields are snapshotted at submit time so
 * historical rows survive user/email changes; `workspace_id` is kept for
 * ops/forwarding context and cascades when an org is deleted.
 */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    userEmail: text('user_email').notNull(),
    message: text('message').notNull(),
    pageUrl: text('page_url').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('feedback_user_created_idx').on(table.userId, table.createdAt.desc()),
    index('feedback_workspace_idx').on(table.workspaceId),
  ],
);

/**
 * Idempotency-key store. The wrapper in `app/api/v1/_lib/handler.ts` writes
 * the response body and status here on every successful write so a replay
 * with the same `Idempotency-Key` header returns the cached response without
 * re-running the handler. A daily Vercel cron
 * (`app/api/cron/sweep-idempotency/route.ts`) deletes rows older than the
 * replay window so the table stays bounded.
 *
 * `body` is nullable: 204 responses (DELETE, touch) carry no body, but we
 * still want to record the replay so a re-issue returns 204 immediately.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  status: integer('status').notNull(),
  body: jsonb('body'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex('idempotency_keys_pk').on(table.workspaceId, table.key),
  index('idempotency_keys_created_idx').on(table.createdAt),
]);

/**
 * Activity log (#153, ADR-008 Phase 10). Workspace-scoped, append-only record
 * of "what changed, when, by whom" — surfaced as a per-series Activity tab and
 * recency strips on the series list. Builds on the Phase 7 `updated_by`
 * down-payment (which still backs the per-record stamp in the competitor
 * dialog); this table adds the chronological surfaces.
 *
 * Coarse granularity for this first cut: action + a human `summary` + actor +
 * time. Field-level before/after diffs ("DNF → 14:23:07") are a deferred
 * refinement; `metadata` reserves room for them without a migration.
 *
 * `series_id` is a plain uuid, not a foreign key: like `updated_by` and
 * `feedback`, the log is a historical record that should outlive what it
 * describes. A deleted series' rows just stop being reachable from a series
 * page; workspace deletion still cascades them away via `workspace_id`.
 * `actor_user_id` is a semantic reference to `user.id` for the same reason.
 *
 * Per-row autosave actions (race finishes) coalesce: `recordActivity` folds
 * repeated writes sharing `(workspace_id, action, dedupe_key, actor_user_id)`
 * inside a session window into one row with a running `metadata.count`, so a
 * 20-boat race reads as a single "recorded finishes for Race 3" entry rather
 * than twenty lines.
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id'),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    dedupeKey: text('dedupe_key'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('activity_log_workspace_created_idx').on(
      table.workspaceId,
      table.createdAt.desc(),
    ),
    index('activity_log_series_created_idx').on(
      table.seriesId,
      table.createdAt.desc(),
    ),
    index('activity_log_coalesce_idx').on(
      table.workspaceId,
      table.dedupeKey,
      table.actorUserId,
    ),
  ],
);

/**
 * Revision history (#166). Each row is a full point-in-time snapshot of a
 * series in `.sailscoring` file shape, captured automatically as scorers edit.
 * Consecutive edits by the same actor within a short idle window coalesce into
 * one `auto` revision (the row is overwritten in place), so the list stays
 * coarse — see `lib/revision-log.ts`. `named` revisions are user-pinned
 * checkpoints; `revert` revisions record a restore. The activity-log entries in
 * a revision's window provide the finer-grained drill-down.
 */
export const seriesRevision = pgTable(
  'series_revision',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id'),
    kind: text('kind').notNull().default('auto'),
    label: text('label'),
    summary: text('summary'),
    // Context key for coalescing (#166): auto revisions only fold together
    // while the same actor keeps editing the *same* thing (a race's finishes,
    // settings, …). Switching context starts a new revision.
    sessionKey: text('session_key'),
    // A sealed revision is closed: a milestone (publish / save / revert) or an
    // explicit boundary set it, so later edits never coalesce back into it.
    sealed: boolean('sealed').notNull().default(false),
    // Snapshot storage. New rows write gzipped JSON to `snapshotGz`; the legacy
    // uncompressed `snapshot` (jsonb) stays for rows written before compression
    // landed. Readers prefer `snapshotGz` and fall back to `snapshot`.
    snapshot: jsonb('snapshot').$type<SeriesFile>(),
    snapshotGz: bytea('snapshot_gz'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('series_revision_series_created_idx').on(
      table.seriesId,
      table.createdAt.desc(),
    ),
    index('series_revision_coalesce_idx').on(
      table.seriesId,
      table.actorUserId,
      table.kind,
    ),
  ],
);

/**
 * Per-workspace logo library — the "flag locker" (shared logo library, tier 1;
 * see docs/notes/canonical-logo-library.md and docs/design/horizon.md). Holds
 * metadata only; the asset bytes live in Blob (or the `logo_blobs` fallback
 * locally), addressed by `locator` exactly like `published_series.blobUrl`.
 *
 * `locator` is content-addressed (key embeds the asset's `sha256`), so a blob
 * is immutable and a re-upload writes a fresh object and re-points the row —
 * the stable handle a consumer references is the row `id`, not the locator.
 * `logoClass` groups entries the way the HYC scorers' table does (and the way
 * the canonical tier will), but it is purely organisational here.
 */
export const flagLockerLogos = pgTable(
  'flag_locker_logos',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    logoClass: text('class').notNull(),
    locator: text('locator').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    sourceUrl: text('source_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [index('flag_locker_logos_workspace_idx').on(table.workspaceId)],
);

/**
 * Per-workspace default logos (flag locker, Phase 3). One row per workspace
 * holding the venue/event logo URLs a newly-created series inherits into its
 * empty burgee slots (copy-at-creation; the create handler copies the URL into
 * `series.venue_logo_url` / `event_logo_url`). Stored as URLs — not flag-locker
 * row ids — so a default can be a workspace logo, a built-in canonical logo, or
 * any pasted URL, exactly like a series slot. Deleting a workspace logo that's a
 * default is handled in the delete path by clearing the matching default URL.
 */
export const flagLockerDefaults = pgTable('flag_locker_defaults', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  venueLogoUrl: text('venue_logo_url'),
  eventLogoUrl: text('event_logo_url'),
  updatedAt: updatedAtCol,
  updatedBy: updatedByCol,
});

/**
 * Local-dev / CI fallback for logo asset bytes, mirroring `published_blobs`:
 * when `BLOB_READ_WRITE_TOKEN` is unset, `flag-locker-storage` writes here and
 * the `locator` is `db:{key}`. Bytes are stored base64-encoded in a text column
 * (binary-safe, no `bytea` custom type needed) — local-only, so the ~33%
 * inflation is irrelevant; production uses Blob.
 */
export const logoBlobs = pgTable('logo_blobs', {
  key: text('key').primaryKey(),
  data: text('data').notNull(),
  contentType: text('content_type').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
