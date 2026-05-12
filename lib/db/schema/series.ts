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
  PrimaryPersonLabel,
  StartGroup,
  BilgeBundle,
} from '@/lib/types';

/**
 * ADR-008 Phase 2 schema. Mirrors `lib/types.ts` 1:1.
 *
 * Conventions:
 * - UUID primary keys; client-supplied (matches Dexie + JSON file format).
 * - `workspace_id` references the Better Auth `organization.id`. Denormalised
 *   onto `series`, `fleets`, `competitors`, `races` so tenancy filters are a
 *   single indexed lookup; child rows of races (`race_starts`, `finishes`,
 *   `nhc_tcf_records`) reach the workspace via their parent and don't carry
 *   the column. App-level invariant: child saves copy `workspace_id` from
 *   the parent series.
 * - `version` + `updated_at` on every mutable row. Saves bump `version`;
 *   Phase 4 wires the 409 response.
 * - JSONB for arrays/objects we never query by content (start sequences,
 *   discard thresholds, bilge bundle, redress arrays). `competitors.fleet_ids`
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
    bilgeBundle: jsonb('bilge_bundle').$type<BilgeBundle | null>(),
    includeJsonExport: boolean('include_json_export').notNull().default(true),
    publishRatingCalculations: boolean('publish_rating_calculations')
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
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('series_workspace_idx').on(table.workspaceId),
    check(
      'series_scoring_mode_chk',
      sql`${table.scoringMode} in ('scratch','handicap')`,
    ),
    check(
      'series_dnf_scoring_chk',
      sql`${table.dnfScoring} in ('seriesEntries','startingArea')`,
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
    version: versionCol,
    updatedAt: updatedAtCol,
    updatedBy: updatedByCol,
  },
  (table) => [
    index('fleets_series_order_idx').on(table.seriesId, table.displayOrder),
    index('fleets_workspace_idx').on(table.workspaceId),
    check(
      'fleets_scoring_system_chk',
      sql`${table.scoringSystem} in ('scratch','irc','py','nhc','echo')`,
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
    gender: text('gender').notNull().default(''),
    age: integer('age'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ircTcc: real('irc_tcc'),
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
 * Persistent per-(race, competitor, fleet) TCF snapshot. Derived state —
 * rebuilt by the scoring engine on every recompute. Persisted so file/JSON
 * imports render without re-scoring and so non-finishers (no Finish row)
 * still carry a record. No `version` column: derived data is replaced
 * wholesale, never edited.
 */
export const nhcTcfRecords = pgTable(
  'nhc_tcf_records',
  {
    id: uuid('id').primaryKey(),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    competitorId: uuid('competitor_id')
      .notNull()
      .references(() => competitors.id, { onDelete: 'cascade' }),
    fleetId: uuid('fleet_id')
      .notNull()
      .references(() => fleets.id, { onDelete: 'cascade' }),
    tcfApplied: real('tcf_applied').notNull(),
    newTcf: real('new_tcf').notNull(),
  },
  (table) => [
    uniqueIndex('nhc_tcf_records_uidx').on(
      table.raceId,
      table.competitorId,
      table.fleetId,
    ),
    index('nhc_tcf_records_race_idx').on(table.raceId),
  ],
);

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
 * re-running the handler. TTL cleanup is deferred (cron in Phase 4 territory).
 *
 * `body` is nullable: 204 responses (DELETE, touch) carry no body, but we
 * still want to record the replay so a re-issue returns 204 immediately.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  workspaceId: text('workspace_id').notNull(),
  key: text('key').notNull(),
  status: integer('status').notNull(),
  body: jsonb('body'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex('idempotency_keys_pk').on(table.workspaceId, table.key),
]);
