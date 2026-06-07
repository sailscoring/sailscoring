import { sql } from 'drizzle-orm';
import {
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
  check,
} from 'drizzle-orm/pg-core';

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
    // File-tracking fields. Mostly carried for round-trip with the
    // .sailscoring file format and migration of local-first data.
    lastSnapshotId: uuid('last_snapshot_id'),
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }),
    lastModifiedAt: timestamp('last_modified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    snapshotHistory: jsonb('snapshot_history')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('competitors_series_idx').on(table.seriesId),
    index('competitors_workspace_idx').on(table.workspaceId),
    index('competitors_fleet_gin').using('gin', table.fleetIds),
    check(
      'competitors_gender_chk',
      sql`${table.gender} in ('M','F','')`,
    ),
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

export const raceStarts = pgTable(
  'race_starts',
  {
    id: uuid('id').primaryKey(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    fleetIds: uuid('fleet_ids').array().notNull(),
    startTime: text('start_time').notNull(),
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
    redressMethod: text('redress_method'),
    redressExcludeRaces: jsonb('redress_exclude_races').$type<number[]>(),
    redressIncludeRaces: jsonb('redress_include_races').$type<number[]>(),
    redressIncludeAllLater: boolean('redress_include_all_later')
      .notNull()
      .default(false),
    redressPoints: real('redress_points'),
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
