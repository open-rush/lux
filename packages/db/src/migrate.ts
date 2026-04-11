import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DEFAULT_MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), '../../drizzle');

export interface MigrateOptions {
  databaseUrl: string;
  migrationsFolder?: string;
}

export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const sql = postgres(opts.databaseUrl, { max: 1 });
  const db = drizzle(sql);

  try {
    await migrate(db, {
      migrationsFolder: opts.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER,
    });
  } finally {
    await sql.end();
  }
}
