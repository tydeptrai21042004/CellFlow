/**
 * Explicit migration CLI. Prefer Neon's DIRECT URL for one-off schema DDL.
 * Like packages/db/src/migrate.ts, serialize migration writers under one
 * transaction-scoped advisory lock. Never log a connection string.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL_UNPOOLED or DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
});
const directory = path.resolve('packages/db/migrations');
const files = (await fs.readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
// Keep in sync with packages/db/src/migrate.ts.
const MIGRATION_LOCK_A = 1128678999;
const MIGRATION_LOCK_B = 1296648018;

try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_A}, ${MIGRATION_LOCK_B})`;
    await tx`create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )`;
    const rows = await tx`select version from schema_migrations`;
    const applied = new Set(rows.map((row) => String(row.version)));
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip ${file}`);
        continue;
      }
      const source = await fs.readFile(path.join(directory, file), 'utf8');
      await tx.unsafe(source);
      await tx`insert into schema_migrations (version) values (${file})`;
      console.log(`applied ${file}`);
    }
  });
} finally {
  await sql.end({ timeout: 5 });
}
