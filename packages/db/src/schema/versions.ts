import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { projects } from './projects.js';
import { users } from './users.js';

export const versions = pgTable(
  'versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('building'),
    title: text('title'),
    artifactPath: text('artifact_path'),
    artifactSize: integer('artifact_size'),
    buildLog: text('build_log'),
    metadata: jsonb('metadata'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [unique('versions_project_version_idx').on(t.projectId, t.version)]
);
