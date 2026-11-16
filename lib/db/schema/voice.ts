import { customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { VoiceDocument } from '@/lib/voice/types';

import { organization } from './auth';
import { races } from './series';

/** Postgres `bytea` ↔ Node `Buffer` (Drizzle has no built-in bytea type). */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Recordings of finishes taken by voice (ADR-017). Two tables that nothing
 * else in the schema refers to, so the feature can leave the app, or move
 * its storage, without touching the rest.
 *
 * A recording belongs to a race and goes with the finish sheet submission
 * named by `submission_id`, which is a plain id rather than a foreign key:
 * the submission is the sheet's own business, and all this module needs is
 * to be found by it. `document` is the list of calls (see `VoiceDocument`).
 * `expires_at` is the retention rule: a recording is neither served nor kept
 * past it.
 *
 * The user column is plain text for the activity log's reason: the record
 * outlives an account.
 */
export const voiceRecordings = pgTable(
  'voice_recordings',
  {
    id: uuid('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    raceId: uuid('race_id')
      .notNull()
      .references(() => races.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id'),
    recordedByUserId: text('recorded_by_user_id').notNull(),
    document: jsonb('document').$type<VoiceDocument>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('voice_recordings_race_idx').on(table.raceId),
    index('voice_recordings_submission_idx').on(table.submissionId),
    index('voice_recordings_expires_idx').on(table.expiresAt),
  ],
);

/**
 * A recording's sound, in pieces of `VoiceDocument.segmentSeconds`: piece
 * `index` of take `take`, as µ-law at the document's sample rate. Kept out
 * of the nightly backups, whose retention is longer than a recording's.
 */
export const voiceRecordingSegments = pgTable(
  'voice_recording_segments',
  {
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => voiceRecordings.id, { onDelete: 'cascade' }),
    take: integer('take').notNull(),
    index: integer('index').notNull(),
    audio: bytea('audio').notNull(),
  },
  (table) => [primaryKey({ columns: [table.recordingId, table.take, table.index] })],
);
