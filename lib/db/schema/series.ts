import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organization } from './auth';

/**
 * ADR-008 Phase 1 placeholder. Real columns land in Phase 2 once the
 * full data model is translated from `lib/repository.ts` interfaces into
 * a Drizzle schema. Today this exists only so the foreign key from a
 * series to its workspace (= Better Auth organization) is exercised end
 * to end and so the migration pipeline has something non-empty to
 * generate.
 */
export const series = pgTable('series', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
